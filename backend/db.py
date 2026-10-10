import sqlite3
import json
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "interview_app.db")
MIN_INTERVIEW_SECONDS = 10 * 60

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_connection() as conn:
        cursor = conn.cursor()
        
        # Sessions table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            candidate_name TEXT NOT NULL,
            resume_text TEXT NOT NULL,
            jd_text TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            started_at REAL,
            ended_at REAL,
            status TEXT NOT NULL DEFAULT 'not_started'
        );
        """)
        session_columns = {row["name"] for row in cursor.execute("PRAGMA table_info(sessions)")}
        if "started_at" not in session_columns:
            cursor.execute("ALTER TABLE sessions ADD COLUMN started_at REAL")
        if "ended_at" not in session_columns:
            cursor.execute("ALTER TABLE sessions ADD COLUMN ended_at REAL")
        if "status" not in session_columns:
            cursor.execute("ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'not_started'")

        # Transcripts table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS transcripts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            speaker TEXT CHECK(speaker IN ('interviewer', 'candidate')) NOT NULL,
            text TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        );
        """)

        # Scorecards table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS scorecards (
            id TEXT PRIMARY KEY,
            session_id TEXT UNIQUE NOT NULL,
            overall_score INTEGER NOT NULL,
            competency_scores_json TEXT NOT NULL,
            strengths_json TEXT NOT NULL,
            risks_json TEXT NOT NULL,
            evidence_quotes_json TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        );
        """)
        cursor.execute(
            """UPDATE sessions SET status = 'completed'
               WHERE status = 'not_started' AND EXISTS (
                   SELECT 1 FROM scorecards WHERE scorecards.session_id = sessions.id
               )"""
        )
        cursor.execute(
            """UPDATE sessions SET status = 'not_completed'
               WHERE status = 'not_started' AND started_at IS NOT NULL"""
        )
        conn.commit()

def create_session(session_id: str, candidate_name: str, resume_text: str, jd_text: str):
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO sessions (id, candidate_name, resume_text, jd_text) VALUES (?, ?, ?, ?)",
            (session_id, candidate_name, resume_text, jd_text)
        )
        conn.commit()

def get_session(session_id: str):
    with get_connection() as conn:
        row = conn.execute(
            """SELECT id, candidate_name, resume_text, jd_text, created_at,
                      started_at, ended_at, status
               FROM sessions WHERE id = ?""",
            (session_id,)
        ).fetchone()
        return dict(row) if row else None

def mark_session_started(session_id: str, started_at: float):
    with get_connection() as conn:
        cursor = conn.execute(
            """UPDATE sessions
               SET started_at = ?, ended_at = NULL, status = 'in_progress'
               WHERE id = ? AND status = 'not_started'""",
            (started_at, session_id)
        )
        conn.commit()
        return cursor.rowcount == 1

def mark_session_not_completed(session_id: str, ended_at: float):
    with get_connection() as conn:
        cursor = conn.execute(
            """UPDATE sessions SET ended_at = ?, status = 'not_completed'
               WHERE id = ? AND status IN ('not_started', 'in_progress')""",
            (ended_at, session_id)
        )
        conn.commit()
        return cursor.rowcount == 1

def mark_session_completed(session_id: str, ended_at: float):
    with get_connection() as conn:
        cursor = conn.execute(
            """UPDATE sessions SET ended_at = ?, status = 'completed'
               WHERE id = ? AND status = 'in_progress'""",
            (ended_at, session_id)
        )
        conn.commit()
        return cursor.rowcount == 1

def delete_scorecard(session_id: str):
    with get_connection() as conn:
        conn.execute("DELETE FROM scorecards WHERE session_id = ?", (session_id,))
        conn.commit()

def get_sessions():
    with get_connection() as conn:
        rows = conn.execute(
            """SELECT s.id, s.candidate_name, s.created_at, s.started_at, s.ended_at, s.status,
                      COUNT(CASE WHEN t.speaker = 'candidate' THEN 1 END) AS answer_count,
                      sc.overall_score
               FROM sessions AS s
               LEFT JOIN transcripts AS t ON t.session_id = s.id
               LEFT JOIN scorecards AS sc ON sc.session_id = s.id
               WHERE s.status != 'not_started'
               GROUP BY s.id
               ORDER BY s.created_at DESC"""
        ).fetchall()
        return [dict(row) for row in rows]

def add_transcript(session_id: str, speaker: str, text: str):
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO transcripts (session_id, speaker, text) VALUES (?, ?, ?)",
            (session_id, speaker, text)
        )
        conn.commit()

def get_transcripts(session_id: str):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT speaker, text, timestamp FROM transcripts WHERE session_id = ? ORDER BY id ASC", (session_id,))
        return [dict(row) for row in cursor.fetchall()]

def get_scorecard(session_id: str):
    with get_connection() as conn:
        row = conn.execute(
            """SELECT overall_score, competency_scores_json, strengths_json,
                      risks_json, evidence_quotes_json, created_at
               FROM scorecards WHERE session_id = ?""",
            (session_id,)
        ).fetchone()
        return dict(row) if row else None

def save_scorecard(session_id: str, scorecard_id: str, overall_score: int, competency: dict, strengths: list, risks: list, evidence: list):
    with get_connection() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO scorecards 
               (id, session_id, overall_score, competency_scores_json, strengths_json, risks_json, evidence_quotes_json)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                scorecard_id, session_id, overall_score,
                json.dumps(competency), json.dumps(strengths),
                json.dumps(risks), json.dumps(evidence)
            )
        )
        conn.commit()

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully.")