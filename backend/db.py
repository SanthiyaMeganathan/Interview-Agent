import json
import os
from datetime import date, datetime
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    func,
    inspect,
    text,
)
from sqlalchemy.engine import Engine, URL, make_url

load_dotenv(dotenv_path=Path(__file__).with_name(".env"))

MIN_INTERVIEW_SECONDS = 10 * 60
DB_PATH = Path(__file__).with_name("interview_app.db")

database_url = os.environ.get("DATABASE_URL")
if os.environ.get("REQUIRE_DATABASE_URL") == "1" and not database_url:
    raise RuntimeError("DATABASE_URL must be configured for this deployment.")

if database_url:
    if database_url.startswith("postgres://"):
        database_url = f"postgresql://{database_url.removeprefix('postgres://')}"
    url = make_url(database_url)
    if url.drivername in {"postgres", "postgresql"}:
        url = url.set(drivername="postgresql+psycopg2")
        if "sslmode" not in url.query:
            url = url.update_query_dict({"sslmode": "require"})
    engine_options = {"pool_pre_ping": True}
    if url.get_backend_name() == "sqlite":
        engine_options["connect_args"] = {"check_same_thread": False}
    ENGINE: Engine = create_engine(url, **engine_options)
else:
    ENGINE = create_engine(
        URL.create("sqlite", database=str(DB_PATH)),
        connect_args={"check_same_thread": False},
    )

METADATA = MetaData()

SESSIONS = Table(
    "sessions",
    METADATA,
    Column("id", String, primary_key=True),
    Column("candidate_name", Text, nullable=False),
    Column("resume_text", Text, nullable=False),
    Column("jd_text", Text, nullable=False),
    Column("created_at", DateTime, nullable=False, server_default=func.current_timestamp()),
    Column("started_at", Float),
    Column("ended_at", Float),
    Column("status", String(32), nullable=False, server_default=text("'not_started'")),
)

TRANSCRIPTS = Table(
    "transcripts",
    METADATA,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("session_id", String, ForeignKey("sessions.id"), nullable=False),
    Column(
        "speaker",
        String(16),
        CheckConstraint("speaker IN ('interviewer', 'candidate')"),
        nullable=False,
    ),
    Column("text", Text, nullable=False),
    Column("timestamp", DateTime, nullable=False, server_default=func.current_timestamp()),
)

SCORECARDS = Table(
    "scorecards",
    METADATA,
    Column("id", String, primary_key=True),
    Column("session_id", String, ForeignKey("sessions.id"), nullable=False, unique=True),
    Column("overall_score", Integer, nullable=False),
    Column("competency_scores_json", Text, nullable=False),
    Column("strengths_json", Text, nullable=False),
    Column("risks_json", Text, nullable=False),
    Column("evidence_quotes_json", Text, nullable=False),
    Column("created_at", DateTime, nullable=False, server_default=func.current_timestamp()),
)


def _record(row) -> dict | None:
    if row is None:
        return None
    result = dict(row)
    for key, value in result.items():
        if isinstance(value, (datetime, date)):
            result[key] = value.isoformat()
    return result


def init_db() -> None:
    with ENGINE.begin() as connection:
        if ENGINE.dialect.name == "postgresql":
            connection.execute(text("SELECT pg_advisory_xact_lock(684213907)"))

        METADATA.create_all(connection)
        session_columns = {
            column["name"] for column in inspect(connection).get_columns("sessions")
        }
        timestamp_type = "DOUBLE PRECISION" if ENGINE.dialect.name == "postgresql" else "REAL"
        migrations = {
            "started_at": f"ALTER TABLE sessions ADD COLUMN started_at {timestamp_type}",
            "ended_at": f"ALTER TABLE sessions ADD COLUMN ended_at {timestamp_type}",
            "status": (
                "ALTER TABLE sessions ADD COLUMN status "
                "VARCHAR(32) NOT NULL DEFAULT 'not_started'"
            ),
        }
        for column_name, statement in migrations.items():
            if column_name not in session_columns:
                connection.execute(text(statement))

        connection.execute(
            text(
                """UPDATE sessions SET status = 'completed'
                   WHERE status = 'not_started' AND EXISTS (
                       SELECT 1 FROM scorecards WHERE scorecards.session_id = sessions.id
                   )"""
            )
        )
        connection.execute(
            text(
                """UPDATE sessions SET status = 'not_completed'
                   WHERE status = 'not_started' AND started_at IS NOT NULL"""
            )
        )


def create_session(session_id: str, candidate_name: str, resume_text: str, jd_text: str) -> None:
    with ENGINE.begin() as connection:
        connection.execute(
            text(
                """INSERT INTO sessions (id, candidate_name, resume_text, jd_text)
                   VALUES (:id, :candidate_name, :resume_text, :jd_text)"""
            ),
            {
                "id": session_id,
                "candidate_name": candidate_name,
                "resume_text": resume_text,
                "jd_text": jd_text,
            },
        )


