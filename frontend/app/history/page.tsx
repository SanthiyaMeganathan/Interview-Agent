'use client';

import { ArrowRight, Clock3 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type InterviewSummary = {
  id: string;
  candidate_name: string;
  created_at: string;
  started_at: number | null;
  ended_at: number | null;
  answer_count: number;
  overall_score: number | null;
  status: string;
};

export default function InterviewHistoryPage() {
  const [sessions, setSessions] = useState<InterviewSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/sessions', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load your interview history.');
        return (await response.json()) as { sessions: InterviewSummary[] };
      })
      .then((result) => setSessions(result.sessions.filter((session) => session.status !== 'not_started')))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load your interview history.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 sm:px-8 sm:py-12">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-indigo-700">Your progress</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Past interviews</h1>
          <p className="mt-2 text-slate-600">Review completed scorecards and interviews you chose to leave.</p>
        </div>
        <Link href="/interview/new" className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700">
          Start an interview <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>
      ) : loading ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">Loading your interviews…</p>
      ) : sessions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center">
          <Clock3 className="mx-auto text-slate-400" size={26} aria-hidden="true" />
          <h2 className="mt-3 font-semibold">Your history starts here</h2>
          <p className="mt-1 text-sm text-slate-500">Completed scorecards and interviews you chose to leave will show up here.</p>
          <Link href="/interview/new" className="mt-5 inline-flex font-semibold text-indigo-700 hover:text-indigo-900">Set up an interview</Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {sessions.map((session) => {
            const date = new Date(session.created_at.replace(' ', 'T') + 'Z');
            const completed = session.status === 'completed' && session.overall_score !== null;
            const notCompleted = session.status === 'not_completed';
            const statusLabel = completed
              ? 'Scorecard ready'
              : notCompleted
                ? 'Not completed'
                : 'In progress';
            return (
              <article key={session.id} className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 p-5 last:border-b-0">
                <div>
                  <h2 className="font-semibold text-slate-900">{session.candidate_name}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                    {' · '}{session.answer_count} candidate answers
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    {completed ? (
                      <p className="font-semibold text-slate-900">{session.overall_score}<span className="font-normal text-slate-500"> / 100</span></p>
                    ) : (
                      <p className={`text-sm font-medium ${notCompleted ? 'text-slate-600' : 'text-amber-700'}`}>{statusLabel}</p>
                    )}
                    <p className="text-xs text-slate-500">{statusLabel}</p>
                  </div>
                  {completed ? (
                    <Link
                      href={`/scorecard/${encodeURIComponent(session.id)}`}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700"
                    >
                      View scorecard <ArrowRight size={15} aria-hidden="true" />
                    </Link>
                  ) : (
                    <span className="px-3 py-2 text-xs font-medium text-slate-500">
                      {notCompleted ? 'Cannot be restarted' : 'Interview in progress'}
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
