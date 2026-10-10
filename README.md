# Interview Agent

Interview Agent is a local practice app for technical interviews. Candidates upload a PDF resume, provide a target job description, and have a voice conversation with an AI interviewer. A completed interview produces a scorecard with competency scores, strengths, risks, and evidence quotes.

The app consists of a Next.js frontend, a Python HTTP API, a SQLite database, and a separate LiveKit voice-agent worker. The frontend and backend need to be running together for an interview to work.

## Features

- Dashboard, new-interview setup, live interview, past interviews, and scorecard pages.
- Resume upload as a PDF, with text extraction on the backend.
- Real-time voice interview using LiveKit, Deepgram speech-to-text, and Cartesia text-to-speech.
- Interview questions tailored to the resume and job description, with follow-ups and technical deep dives.
- Ten-minute minimum before an interview can be completed normally. The backend enforces this limit.
- A candidate can leave early. A left or disconnected interview is marked **Not completed**, cannot be restarted, and has no scorecard.
- Past interviews exclude sessions that were created but never started. The dashboard shows up to three recent completed interviews.

## Project structure

The frontend and backend are separate folders under the project root. Run commands from the folder specified in each command.

```text
Interview Agent/
├── README.md
├── backend/
│   ├── agent.py                 # LiveKit voice worker
│   ├── api.py                   # Python HTTP API
│   ├── db.py                    # SQLite schema and persistence
│   ├── evaluator.py             # Scorecard generation
│   ├── graph.py                 # Interview questions and flow
│   ├── requirements.txt
│   └── .env                     # Local provider credentials (not committed)
└── frontend/
    ├── app/
    │   ├── components/
    │   ├── history/
    │   ├── interview/
    │   ├── scorecard/
    │   └── page.tsx
    ├── next.config.ts
    └── package.json
```

## Requirements

- Node.js and npm.
- Python 3.11 (the current backend virtual environment was created with Python 3.11).
- Provider accounts and API credentials for LiveKit, Groq, Deepgram, and Cartesia.
- A microphone and a modern browser with microphone access enabled for voice interviews.

## Configuration

Create `backend/.env` and set your own credentials. Do not commit this file or paste real secrets into source code.

```dotenv
LIVEKIT_URL=wss://your-livekit-project.livekit.cloud
LIVEKIT_API_KEY=your-livekit-api-key
LIVEKIT_API_SECRET=your-livekit-api-secret
GROQ_API_KEY=your-groq-api-key
DEEPGRAM_API_KEY=your-deepgram-api-key
CARTESIA_API_KEY=your-cartesia-api-key
```

The API and worker both load this file. The frontend proxies `/api/*` requests to `http://127.0.0.1:8000` as configured in `next.config.ts`.

## Install and run locally on Windows

Keep each process running in a separate PowerShell terminal. Run commands from the project root shown in the `Set-Location` lines.

### 1. Install frontend dependencies

```powershell
Set-Location "C:\path\to\Interview Agent\frontend"
npm ci
```

### 2. Create the Python environment and install backend dependencies

Run once (or whenever the Python environment needs to be recreated):

```powershell
Set-Location "C:\path\to\Interview Agent\backend"
py -3.11 -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
```

### 3. Start the Python API

In a new terminal:

```powershell
Set-Location "C:\path\to\Interview Agent\backend"
.\venv\Scripts\python.exe -u .\api.py
```

The API listens on `http://127.0.0.1:8000`. It creates or updates `backend/interview_app.db` automatically.

### 4. Start the LiveKit worker

In another terminal:

```powershell
Set-Location "C:\path\to\Interview Agent\backend"
.\venv\Scripts\python.exe -u .\agent.py dev
```

The worker must stay connected to LiveKit Cloud to handle interview rooms. If it cannot connect, check the LiveKit URL, credentials, and network connection. The LiveKit Agents CLI may print a notice that `dev` is deprecated; that notice alone does not indicate startup failure.

### 5. Start the frontend

In another terminal:

```powershell
Set-Location "C:\path\to\Interview Agent\frontend"
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). To interview, allow microphone access and enable interviewer audio if the browser blocks autoplay.

## Application routes

| Route | Purpose |
| --- | --- |
| `/` | Dashboard and recent completed interviews |
| `/interview/new` | Candidate details, resume PDF, and job description |
| `/interview/[sessionId]` | Live voice interview, transcript, timer, and leave/end controls |
| `/history` | Completed and not-completed interview history |
| `/scorecard/[sessionId]` | Scorecard for a completed interview |

## Backend API

The frontend calls these routes through the Next.js `/api/*` rewrite:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/start-session` | Validate/extract the resume and create a session |
| `GET` | `/api/token?room={sessionId}` | Issue a LiveKit token for an eligible session |
| `GET` | `/api/session-status?sessionId={sessionId}` | Read lifecycle status and elapsed/remaining time |
| `GET` | `/api/transcript?sessionId={sessionId}` | Read the interview transcript |
| `GET` | `/api/sessions` | List started sessions for interview history |
| `POST` | `/api/end-session` | Check completion requirements and generate the scorecard |
| `POST` | `/api/leave-session` | Permanently mark a session not completed |
| `GET` | `/api/scorecard?sessionId={sessionId}` | Read a completed session’s scorecard |

## Interview and scorecard flow

1. The browser sends the candidate name, job description, and PDF content to the start-session endpoint.
2. The backend extracts readable text from the PDF and saves the text and job description in SQLite. The original PDF file is not stored by the backend.
3. The interview page requests a LiveKit token. When the worker joins the room, it marks the session in progress and starts the timer.
4. The worker uses Deepgram for speech recognition and Cartesia for speech output. LangGraph and Groq generate resume- and job-related topics, initial questions, follow-ups, and technical deep dives.
5. On normal completion, the backend checks that at least ten minutes elapsed and that at least one candidate answer exists. It sends the resume, job description, and transcript to the Groq-based evaluator, saves the scorecard, and marks the session completed.
6. Leaving early or disconnecting marks the session not completed instead. The worker does not create a scorecard on disconnect, and the session cannot be re-entered.

The scorecard fields are generated by the language model. The evaluator asks for an overall score, competency scores, strengths, risks, and evidence quotes in JSON. **There is no deterministic weighted scoring formula or human-calibrated rubric**, so scores can vary and should be treated as practice feedback, not an objective hiring decision.

## Data, privacy, and limitations

- SQLite data is stored in `backend/interview_app.db`. It contains candidate details, extracted resume text, job descriptions, transcripts, and scorecards. Back up or delete this file deliberately if you need to retain or remove local data.
- This is a local prototype: there are no user accounts, authentication, or per-user access controls.
- The resume reader supports readable, text-based PDFs only. Scanned/image-only resumes are not OCR-processed. Encrypted PDFs are rejected; PDFs are limited to 8 MB and 100 pages.
- A ten-minute minimum is required to finish normally; the interview has no fixed maximum duration.
- Leaving or disconnecting is final. There is no pause/resume or restart for that session.
- Voice, question generation, and scorecard evaluation depend on external provider availability and valid credentials.
- Do not use this prototype to make hiring decisions or upload sensitive data unless you understand how data is processed and stored.

## Validation

Run a production frontend build from `frontend`:

```powershell
npm run build
```

The backend does not currently include a dedicated automated test suite. Changes to interview lifecycle or evaluation should be verified with focused API/worker smoke tests as well as a frontend build.
