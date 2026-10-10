'use client';

import {
  BarVisualizer,
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  TrackToggle,
  useRoomContext,
  useVoiceAssistant,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track } from 'livekit-client';
import Link from 'next/link';
import { Suspense, use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type TokenResponse = {
  token?: unknown;
  serverUrl?: unknown;
};

type SessionStatus = {
  startedAt: number | null;
  elapsedSeconds: number;
  minimumDurationSeconds: number;
  sampledAt: number;
};

export default function InterviewRoom({ params }: { params: Promise<{ sessionId: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-900 text-white">
          Connecting to Interview Agent...
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
              : 'Unable to get an interview room token.';
          throw new Error(message);
        }

        const data = (await response.json()) as TokenResponse;
        if (
          typeof data.token !== 'string' ||
          !data.token ||
          typeof data.serverUrl !== 'string' ||
          !data.serverUrl
        ) {
          throw new Error('The interview room response was incomplete.');
        }
        setToken(data.token);
        setServerUrl(data.serverUrl);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Unable to connect to the interview room.');
        }
      }
    }

    void loadToken();
    return () => controller.abort();
  }, [sessionId]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-slate-900 p-8 text-center">
        <p role="alert" className="text-red-300">{error}</p>
        <Link href="/" className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500">
          Return to home
        </Link>
      </div>
    );
  }

  if (roomError) {
    return (
      <div role="alert" className="flex min-h-screen items-center justify-center bg-slate-900 p-8 text-center text-red-300">
        LiveKit connection failed: {roomError}
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-white">
        Connecting to Interview Agent...
      </div>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={serverUrl}
      token={token}
      connect
      audio
      onError={(cause) => setRoomError(cause.message)}
      className="flex min-h-screen flex-col items-center justify-center bg-slate-900 p-8 text-white"
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
  const router = useRouter();
  const [transcripts, setTranscripts] = useState<{ speaker: string; text: string }[]>([]);
  const [transcriptError, setTranscriptError] = useState('');
  const [ending, setEnding] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [endError, setEndError] = useState('');
  const [leaveError, setLeaveError] = useState('');
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [now, setNow] = useState(() => Date.now());

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
          !('minimumDurationSeconds' in result) ||
          typeof result.minimumDurationSeconds !== 'number' ||
          !('elapsedSeconds' in result) ||
          typeof result.elapsedSeconds !== 'number'
        ) {
          throw new Error('The interview timer response was invalid.');
        }
        setSessionStatus({
          startedAt: result.startedAt,
          elapsedSeconds: result.elapsedSeconds,
          minimumDurationSeconds: result.minimumDurationSeconds,
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
    interval = setInterval(() => void loadStatus(), 5000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [sessionId]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const remainingSeconds =
    sessionStatus?.startedAt === null || sessionStatus === null
      ? sessionStatus?.minimumDurationSeconds ?? 600
      : Math.max(
          0,
          sessionStatus.minimumDurationSeconds -
            (sessionStatus.elapsedSeconds +
              Math.floor((now - sessionStatus.sampledAt) / 1000)),
        );
  const canEndInterview = sessionStatus?.startedAt !== null && remainingSeconds === 0;

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
        setTranscripts(result.transcripts);
        setTranscriptError('');
      } catch (cause) {
        if (!controller.signal.aborted) {
          setTranscriptError(cause instanceof Error ? cause.message : 'Unable to load interview transcript.');
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

  async function endInterview() {
    if (!canEndInterview) {
      setEndError('The interview needs to run for at least 10 minutes before it can end.');
      return;
    }
    setEnding(true);
    setEndError('');

    try {
      const response = await fetch('/api/end-session', {
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
            : 'Unable to generate your interview scorecard.';
        throw new Error(message);
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
      !window.confirm(
        'Leave this interview? It will be marked Not completed, will not receive a scorecard, and cannot be restarted.',
      )
    ) {
      return;
    }

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

  return (
    <div className="flex w-full max-w-xl flex-col items-center space-y-8">
      <div className="space-y-2 text-center">
        <span className="rounded-full bg-blue-500/20 px-3 py-1 text-sm font-medium uppercase tracking-wider text-blue-400">
          {state}
        </span>
        <h2 className="text-2xl font-semibold">AI Technical Interviewer</h2>
      </div>

      <div className="flex h-32 w-full items-center justify-center rounded-xl bg-slate-800 p-4">
        <BarVisualizer
          state={state}
          barCount={15}
          trackRef={audioTrack}
          className="h-full w-full"
        />
      </div>

      <div className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-5 py-4 text-center">
        {statusError ? (
          <p role="alert" className="text-sm text-red-300">{statusError}</p>
        ) : !sessionStatus?.startedAt ? (
          <p className="text-sm text-slate-300">Starting your 10-minute interview timer…</p>
        ) : remainingSeconds > 0 ? (
          <>
            <p className="text-sm font-medium text-slate-200">Minimum interview time remaining</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-white">
              {String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:{String(remainingSeconds % 60).padStart(2, '0')}
            </p>
            <p className="mt-1 text-xs text-slate-400">Your interviewer will continue with tailored follow-up questions.</p>
          </>
        ) : (
          <p className="text-sm font-medium text-emerald-300">10-minute minimum reached. You can finish when you’re ready.</p>
        )}
      </div>

      <div
        aria-live="polite"
        aria-relevant="additions text"
        className="max-h-72 w-full space-y-4 overflow-y-auto rounded-xl bg-slate-800 p-5"
      >
        <h3 className="font-semibold text-slate-100">Live interview</h3>
        {transcriptError ? (
          <p role="alert" className="text-sm text-red-300">{transcriptError}</p>
        ) : transcripts.length === 0 ? (
          <p className="text-sm text-slate-300">
            Waiting for the AI interviewer to start. If no question appears shortly, check the backend worker logs.
          </p>
        ) : (
          transcripts.map((entry, index) => (
            <p
              key={`${index}-${entry.speaker}`}
              className={entry.speaker === 'interviewer' ? 'text-blue-200' : 'text-slate-200'}
            >
              <span className="mr-2 font-semibold">
                {entry.speaker === 'interviewer' ? 'Interviewer:' : 'You:'}
              </span>
              {entry.text}
            </p>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-4">
        <TrackToggle
          source={Track.Source.Microphone}
          disabled={ending || leaving}
          className="rounded-md bg-slate-700 px-5 py-2 font-medium text-white transition-colors hover:bg-slate-600"
        >
          Toggle microphone
        </TrackToggle>
        <button
          type="button"
          onClick={() => void endInterview()}
          disabled={ending || leaving || !canEndInterview || Boolean(statusError)}
          className="rounded-md bg-red-600 px-6 py-2 font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {ending ? 'Generating scorecard…' : remainingSeconds > 0 ? 'Finish available after 10 minutes' : 'End interview & view scorecard'}
        </button>
        <button
          type="button"
          onClick={() => void leaveInterview()}
          disabled={ending || leaving}
          className="rounded-md border border-slate-500 px-5 py-2 font-medium text-slate-200 transition-colors hover:border-red-400 hover:bg-red-950/40 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {leaving ? 'Leaving interview…' : 'Leave interview'}
        </button>
      </div>
      <p className="text-center text-xs text-slate-400">
        Leaving marks this interview Not completed. It cannot be restarted and won’t have a scorecard.
      </p>
      {endError && (
        <p role="alert" className="text-center text-sm text-red-300">
          {endError}
        </p>
      )}
      {leaveError && (
        <p role="alert" className="text-center text-sm text-red-300">
          {leaveError}
        </p>
      )}
    </div>
  );
}
