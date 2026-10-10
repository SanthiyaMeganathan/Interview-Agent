'use client';

import { ArrowRight, Clock3, FileText, Mic2, Trophy } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
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

export default function HomePage() {
  const [recent, setRecent] = useState<InterviewSummary[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/sessions', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load your recent interviews.');
        return (await response.json()) as { sessions: InterviewSummary[] };
      })
      .then((result) => {
        setRecent(
          result.sessions
            .filter((session) => session.status === 'completed' && session.overall_score !== null)
            .slice(0, 3),
        );
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Unable to load your recent interviews.');
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-10 px-5 py-8 sm:px-8 sm:py-12">
      <section className="relative overflow-hidden rounded-3xl bg-slate-950 px-6 py-10 text-white sm:px-10 sm:py-14">
        <div className="absolute -right-16 -top-24 size-72 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="relative max-w-2xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-indigo-300">
            Your interview practice space
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            Build confidence, one interview at a time.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-slate-300">
            Have a real-time voice conversation, get thoughtful technical follow-ups, and turn each practice session into a clear plan for improvement.
          </p>
          <Link
            href="/interview/new"
            className="mt-7 inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-5 py-3 font-semibold text-white transition hover:bg-indigo-400"
          >
            Start an interview <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section aria-labelledby="quick-actions" className="space-y-4">
        <div>
          <h2 id="quick-actions" className="text-xl font-semibold tracking-tight">Your workspace</h2>
          <p className="mt-1 text-sm text-slate-500">Everything you need to practice and keep track of your progress.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <ActionCard
            href="/interview/new"
            title="Take an interview"
            description="Upload your resume and practice for a role you want."
            icon={<Mic2 size={20} aria-hidden="true" />}
          />
          <ActionCard
            href="/history"
            title="Past interviews"
            description="Revisit previous sessions, transcripts, and scorecards."
            icon={<FileText size={20} aria-hidden="true" />}
          />
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <span className="flex size-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
              <Trophy size={20} aria-hidden="true" />
            </span>
            <h3 className="mt-4 font-semibold">Keep improving</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Each interview includes a scorecard with strengths, risks, and evidence from your answers.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="recent-heading" className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="recent-heading" className="text-xl font-semibold tracking-tight">Recent interviews</h2>
            <p className="mt-1 text-sm text-slate-500">Your latest completed interviews and scorecards.</p>
          </div>
          <Link href="/history" className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-700 hover:text-indigo-900">
            View all <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        {error ? (
          <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>
        ) : recent.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center">
            <Clock3 className="mx-auto text-slate-400" size={24} aria-hidden="true" />
            <p className="mt-3 font-medium text-slate-700">No interviews yet</p>
            <p className="mt-1 text-sm text-slate-500">Completed interviews and scorecards will appear here.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {recent.map((interview) => (
              <InterviewRow key={interview.id} interview={interview} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function ActionCard({
  href,
  title,
  description,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <Link href={href} className="group rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md">
      <span className="flex size-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">{icon}</span>
      <h3 className="mt-4 flex items-center gap-2 font-semibold">
        {title}<ArrowRight size={16} className="text-slate-400 transition group-hover:translate-x-1 group-hover:text-indigo-600" aria-hidden="true" />
      </h3>
      <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
    </Link>
  );
}

function InterviewRow({ interview }: { interview: InterviewSummary }) {
  const date = new Date(interview.created_at.replace(' ', 'T') + 'Z');
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:px-5">
      <div>
        <h3 className="font-medium text-slate-900">{interview.candidate_name}</h3>
        <p className="mt-1 text-sm text-slate-500">{date.toLocaleDateString()} · {interview.answer_count} answers</p>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="font-semibold text-slate-900">{interview.overall_score}<span className="font-normal text-slate-500"> / 100</span></p>
          <p className="text-xs text-slate-500">Scorecard ready</p>
        </div>
        <Link
          href={`/scorecard/${encodeURIComponent(interview.id)}`}
          className="rounded-lg border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50"
          aria-label="View scorecard"
        >
          <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
