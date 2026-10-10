'use client';

import {
  BarVisualizer,
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  TrackToggle,
  useIsSpeaking,
  useRoomContext,
  useTrackTranscription,
  useTracks,
  useVoiceAssistant,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track } from 'livekit-client';
import Link from 'next/link';
import { Volume2 } from 'lucide-react';
import { Suspense, use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type TokenResponse = {
  token?: unknown;
  serverUrl?: unknown;
};

type SessionStatus = {
  startedAt: number | null;
  elapsedSeconds: number;
  maximumDurationSeconds: number;
  sampledAt: number;
};

const INTERVIEW_EXIT_CONFIRMATION = 'the interview is over. thank you for your time.';

export default function InterviewRoom({ params }: { params: Promise<{ sessionId: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-700">
          Connecting with interviewer…
        </div>
      }
    >
      <InterviewRoomContent params={params} />
    </Suspense>
  );
}

function InterviewRoomContent({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const [token, setToken] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [error, setError] = useState('');
  const [roomError, setRoomError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    async function loadToken() {
      try {
        const query = new URLSearchParams({ room: sessionId });
        const response = await fetch(`/api/token?${query.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          const result: unknown = await response.json();
          const message =
            typeof result === 'object' &&
            result !== null &&
            'error' in result &&
            typeof result.error === 'string'
              ? result.error
              : 'Unable to connect with the interviewer.';
          throw new Error(message);
        }

        const data = (await response.json()) as TokenResponse;
        if (
          typeof data.token !== 'string' ||
          !data.token ||
          typeof data.serverUrl !== 'string' ||
          !data.serverUrl
        ) {
          throw new Error('Unable to connect with the interviewer.');
        }
        setToken(data.token);
        setServerUrl(data.serverUrl);
      } catch {
        if (!controller.signal.aborted) {
          setError('Unable to connect with the interviewer.');
        }
      }
    }

    void loadToken();
    return () => controller.abort();
  }, [sessionId]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-slate-50 p-8 text-center">
        <p role="alert" className="text-lg font-medium text-slate-700">{error}</p>
        <Link href="/" className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500">
          Return to home
        </Link>
      </div>
    );
  }

  if (roomError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-slate-50 p-8 text-center">
        <p role="alert" className="text-lg font-medium text-slate-700">Unable to connect with the interviewer.</p>
        <Link href="/" className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700">
          Return to home
        </Link>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-700">
      Connecting with interviewer…
      </div>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={serverUrl}
      token={token}
      connect
      audio
      onError={() => setRoomError('Unable to connect with the interviewer.')}
      className="w-full min-w-0 max-w-full overflow-x-hidden bg-slate-50 text-slate-900"
    >
      <AudioChamber sessionId={sessionId} />
      <RoomAudioRenderer />
      <StartAudio label="Enable interviewer audio" />
    </LiveKitRoom>
  );
}

function AudioChamber({ sessionId }: { sessionId: string }) {
  const { state, audioTrack } = useVoiceAssistant();
  const room = useRoomContext();
  const isCandidateSpeaking = useIsSpeaking(room.localParticipant);
  const microphoneTracks = useTracks([Track.Source.Microphone]);
  const candidateMicrophone = microphoneTracks.find(
    (track) => track.participant.identity === room.localParticipant.identity,
  );
  const { segments: candidateTranscription } = useTrackTranscription(candidateMicrophone);
  const router = useRouter();
  const [transcripts, setTranscripts] = useState<
    { speaker: string; text: string; timestamp?: string }[]
  >([]);
  const [transcriptError, setTranscriptError] = useState('');
  const [ending, setEnding] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [endError, setEndError] = useState('');
  const [leaveError, setLeaveError] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const autoEndStarted = useRef(false);
  const autoLeaveStarted = useRef(false);
  const agentConfirmedExit = useRef(false);
  const firstTranscriptRequestAt = useRef(Date.now());
  const conversationEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let interval: ReturnType<typeof setInterval>;

    async function loadStatus() {
      try {
        const query = new URLSearchParams({ sessionId });
        const response = await fetch(`/api/session-status?${query.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Unable to check the interview timer.');
        const result: unknown = await response.json();
        if (
          typeof result !== 'object' ||
          result === null ||
          !('startedAt' in result) ||
          !(typeof result.startedAt === 'number' || result.startedAt === null) ||
          !('maximumDurationSeconds' in result) ||
          typeof result.maximumDurationSeconds !== 'number' ||
          !('elapsedSeconds' in result) ||
          typeof result.elapsedSeconds !== 'number'
        ) {
          throw new Error('The interview timer response was invalid.');
        }
        setSessionStatus({
          startedAt: result.startedAt,
          elapsedSeconds: result.elapsedSeconds,
          maximumDurationSeconds: result.maximumDurationSeconds,
          sampledAt: Date.now(),
        });
        setStatusError('');
      } catch (cause) {
        if (!controller.signal.aborted) {
          setStatusError(cause instanceof Error ? cause.message : 'Unable to check the interview timer.');
        }
      }
    }

    void loadStatus();
    interval = setInterval(() => void loadStatus(), 2000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [sessionId]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsedSeconds = sessionStatus
    ? sessionStatus.elapsedSeconds + Math.floor((now - sessionStatus.sampledAt) / 1000)
    : 0;
  const hasCandidateAnswer = transcripts.some((entry) => entry.speaker === 'candidate');
  const latestAnswer = [...transcripts].reverse().find((entry) => entry.speaker === 'candidate');
  const liveAnswer = candidateTranscription
    .filter((segment) => !segment.final)
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ');
  const latestAnswerWasAfterMaximum =
    latestAnswer?.timestamp !== undefined &&
    sessionStatus?.startedAt !== null &&
    sessionStatus !== null &&
    Date.parse(latestAnswer.timestamp) >=
      (sessionStatus.startedAt + sessionStatus.maximumDurationSeconds) * 1000;

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [transcripts, liveAnswer]);

  useEffect(() => {
    const controller = new AbortController();
    let interval: ReturnType<typeof setInterval>;

    async function loadTranscript() {
      try {
        const query = new URLSearchParams({ sessionId });
        const response = await fetch(`/api/transcript?${query.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error('Unable to load interview transcript.');
        }
        const result: unknown = await response.json();
        if (
          typeof result !== 'object' ||
          result === null ||
          !('transcripts' in result) ||
          !Array.isArray(result.transcripts)
        ) {
          throw new Error('The interview transcript response was invalid.');
        }
        const hasOpeningQuestion = result.transcripts.some(
          (entry) =>
            typeof entry === 'object' &&
            entry !== null &&
            'speaker' in entry &&
            entry.speaker === 'interviewer',
        );
        if (!hasOpeningQuestion && Date.now() - firstTranscriptRequestAt.current >= 45_000) {
          setTranscriptError('Unable to connect with the interviewer.');
          return;
        }
        setTranscripts(result.transcripts);
        setTranscriptError('');
      } catch {
        if (!controller.signal.aborted) {
          setTranscriptError('Unable to connect with the interviewer.');
        }
      }
    }

    void loadTranscript();
    interval = setInterval(() => void loadTranscript(), 1500);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [sessionId]);

  async function endInterview(automatic = false) {
    if (!automatic && !hasCandidateAnswer) {
      setEndError('Share an answer with the interviewer before finishing.');
      return;
    }
    setEnding(true);
    setEndError('');

    try {
      const response = await fetch('/api/end-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, automatic }),
      });
      if (!response.ok) {
        const result: unknown = await response.json();
        const message =
          typeof result === 'object' &&
          result !== null &&
          'error' in result &&
          typeof result.error === 'string'
            ? result.error
            : 'Unable to generate your interview scorecard.';
        throw new Error(message);
      }

      const result: unknown = await response.json();
      if (
        automatic &&
        typeof result === 'object' &&
        result !== null &&
        'status' in result &&
        result.status === 'not_completed'
      ) {
        await room.disconnect();
        router.replace('/history');
        return;
      }

      await room.disconnect();
      router.replace(`/scorecard/${encodeURIComponent(sessionId)}`);
    } catch (cause) {
      setEndError(cause instanceof Error ? cause.message : 'Unable to end the interview.');
      setEnding(false);
    }
  }

  async function leaveInterview() {
    if (
      !agentConfirmedExit.current &&
      !window.confirm(
        'Leave this interview? It will be marked Not completed, will not receive a scorecard, and cannot be restarted.',
      )
    ) {
      return;
    }

    agentConfirmedExit.current = false;
    setLeaving(true);
    setLeaveError('');
    try {
      const response = await fetch('/api/leave-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      if (!response.ok) {
        const result: unknown = await response.json();
        const message =
          typeof result === 'object' &&
          result !== null &&
          'error' in result &&
          typeof result.error === 'string'
            ? result.error
            : 'Unable to leave the interview.';
        throw new Error(message);
      }

      await room.disconnect();
      router.replace('/');
    } catch (cause) {
      setLeaveError(cause instanceof Error ? cause.message : 'Unable to leave the interview.');
      setLeaving(false);
    }
  }

  async function enableInterviewerAudio() {
    try {
      await room.startAudio();
      setAudioEnabled(true);
      setAudioError('');
    } catch {
      setAudioError('Unable to enable interviewer audio. Check your device volume and try again.');
    }
  }

  useEffect(() => {
    const durationReached =
      sessionStatus !== null &&
      sessionStatus.startedAt !== null &&
      elapsedSeconds >= sessionStatus.maximumDurationSeconds;
    if (
      durationReached &&
      latestAnswerWasAfterMaximum &&
      !isCandidateSpeaking &&
      state === 'listening' &&
      !autoEndStarted.current &&
      !ending &&
      !leaving &&
      !statusError
    ) {
      autoEndStarted.current = true;
      void endInterview(true);
    }
  }, [
    elapsedSeconds,
    ending,
    isCandidateSpeaking,
    latestAnswerWasAfterMaximum,
    leaving,
    sessionStatus,
    state,
    statusError,
  ]);

  useEffect(() => {
    const interviewerClosedInterview = transcripts.some(
      (entry) =>
        entry.speaker === 'interviewer' &&
        entry.text.toLowerCase().includes(INTERVIEW_EXIT_CONFIRMATION),
    );
    if (
      interviewerClosedInterview &&
      state === 'listening' &&
      !isCandidateSpeaking &&
      !autoLeaveStarted.current &&
      !ending &&
      !leaving
    ) {
      autoLeaveStarted.current = true;
      agentConfirmedExit.current = true;
      void leaveInterview();
    }
  }, [ending, isCandidateSpeaking, leaving, state, transcripts]);

  const stateLabel =
    state === 'speaking'
      ? 'Interviewer speaking'
      : state === 'thinking'
        ? 'Preparing your next question'
        : state === 'listening'
          ? 'Listening to you'
          : 'Connecting with interviewer…';

  return (
    <main className="mx-auto grid w-full min-w-0 max-w-[1600px] grid-cols-1 gap-6 overflow-x-hidden px-4 py-4 sm:px-8 lg:h-[calc(100dvh-4rem)] lg:min-h-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-6 lg:px-8 lg:py-4">
      <section className="flex min-h-[520px] min-w-0 flex-col justify-between rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-6 text-white shadow-xl sm:p-8 lg:min-h-0 lg:p-6">
        <div className="space-y-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-indigo-100">
            <span className={`size-2 rounded-full ${state === 'speaking' ? 'animate-pulse bg-emerald-400' : 'bg-indigo-300'}`} />
            {stateLabel}
          </span>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">AI Technical Interviewer</h1>
          <p className="max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
            Take your time to answer. Your interviewer is listening.
          </p>
        </div>

        <div className="mx-auto flex size-40 shrink-0 items-center justify-center rounded-full border border-indigo-300/20 bg-indigo-400/10 shadow-[0_0_100px_rgba(99,102,241,0.18)] sm:size-44 lg:size-40">
          <div className="flex size-28 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg sm:size-32">
            <span className="text-5xl font-semibold text-white" aria-hidden="true">IA</span>
          </div>
        </div>

        <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-5">
          <p className="mb-4 text-center text-sm font-medium text-slate-300">Live audio</p>
          <div className="h-16 w-full min-w-0">
            <BarVisualizer state={state} barCount={36} trackRef={audioTrack} className="h-full w-full" />
          </div>
        </div>
      </section>

      <aside className="flex min-h-[520px] min-w-0 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8 lg:min-h-0 lg:p-6">
        <div className="shrink-0 border-b border-slate-100 pb-5">
          <p className="text-sm font-semibold uppercase tracking-wider text-indigo-600">Live conversation</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Your interview</h2>
          <p className="mt-2 text-sm text-slate-500">Your full conversation appears here.</p>
        </div>

        {transcriptError ? (
          <div role="alert" className="my-auto rounded-2xl bg-rose-50 p-5 text-center text-sm font-medium text-rose-700">
            Unable to connect with the interviewer.
          </div>
        ) : transcripts.length > 0 || liveAnswer ? (
          <div
            aria-live="polite"
            aria-relevant="additions text"
            className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain py-5 pr-1"
          >
            {transcripts.map((entry, index) => (
              <article
                key={`${entry.speaker}-${index}`}
                className={`max-w-[92%] break-words rounded-2xl p-4 ${
                  entry.speaker === 'candidate'
                    ? 'ml-auto rounded-tr-md bg-slate-100 text-slate-700'
                    : 'mr-auto rounded-tl-md bg-indigo-50 text-slate-800'
                }`}
              >
                <p
                  className={`mb-1 text-xs font-bold uppercase tracking-wider ${
                    entry.speaker === 'candidate' ? 'text-slate-500' : 'text-indigo-600'
                  }`}
                >
                  {entry.speaker === 'candidate' ? 'You' : 'Interviewer'}
                </p>
                <p className="text-sm leading-6 sm:text-base">{entry.text}</p>
              </article>
            ))}
            {liveAnswer && (
              <article className="ml-auto max-w-[92%] break-words rounded-2xl rounded-tr-md border border-indigo-100 bg-slate-100 p-4 text-slate-700">
                <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">You are saying</p>
                <p className="text-sm leading-6 sm:text-base">{liveAnswer}</p>
              </article>
            )}
            <div ref={conversationEndRef} />
          </div>
        ) : (
          <div role="status" className="my-auto rounded-2xl bg-slate-50 p-8 text-center">
            <div className="mx-auto mb-4 size-9 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
            <p className="font-medium text-slate-800">Connecting with interviewer…</p>
            <p className="mt-2 text-sm text-slate-500">Your first question will appear here.</p>
          </div>
        )}

        <div className="mt-auto shrink-0 space-y-4 border-t border-slate-100 pt-5">
          {!audioEnabled && (
            <button
              type="button"
              onClick={() => void enableInterviewerAudio()}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100"
            >
              <Volume2 size={18} aria-hidden="true" />
              Enable interviewer audio
            </button>
          )}
          {audioError && <p role="alert" className="text-center text-sm text-rose-700">{audioError}</p>}
          <div className="flex flex-col gap-3 sm:flex-row">
            <TrackToggle
              source={Track.Source.Microphone}
              disabled={ending || leaving}
              className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Toggle microphone
            </TrackToggle>
            <button
              type="button"
              onClick={() => void endInterview()}
              disabled={ending || leaving || !hasCandidateAnswer}
              className="min-h-12 flex-1 rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {ending ? 'Preparing your scorecard…' : 'Finish interview'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => void leaveInterview()}
            disabled={ending || leaving}
            className="w-full rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {leaving ? 'Leaving interview…' : 'Leave interview'}
          </button>
          {endError && <p role="alert" className="text-center text-sm text-rose-700">{endError}</p>}
          {leaveError && <p role="alert" className="text-center text-sm text-rose-700">{leaveError}</p>}
        </div>
      </aside>
    </main>
  );
}
