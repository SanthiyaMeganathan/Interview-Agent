'use client';

import { Suspense, use, useEffect, useState } from 'react';

type Scorecard = {
  overall_score: number;
  competency_scores: Record<string, number>;
  strengths: string[];
  risks: string[];
  evidence_quotes: string[];
};

type ScorecardResponse = {
  overall_score?: unknown;
  competency_scores_json?: unknown;
  strengths_json?: unknown;
  risks_json?: unknown;
  evidence_quotes_json?: unknown;
};

function parseStringArray(value: unknown, field: string): string[] {
  if (typeof value !== 'string') {
    throw new Error(`The scorecard is missing ${field}.`);
  }

  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error(`The scorecard contains invalid ${field}.`);
  }
  return parsed;
}

function parseCompetencyScores(value: unknown): Record<string, number> {
  if (typeof value !== 'string') {
    throw new Error('The scorecard is missing competency scores.');
  }

  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    !Object.values(parsed).every((score) => typeof score === 'number' && Number.isFinite(score))
  ) {
    throw new Error('The scorecard contains invalid competency scores.');
  }

  return parsed as Record<string, number>;
}

function parseScorecard(value: unknown): Scorecard {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The scorecard response was invalid.');
  }

  const response = value as ScorecardResponse;
  if (typeof response.overall_score !== 'number' || !Number.isFinite(response.overall_score)) {
    throw new Error('The scorecard is missing a valid overall score.');
  }

  return {
    overall_score: response.overall_score,
    competency_scores: parseCompetencyScores(response.competency_scores_json),
    strengths: parseStringArray(response.strengths_json, 'strengths'),
    risks: parseStringArray(response.risks_json, 'risks'),
    evidence_quotes: parseStringArray(response.evidence_quotes_json, 'evidence quotes'),
  };
}

export default function ScorecardPage({ params }: { params: Promise<{ sessionId: string }> }) {
  return (
    <Suspense fallback={<div className="p-8 text-center">Loading Performance Scorecard...</div>}>
      <ScorecardContent params={params} />
    </Suspense>
  );
}

function ScorecardContent({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const [data, setData] = useState<Scorecard | null>(null);
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    async function loadScorecard() {
      try {
        const query = new URLSearchParams({ sessionId });
        for (let attempt = 0; attempt < 30; attempt += 1) {
          const response = await fetch(`/api/scorecard?${query.toString()}`, {
            signal: controller.signal,
          });

          if (response.status === 202) {
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(resolve, 2000);
              controller.signal.addEventListener(
                'abort',
                () => {
                  clearTimeout(timeout);
                  reject(new DOMException('Aborted', 'AbortError'));
                },
                { once: true },
              );
            });
            continue;
          }

          if (!response.ok) {
            const result: unknown = await response.json();
            const message =
              typeof result === 'object' &&
              result !== null &&
              'error' in result &&
              typeof result.error === 'string'
                ? result.error
                : 'Unable to load the interview scorecard.';
            throw new Error(message);
          }

          const result: unknown = await response.json();
          setData(parseScorecard(result));
          setWaiting(false);
          return;
        }

        throw new Error('The scorecard is taking longer than expected. Please refresh this page to check again.');
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Unable to load the interview scorecard.');
          setWaiting(false);
        }
      }
    }

    void loadScorecard();
    return () => controller.abort();
  }, [sessionId]);

  if (error) {
    return (
      <main className="mx-auto max-w-4xl p-8 text-center text-red-700" role="alert">
        {error}
      </main>
    );
  }

  if (!data) {
    return <div className="p-8 text-center">{waiting ? 'Generating your interview scorecard...' : 'Loading Performance Scorecard...'}</div>;
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <h1 className="text-3xl font-bold">Interview Scorecard</h1>
        <div className="text-right">
          <span className="text-4xl font-extrabold text-blue-600">{data.overall_score}</span>
          <span className="font-medium text-slate-500"> / 100 Match Score</span>
        </div>
      </div>

      <section aria-labelledby="competency-heading">
        <h2 id="competency-heading" className="mb-3 text-xl font-bold text-slate-800">
          Competency Scores
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {Object.entries(data.competency_scores).map(([competency, score]) => (
            <div key={competency} className="rounded-lg border bg-white p-4">
              <div className="mb-2 flex items-center justify-between gap-4">
                <h3 className="font-medium text-slate-700">{competency}</h3>
                <span className="font-bold text-blue-700">{score} / 10</span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-slate-200"
                role="progressbar"
                aria-label={`${competency} score`}
                aria-valuemin={0}
                aria-valuemax={10}
                aria-valuenow={Math.max(0, Math.min(score, 10))}
              >
                <div
                  className="h-full rounded-full bg-blue-600"
                  style={{ width: `${Math.max(0, Math.min(score * 10, 100))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 sm:grid-cols-2">
        <section className="rounded-lg border border-green-200 bg-green-50 p-4">
          <h2 className="mb-2 font-bold text-green-800">Key Strengths</h2>
          <ul className="list-disc space-y-1 pl-5 text-green-700">
            {data.strengths.map((strength, index) => (
              <li key={`${strength}-${index}`}>{strength}</li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-red-200 bg-red-50 p-4">
          <h2 className="mb-2 font-bold text-red-800">Technical Risks</h2>
          <ul className="list-disc space-y-1 pl-5 text-red-700">
            {data.risks.map((risk, index) => (
              <li key={`${risk}-${index}`}>{risk}</li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-lg border bg-slate-50 p-4">
        <h2 className="mb-2 font-bold text-slate-800">Direct Evidence Quotes</h2>
        <div className="space-y-2">
          {data.evidence_quotes.map((quote, index) => (
            <blockquote
              key={`${quote}-${index}`}
              className="border-l-4 border-blue-500 pl-3 italic text-slate-600"
            >
              “{quote}”
            </blockquote>
          ))}
        </div>
      </section>
    </main>
  );
}
