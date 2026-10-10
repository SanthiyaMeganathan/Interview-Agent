import json
import os
from typing import Annotated, TypedDict, List
from langchain_core.messages import BaseMessage, SystemMessage, AIMessage
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langchain_groq import ChatGroq
from db import MIN_INTERVIEW_SECONDS

class InterviewState(TypedDict):
    messages: Annotated[List[BaseMessage], add_messages]
    session_id: str
    resume_text: str
    jd_text: str
    current_topic: str
    topics_covered: List[str]
    topics_remaining: List[str]
    depth_counter: int
    is_completed: bool
    elapsed_seconds: int

llm = ChatGroq(
    model="openai/gpt-oss-120b",
    temperature=0.2,
    api_key=os.environ.get("GROQ_API_KEY")
)

def clean_json_response(text: str) -> object:
    """Helper to strip markdown backticks before parsing JSON."""
    clean = text.strip()
    if clean.startswith("```"):
        clean = clean.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    return json.loads(clean)

def initialize_topics_node(state: InterviewState) -> dict:
    prompt = f"""
    Analyze the resume and job description below. Extract six distinct interview topics.
    Include role-specific technical skills, project experience, and problem solving.
    Return ONLY a JSON array of strings.

    RESUME:
    {state['resume_text']}

    JOB DESCRIPTION:
    {state['jd_text']}
    """
    response = llm.invoke([SystemMessage(content=prompt)])
    try:
        topics = clean_json_response(response.content)
        if not isinstance(topics, list):
            raise ValueError("The topic response must be a JSON array.")
        topics = [topic.strip() for topic in topics if isinstance(topic, str) and topic.strip()]
        if not topics:
            raise ValueError("The topic response did not include usable topics.")
    except Exception:
        topics = [
            "Technical Experience",
            "System Architecture",
            "Problem Solving",
            "Project Ownership",
            "Technical Trade-offs",
            "Collaboration and Communication",
        ]
    
    first_topic = topics[0] if topics else "General Background"
    remaining = topics[1:] if len(topics) > 1 else []

    initial_greeting = f"Hello! Thanks for joining today. To get started, let's talk about {first_topic}. Can you summarize your experience in this area?"

    return {
        "current_topic": first_topic,
        "topics_remaining": remaining,
        "topics_covered": [],
        "depth_counter": 0,
        "is_completed": False,
        "messages": [AIMessage(content=initial_greeting)]
    }

def interviewer_node(state: InterviewState) -> dict:
    if state.get("is_completed", False):
        return {"messages": [AIMessage(content="Thank you for your time. The interview is complete. Have a great day!")]}

    messages = state["messages"]
    last_candidate_msg = messages[-1].content if messages else ""
    depth = state.get("depth_counter", 0)
    curr_topic = state["current_topic"]
    topics_rem = list(state["topics_remaining"])
    topics_cov = list(state["topics_covered"])

    eval_prompt = f"""
    Topic: {curr_topic}
    Candidate Response: "{last_candidate_msg}"
    Current Depth Counter: {depth}/2

    Ask one concise, relevant follow-up question that probes the candidate's reasoning,
    concrete actions, or measurable outcome. Avoid repeating the original question.

    Respond with only the question, without JSON or markdown.
    """

    res = llm.invoke([SystemMessage(content=eval_prompt)])
    question = res.content.strip() if isinstance(res.content, str) else ""

    if depth < 2:
        if not question:
            question = f"What specific example best demonstrates your experience with {curr_topic}?"
        return {
            "depth_counter": depth + 1,
            "messages": [AIMessage(content=question)]
        }

    topics_cov.append(curr_topic)
    if topics_rem:
        next_topic = topics_rem.pop(0)
        transition = (
            f"Thank you. Let's move on to {next_topic}. "
            f"How have you applied or approached this in your work?"
        )
        return {
            "current_topic": next_topic,
            "topics_remaining": topics_rem,
            "topics_covered": topics_cov,
            "depth_counter": 0,
            "messages": [AIMessage(content=transition)]
        }

    if state.get("elapsed_seconds", 0) < MIN_INTERVIEW_SECONDS:
        deep_dive_prompt = f"""
        The candidate has discussed these topics: {", ".join(topics_cov)}.
        Their latest answer was: "{last_candidate_msg}"
        Ask one new, specific technical deep-dive question grounded in the resume,
        job description, or their answer. Do not repeat an earlier topic question.
        Return only the question.
        """
        deep_dive = llm.invoke([SystemMessage(content=deep_dive_prompt)]).content
        question = deep_dive.strip() if isinstance(deep_dive, str) else ""
        if not question:
            question = "What is a challenging technical decision you made, and how did you validate the outcome?"
        return {
            "current_topic": "Technical deep dive",
            "topics_covered": topics_cov,
            "depth_counter": 0,
            "messages": [AIMessage(content=question)]
        }

    return {
        "topics_covered": topics_cov,
        "is_completed": True,
        "messages": [AIMessage(content="That covers the interview. Thank you for sharing your experience!")]
    }

def build_interview_graph():
    workflow = StateGraph(InterviewState)
    workflow.add_node("init", initialize_topics_node)
    workflow.add_node("interviewer", interviewer_node)

    workflow.add_conditional_edges(
        "__start__",
        lambda state: "interviewer" if state.get("current_topic") else "init",
        {"init": "init", "interviewer": "interviewer"},
    )
    workflow.add_edge("init", END)
    workflow.add_edge("interviewer", END)
    return workflow.compile()