def get_session(session_id: str) -> dict | None:
    with ENGINE.connect() as connection:
        row = connection.execute(
            text(
                """SELECT id, candidate_name, resume_text, jd_text, created_at,
                          started_at, ended_at, status
                   FROM sessions WHERE id = :session_id"""
            ),
            {"session_id": session_id},
        ).mappings().first()
        return _record(row)


def mark_session_started(session_id: str, started_at: float) -> bool:
    with ENGINE.begin() as connection:
        result = connection.execute(
            text(
                """UPDATE sessions
                   SET started_at = :started_at, ended_at = NULL, status = 'in_progress'
                   WHERE id = :session_id AND status = 'not_started'"""
            ),
            {"started_at": started_at, "session_id": session_id},
        )
        return result.rowcount == 1


def mark_session_not_completed(session_id: str, ended_at: float) -> bool:
    with ENGINE.begin() as connection:
        result = connection.execute(
            text(
                """UPDATE sessions SET ended_at = :ended_at, status = 'not_completed'
                   WHERE id = :session_id AND status IN ('not_started', 'in_progress')"""
            ),
            {"ended_at": ended_at, "session_id": session_id},
        )
        return result.rowcount == 1


def mark_session_completed(session_id: str, ended_at: float) -> bool:
    with ENGINE.begin() as connection:
        result = connection.execute(
            text(
                """UPDATE sessions SET ended_at = :ended_at, status = 'completed'
                   WHERE id = :session_id AND status = 'in_progress'"""
            ),
            {"ended_at": ended_at, "session_id": session_id},
        )
        return result.rowcount == 1


def delete_scorecard(session_id: str) -> None:
    with ENGINE.begin() as connection:
        connection.execute(
            text("DELETE FROM scorecards WHERE session_id = :session_id"),
            {"session_id": session_id},
        )


def get_sessions() -> list[dict]:
    with ENGINE.connect() as connection:
        rows = connection.execute(
            text(
                """SELECT s.id, s.candidate_name, s.created_at, s.started_at, s.ended_at, s.status,
                          COUNT(CASE WHEN t.speaker = 'candidate' THEN 1 END) AS answer_count,
                          sc.overall_score
                   FROM sessions AS s
                   LEFT JOIN transcripts AS t ON t.session_id = s.id
                   LEFT JOIN scorecards AS sc ON sc.session_id = s.id
                   WHERE s.status != 'not_started'
                   GROUP BY s.id
                   ORDER BY s.created_at DESC"""
            )
        ).mappings().all()
        return [_record(row) for row in rows]


def add_transcript(session_id: str, speaker: str, text_value: str) -> None:
    with ENGINE.begin() as connection:
        connection.execute(
            text(
                """INSERT INTO transcripts (session_id, speaker, text)
                   VALUES (:session_id, :speaker, :text)"""
            ),
            {"session_id": session_id, "speaker": speaker, "text": text_value},
        )


def get_transcripts(session_id: str) -> list[dict]:
    with ENGINE.connect() as connection:
        rows = connection.execute(
            text(
                """SELECT speaker, text, timestamp FROM transcripts
                   WHERE session_id = :session_id ORDER BY id ASC"""
            ),
            {"session_id": session_id},
        ).mappings().all()
        return [_record(row) for row in rows]


def get_scorecard(session_id: str) -> dict | None:
    with ENGINE.connect() as connection:
        row = connection.execute(
            text(
                """SELECT overall_score, competency_scores_json, strengths_json,
                          risks_json, evidence_quotes_json, created_at
                   FROM scorecards WHERE session_id = :session_id"""
            ),
            {"session_id": session_id},
        ).mappings().first()
        return _record(row)


def save_scorecard(
    session_id: str,
    scorecard_id: str,
    overall_score: int,
    competency: dict,
    strengths: list,
    risks: list,
    evidence: list,
) -> None:
    with ENGINE.begin() as connection:
        connection.execute(
            text(
                """INSERT INTO scorecards
                       (id, session_id, overall_score, competency_scores_json,
                        strengths_json, risks_json, evidence_quotes_json)
                   VALUES
                       (:id, :session_id, :overall_score, :competency,
                        :strengths, :risks, :evidence)
                   ON CONFLICT (session_id) DO UPDATE SET
                       id = excluded.id,
                       overall_score = excluded.overall_score,
                       competency_scores_json = excluded.competency_scores_json,
                       strengths_json = excluded.strengths_json,
                       risks_json = excluded.risks_json,
                       evidence_quotes_json = excluded.evidence_quotes_json"""
            ),
            {
                "id": scorecard_id,
                "session_id": session_id,
                "overall_score": overall_score,
                "competency": json.dumps(competency),
                "strengths": json.dumps(strengths),
                "risks": json.dumps(risks),
                "evidence": json.dumps(evidence),
            },
        )


if __name__ == "__main__":
    init_db()
    print("Database initialized successfully.")
