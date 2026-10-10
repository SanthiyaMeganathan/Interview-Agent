# Interview Agent

Interview Agent is a local practice app for technical interviews. Candidates upload a PDF resume, provide a target job description, and have a voice conversation with an AI interviewer. A completed interview produces a scorecard with competency scores, strengths, risks, and evidence quotes.

The app consists of a Next.js frontend, a Python HTTP API, a SQLAlchemy-backed database (local SQLite or hosted PostgreSQL), and a separate LiveKit voice-agent worker. The frontend and backend need to be running together for an interview to work.

## Features

- Dashboard, new-interview setup, live interview, past interviews, and scorecard pages.
- Resume upload as a PDF, with text extraction on the backend.
- Real-time voice interview using LiveKit, Deepgram speech-to-text, and Cartesia text-to-speech.
- Interview questions tailored to the resume and job description, with follow-ups and technical deep dives.
- Interviews can be completed after any recorded answer, with a maximum duration of ten minutes.
- A candidate can leave early. A left or disconnected interview is marked **Not completed**, cannot be restarted, and has no scorecard.
- Past interviews exclude sessions that were created but never started. The dashboard shows up to three recent completed interviews.

## Project structure

The frontend and backend are separate folders under the project root. Run commands from the folder specified in each command.

```text
Interview Agent/
├── README.md
├── Dockerfile                 # Docker image for the Render backend service
├── .dockerignore
├── backend/
│   ├── .env.example
│   ├── .dockerignore
│   ├── Dockerfile              # Alternative when building with backend/ as Docker context
│   ├── start.sh
│   ├── agent.py                 # LiveKit voice worker
│   ├── api.py                   # Python HTTP API
│   ├── db.py                    # SQLite/PostgreSQL schema and persistence
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

Copy `backend/.env.example` to `backend/.env` and set your own credentials. Do not commit this file or paste real secrets into source code.

```dotenv
LIVEKIT_URL=wss://your-livekit-project.livekit.cloud
LIVEKIT_API_KEY=your-livekit-api-key
LIVEKIT_API_SECRET=your-livekit-api-secret
GROQ_API_KEY=your-groq-api-key
DEEPGRAM_API_KEY=your-deepgram-api-key
CARTESIA_API_KEY=your-cartesia-api-key
# Optional locally: omit DATABASE_URL to use backend/interview_app.db.
# In deployment, set DATABASE_URL to the Supabase PostgreSQL session-pooler URL.
```

The API and worker both load this file. The frontend proxies `/api/*` requests to `http://127.0.0.1:8000` by default. Set `BACKEND_API_URL` when hosting the frontend separately.

For a Supabase connection, copy the **session pooler** URI from the Supabase dashboard's **Connect** dialog. The session pooler works on IPv4-only hosts such as many hosted container services. Keep the URI in a secret environment variable, require TLS, and percent-encode any reserved characters in the database password. Never commit a populated `.env` file or put a database password in the frontend.

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

The API listens on `http://127.0.0.1:8000`. If `DATABASE_URL` is not set, it creates or updates `backend/interview_app.db` automatically. If a PostgreSQL URL is configured, it creates or updates the required PostgreSQL tables on startup instead.

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

## Deploy to Vercel, Render, and Supabase

The production deployment uses three services:

- **Vercel** hosts the Next.js app in `frontend/`.
- **Render** runs the backend Docker container, including both the Python API and the LiveKit worker.
- **Supabase** hosts PostgreSQL.

### 1. Configure Supabase PostgreSQL

1. Open the Supabase project dashboard and select **Connect**.
2. Copy the PostgreSQL **session pooler** connection URI. The session pooler is suitable for Render instances that may not have IPv6 connectivity.
3. URL-encode reserved characters in the database password. Rotate any database password that has been shared outside the Supabase dashboard.
4. Keep the connection URI private; configure it as a Render secret, not in source code or a Vercel environment variable.

The backend creates and migrates the required tables on startup. This does **not** copy existing records from local `backend/interview_app.db`; local sessions and cloud sessions remain separate unless migrated explicitly.

### 2. Deploy the backend Docker service on Render

Create a **Web Service** in Render and connect the Git repository:

1. Choose **Docker** as the runtime.
2. Set the Docker context/root directory to the repository root (`.`) and use the repository-root `Dockerfile`.
3. Add these environment variables under the Render service settings. Mark credentials and the database URI as secret:
   - `DATABASE_URL` — the Supabase PostgreSQL session-pooler URI.
   - `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
   - `GROQ_API_KEY`, `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`
   - `REQUIRE_DATABASE_URL=1`
4. Set the Render health-check path to `/health`.
5. Deploy and wait for the service to become healthy. The API listens on Render's `PORT`; the same container also starts the LiveKit worker.

The LiveKit worker must remain connected so it can accept dispatched interview rooms. Use a Render plan that keeps this service running; a service that sleeps or suspends will make voice interviews unavailable. The repository-root `Dockerfile` is intended for a repository-root Docker context. `backend/Dockerfile` is an alternative only if configuring Render with `backend/` as its root/build context.

### 3. Deploy the frontend on Vercel

1. Import the same Git repository into Vercel.
2. Set **Root Directory** to `frontend`.
3. Add the environment variable `BACKEND_API_URL`, set to the public Render service URL (for example, `https://your-service.onrender.com`), with no trailing `/api`.
4. Deploy the frontend.

`next.config.ts` rewrites frontend `/api/*` requests to `BACKEND_API_URL`. Set this variable in Vercel's build environment so the rewrite points to the Render backend in the deployed app. Do not put Supabase credentials in Vercel; only the backend connects to the database.

## Application routes

| Route | Purpose |
| --- | --- |
| `/` | Dashboard and recent completed interviews |
| `/interview/new` | Candidate details, resume PDF, and job description |
| `/interview/[sessionId]` | Live voice interview, latest question and response, and leave/end controls |
| `/history` | Completed and not-completed interview history |
| `/scorecard/[sessionId]` | Scorecard for a completed interview |

## Backend API

The frontend calls these routes through the Next.js `/api/*` rewrite. Locally the backend defaults to port `8000`; in the Render Docker service it binds to `0.0.0.0` on Render's `PORT`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/start-session` | Validate/extract the resume and create a session |
| `GET` | `/api/token?room={sessionId}` | Issue a LiveKit token for an eligible session |
| `GET` | `/api/session-status?sessionId={sessionId}` | Read lifecycle status and maximum duration |
| `GET` | `/api/transcript?sessionId={sessionId}` | Read the interview transcript |
| `GET` | `/api/sessions` | List started sessions for interview history |
| `POST` | `/api/end-session` | Complete an interview and generate the scorecard |
| `POST` | `/api/leave-session` | Permanently mark a session not completed |
| `GET` | `/api/scorecard?sessionId={sessionId}` | Read a completed session’s scorecard |

## Interview and scorecard flow

1. The browser sends the candidate name, job description, and PDF content to the start-session endpoint.
2. The backend extracts readable text from the PDF and saves the text and job description in SQLite or PostgreSQL, depending on `DATABASE_URL`. The original PDF file is not stored by the backend.
3. The interview page requests a LiveKit token. When the worker joins the room, it marks the session in progress and starts the timer.
4. The worker uses Deepgram for speech recognition and Cartesia for speech output. LangGraph and Groq generate resume- and job-related topics, initial questions, follow-ups, and technical deep dives.
5. The candidate can finish after any recorded answer; there is no minimum duration. Interviews are capped at ten minutes. At the cap, the app completes the scorecard after the current speaking turn, provided there is at least one candidate answer. It sends the resume, job description, and transcript to the Groq-based evaluator, saves the scorecard, and marks the session completed.
6. Leaving early or disconnecting marks the session not completed instead. If the candidate says they need to leave, the interviewer asks why, gives a brief spoken closing after the candidate responds, and then ends the room. Unrelated questions are redirected to the interview topic; after three consecutive off-topic turns, the interviewer politely ends the interview. These early endings do not create a scorecard, and the session cannot be re-entered.

The scorecard fields are generated by the language model. The evaluator asks for an overall score, competency scores, strengths, risks, and evidence quotes in JSON. **There is no deterministic weighted scoring formula or human-calibrated rubric**, so scores can vary and should be treated as practice feedback, not an objective hiring decision.

## Data, privacy, and limitations

- Without `DATABASE_URL`, local SQLite data is stored in `backend/interview_app.db`. It contains candidate details, extracted resume text, job descriptions, transcripts, and scorecards. With `DATABASE_URL`, those records are stored in the configured PostgreSQL database. Back up or delete local data deliberately if you need to retain or remove it.
- This is a local prototype: there are no user accounts, authentication, or per-user access controls.
- The resume reader supports readable, text-based PDFs only. Scanned/image-only resumes are not OCR-processed. Encrypted PDFs are rejected; PDFs are limited to 8 MB and 100 pages.
- There is no minimum interview duration. Candidates can finish after any recorded answer; interviews end automatically at ten minutes after the candidate's final response to the current question. Duration is not shown in the live room.
- Leaving or disconnecting is final. There is no pause/resume or restart for that session.
- Voice, question generation, and scorecard evaluation depend on external provider availability and valid credentials.
- Do not use this prototype to make hiring decisions or upload sensitive data unless you understand how data is processed and stored.

## Validation

Run a production frontend build from `frontend`:

```powershell
npm run build
```

The backend does not currently include a dedicated automated test suite. Changes to interview lifecycle or evaluation should be verified with focused API/worker smoke tests as well as a frontend build.
