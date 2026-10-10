import json
import os
import uuid
from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage
from db import get_scorecard, get_transcripts, get_session, save_scorecard

llm = ChatGroq(
    model="openai/gpt-oss-120b",
    temperature=0.1,
    api_key=os.environ.get("GROQ_API_KEY")
)

def clean_json_response(text: str) -> dict:
    clean = text.strip()
    if clean.startswith("```"):
        clean = clean.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    return json.loads(clean)

def evaluate_interview(session_id: str):
    if get_scorecard(session_id):
        print(f"Scorecard already exists for session: {session_id}")
        return

    session = get_session(session_id)
    transcripts = get_transcripts(session_id)

    if not session or not transcripts:
        print(f"Session or transcripts missing for {session_id}")
        return

    formatted_transcript = "\n".join([f"{t['speaker'].upper()}: {t['text']}" for t in transcripts])

    prompt = f"""
    Analyze this interview transcript based on the Job Description and Resume.

    JOB DESCRIPTION:
    {session['jd_text']}

    RESUME:
    {session['resume_text']}

    TRANSCRIPT:
    {formatted_transcript}

    Return ONLY a JSON object matching this schema:
    {{
        "overall_score": 85,
        "competency_scores": {{
            "System Design": 8,
            "Domain Knowledge": 9,
            "Communication": 8
        }},
        "strengths": ["Clear explanation of scaling strategies", "Solid grasp of async patterns"],
        "risks": ["Lacks hands-on depth in deployment security"],
        "evidence_quotes": ["I designed the cache buffer to handle 10k requests/sec."]
    }}
    """

    res = llm.invoke([SystemMessage(content=prompt)])
    data = clean_json_response(res.content)

    scorecard_id = f"sc_{uuid.uuid4().hex[:8]}"
    save_scorecard(
        session_id=session_id,
        scorecard_id=scorecard_id,
        overall_score=data["overall_score"],
        competency=data["competency_scores"],
        strengths=data["strengths"],
        risks=data["risks"],
        evidence=data["evidence_quotes"]
    )
    print(f"Scorecard saved successfully for session: {session_id}")