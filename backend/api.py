import base64
import binascii
import io
import json
import os
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from dotenv import load_dotenv
from livekit.api import AccessToken, VideoGrants
from pypdf import PdfReader

from db import (
    MIN_INTERVIEW_SECONDS,
    create_session,
    delete_scorecard,
    get_scorecard,
    get_session,
    get_sessions,
    get_transcripts,
    init_db,
    mark_session_completed,
    mark_session_not_completed,
)


load_dotenv(dotenv_path=Path(__file__).with_name(".env"))
init_db()


class ApiHandler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        request_path = urlparse(self.path).path
        if request_path not in {"/api/start-session", "/api/end-session", "/api/leave-session"}:
            self._send_json(404, {"error": "Endpoint not found."})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > 12_000_000:
                self._send_json(400, {"error": "Request body is missing or too large."})
                return

            payload = json.loads(self.rfile.read(content_length))
            if not isinstance(payload, dict):
                self._send_json(400, {"error": "Expected a JSON object."})
                return

            if request_path == "/api/end-session":
                session_id = payload.get("sessionId")
                session = get_session(session_id) if isinstance(session_id, str) else None
                if not session:
                    self._send_json(404, {"error": "Interview session not found."})
                    return

                if session["status"] == "completed" and get_scorecard(session_id):
                    self._send_json(200, get_scorecard(session_id))
                    return
                if session["status"] != "in_progress":
                    self._send_json(409, {"error": "This interview is not active and cannot be completed."})
                    return

                remaining = max(
                    0,
                    MIN_INTERVIEW_SECONDS - int(time.time() - session["started_at"]),
                )
                if remaining:
                    self._send_json(
                        409,
                        {
                            "error": "The interview needs to run for at least 10 minutes before it can end.",
                            "remainingSeconds": remaining,
                        },
                    )
                    return

                scorecard = get_scorecard(session_id)
                if not scorecard:
                    transcripts = get_transcripts(session_id)
                    if not any(item["speaker"] == "candidate" for item in transcripts):
                        self._send_json(409, {"error": "No candidate answers were recorded for this interview."})
                        return

                    from evaluator import evaluate_interview

                    evaluate_interview(session_id)
                    scorecard = get_scorecard(session_id)

                if not scorecard:
                    self._send_json(502, {"error": "Interview evaluation finished without saving a scorecard."})
                    return

                if not mark_session_completed(session_id, time.time()):
                    delete_scorecard(session_id)
                    self._send_json(409, {"error": "This interview was left and cannot be completed."})
                    return
                self._send_json(200, scorecard)
                return

            if request_path == "/api/leave-session":
                session_id = payload.get("sessionId")
                session = get_session(session_id) if isinstance(session_id, str) else None
                if not session:
                    self._send_json(404, {"error": "Interview session not found."})
                    return
                if session["status"] == "completed":
                    self._send_json(409, {"error": "A completed interview cannot be marked as not completed."})
                    return
                if session["status"] == "not_completed":
                    self._send_json(200, {"status": "not_completed"})
                    return
                if not mark_session_not_completed(session_id, time.time()):
                    self._send_json(409, {"error": "This interview is no longer active."})
                    return
                delete_scorecard(session_id)
                self._send_json(200, {"status": "not_completed"})
                return

            name = payload.get("candidate_name")
            resume = payload.get("resume_text")
            resume_pdf = payload.get("resume_pdf_base64")
            job_description = payload.get("jd_text")
            if not isinstance(name, str) or not name.strip() or not isinstance(job_description, str) or not job_description.strip():
                self._send_json(400, {"error": "Candidate name, PDF resume, and job description are required."})
                return

            if isinstance(resume_pdf, str) and resume_pdf:
                try:
                    pdf_bytes = base64.b64decode(resume_pdf, validate=True)
                    if len(pdf_bytes) > 8_000_000 or not pdf_bytes.startswith(b"%PDF-"):
                        raise ValueError("The uploaded file is not a valid PDF or is larger than 8 MB.")
                    reader = PdfReader(io.BytesIO(pdf_bytes), strict=False)
                    if reader.is_encrypted:
                        raise ValueError("Please upload an unlocked PDF resume.")
                    if len(reader.pages) > 100:
                        raise ValueError("The uploaded PDF is too long. Please use a resume under 100 pages.")
                    resume_text = "\n".join(page.extract_text() or "" for page in reader.pages).strip()
                    if len(resume_text) < 40:
                        raise ValueError("No readable text was found. Please upload a text-based PDF resume.")
                except (binascii.Error, ValueError) as error:
                    self._send_json(400, {"error": str(error) or "Unable to read the PDF resume."})
                    return
                except Exception:
                    self.log_error("Unable to extract text from uploaded PDF")
                    self._send_json(400, {"error": "Unable to read this PDF. Please try another text-based resume."})
                    return
            elif isinstance(resume, str) and resume.strip():
                resume_text = resume.strip()
            else:
                self._send_json(400, {"error": "Please upload a readable PDF resume."})
                return

            session_id = uuid.uuid4().hex
            create_session(session_id, name.strip(), resume_text, job_description.strip())
            self._send_json(201, {"sessionId": session_id})
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(400, {"error": "Request body must contain valid JSON."})
        except Exception:
            if request_path == "/api/end-session":
                self.log_error("Failed to generate interview scorecard")
                self._send_json(502, {"error": "Unable to generate the interview scorecard. Check the backend logs and try again."})
            elif request_path == "/api/leave-session":
                self.log_error("Failed to mark interview as not completed")
                self._send_json(500, {"error": "Unable to leave the interview. Please try again."})
            else:
                self.log_error("Failed to create interview session")
                self._send_json(500, {"error": "Unable to create interview session."})

    def do_GET(self) -> None:
        request = urlparse(self.path)
        query = parse_qs(request.query)

        if request.path in {"/", "/health"}:
            self._send_json(200, {"status": "ok"})
            return

        if request.path == "/api/sessions":
            sessions = get_sessions()
            self._send_json(200, {"sessions": sessions})
            return

        if request.path == "/api/session-status":
            session_id = query.get("sessionId", [""])[0]
            session = get_session(session_id) if session_id else None
            if not session:
                self._send_json(404, {"error": "Interview session not found."})
                return
            started_at = session["started_at"]
            elapsed = max(0, int(time.time() - started_at)) if started_at is not None else 0
            self._send_json(
                200,
                {
                    "startedAt": started_at,
                    "elapsedSeconds": elapsed,
                    "minimumDurationSeconds": MIN_INTERVIEW_SECONDS,
                    "remainingSeconds": max(0, MIN_INTERVIEW_SECONDS - elapsed),
                    "status": session["status"],
                },
            )
            return

        if request.path == "/api/token":
            room = query.get("room", [""])[0]
            session = get_session(room) if room else None
            if not session:
                self._send_json(404, {"error": "Interview session not found."})
                return
            if session["status"] in {"not_completed", "completed"}:
                self._send_json(
                    410,
                    {
                        "error": "This interview is no longer available. Left interviews cannot be restarted.",
                        "status": session["status"],
                    },
                )
                return

            try:
                token = (
                    AccessToken()
                    .with_identity(f"candidate-{room}")
                    .with_name(session["candidate_name"])
                    .with_grants(VideoGrants(room_join=True, room=room))
                    .to_jwt()
                )
                server_url = os.environ.get("LIVEKIT_URL")
                if not server_url:
                    self._send_json(503, {"error": "LiveKit URL is not configured on the backend."})
                    return
                self._send_json(200, {"token": token, "serverUrl": server_url})
            except ValueError:
                self._send_json(503, {"error": "LiveKit credentials are not configured on the backend."})
            except Exception:
                self.log_error("Failed to create LiveKit token")
                self._send_json(500, {"error": "Unable to create LiveKit token."})
            return

        if request.path == "/api/scorecard":
            session_id = query.get("sessionId", [""])[0]
            session = get_session(session_id) if session_id else None
            if not session:
                self._send_json(404, {"error": "Interview session not found."})
                return
            if session["status"] != "completed":
                self._send_json(
                    409,
                    {"error": "This interview was not completed, so no scorecard is available."},
                )
                return
            scorecard = get_scorecard(session_id) if session_id else None
            if not scorecard:
                self._send_json(202, {"status": "pending", "message": "Scorecard is being generated."})
                return
            self._send_json(200, scorecard)
            return

        if request.path == "/api/transcript":
            session_id = query.get("sessionId", [""])[0]
            session = get_session(session_id) if session_id else None
            if not session:
                self._send_json(404, {"error": "Interview session not found."})
                return
            if session["status"] == "not_completed":
                self._send_json(410, {"error": "This interview was not completed and cannot be restarted."})
                return
            self._send_json(200, {"transcripts": get_transcripts(session_id)})
            return

        self._send_json(404, {"error": "Endpoint not found."})


if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), ApiHandler)
    print(f"Interview Agent API listening at http://{host}:{port}", flush=True)
    server.serve_forever()
