import asyncio
import logging
import time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).with_name(".env"))

from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli, inference
from livekit.plugins import deepgram, cartesia, silero
from langchain_core.messages import HumanMessage
from graph import build_interview_graph
from db import add_transcript, get_session, init_db, mark_session_not_completed, mark_session_started

init_db()
logger = logging.getLogger(__name__)

async def entrypoint(ctx: JobContext):
    await ctx.connect()

    session_id = ctx.room.name
    session_data = get_session(session_id)

    if not session_data:
        raise RuntimeError(f"No interview session exists for LiveKit room {session_id}.")
    if session_data["status"] != "not_started":
        raise RuntimeError(f"Interview session {session_id} has already been started or left.")

    started_at = time.time()
    if not mark_session_started(session_id, started_at):
        raise RuntimeError(f"Interview session {session_id} is no longer available.")

    session_closed = False

    @ctx.room.on("disconnected")
    def on_disconnect():
        nonlocal session_closed
        session_closed = True
        mark_session_not_completed(session_id, time.time())
        print(f"Room {session_id} was left. No scorecard will be generated.")

    @ctx.room.on("participant_disconnected")
    def on_participant_disconnect(participant):
        nonlocal session_closed
        if participant.identity != f"candidate-{session_id}":
            return

        session_closed = True
        mark_session_not_completed(session_id, time.time())
        logger.info(
            "Candidate left interview %s; marking it not completed.",
            session_id,
        )
        ctx.shutdown("candidate left the interview")

    resume = session_data["resume_text"]
    jd = session_data["jd_text"]

    graph_app = build_interview_graph()
    graph_state = {
        "session_id": session_id,
        "resume_text": resume,
        "jd_text": jd,
        "messages": [],
        "topics_covered": [],
        "topics_remaining": [],
        "depth_counter": 0,
        "is_completed": False,
        "elapsed_seconds": 0,
        "pending_exit_reason": False,
        "exit_requested": False,
        "off_topic_count": 0,
    }

    graph_state["elapsed_seconds"] = int(time.time() - started_at)
    graph_state = await asyncio.to_thread(graph_app.invoke, graph_state)
    if session_closed:
        return
    initial_greeting = graph_state["messages"][-1].content
    add_transcript(session_id, "interviewer", initial_greeting)

    class Interviewer(Agent):
        def __init__(self) -> None:
            super().__init__(instructions="Conduct the interview using the supplied interview graph.")
            self.state = graph_state

        async def on_user_turn_completed(self, turn_ctx, new_message) -> None:
            candidate_text = new_message.text_content
            if not candidate_text:
                return

            logger.info(
                "Received completed candidate turn for session %s (%d characters).",
                session_id,
                len(candidate_text),
            )
            add_transcript(session_id, "candidate", candidate_text)
            self.state["messages"].append(HumanMessage(content=candidate_text))
            self.state["elapsed_seconds"] = int(time.time() - started_at)
            self.state = await asyncio.to_thread(graph_app.invoke, self.state)

            reply = self.state["messages"][-1].content
            if not isinstance(reply, str):
                reply = str(reply)
            logger.info("Speaking interviewer turn for session %s.", session_id)
            try:
                await self.session.say(reply, allow_interruptions=False).wait_for_playout()
            except Exception:
                logger.exception("Interviewer speech playback failed for session %s.", session_id)
                raise
            add_transcript(session_id, "interviewer", reply)

    assistant = AgentSession(
        stt=deepgram.STT(),
        vad=silero.VAD.load(min_silence_duration=0.9, max_buffered_speech=120.0),
        llm=None,
        tts=cartesia.TTS(),
        turn_detection=inference.TurnDetector(version="v1-mini"),
        min_endpointing_delay=0.9,
        max_endpointing_delay=4.0,
        min_interruption_duration=0.6,
        min_interruption_words=2,
        false_interruption_timeout=2.0,
    )
    await assistant.start(Interviewer(), room=ctx.room)
    await assistant.say(initial_greeting, allow_interruptions=False).wait_for_playout()

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))