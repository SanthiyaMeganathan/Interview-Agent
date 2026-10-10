'use client';

import { ArrowLeft, FileText, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const MAX_RESUME_SIZE = 8 * 1024 * 1024;

function readPdfAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read this PDF file.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Unable to read this PDF file.'));
        return;
      }
      resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

export default function NewInterviewPage() {
  const [name, setName] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [resume, setResume] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleStart() {
    if (!resume) {
      setError('Upload your resume as a PDF to continue.');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const resumePdfBase64 = await readPdfAsBase64(resume);
      const response = await fetch('/api/start-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate_name: name,
          resume_pdf_base64: resumePdfBase64,
          jd_text: jobDescription,
        }),
      });

      let result: unknown = null;
      try {
        result = await response.json();
      } catch {
        // Proxies can return a plain-text error when the API is unavailable.
      }
      if (!response.ok) {
        const message =
          typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
            ? result.error
            : 'Unable to start your interview right now. Please try again.';
        throw new Error(message);
      }
      if (typeof result !== 'object' || result === null || !('sessionId' in result) || typeof result.sessionId !== 'string') {
        throw new Error('Unable to start your interview right now. Please try again.');
      }
      router.push(`/interview/${encodeURIComponent(result.sessionId)}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(
        message === 'Failed to fetch'
          ? 'Unable to connect to the interview service. Please try again.'
          : message || 'Unable to start your interview right now. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8 sm:px-8 sm:py-12">
      <Link href="/" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-indigo-700">
        <ArrowLeft size={16} aria-hidden="true" /> Back to home
      </Link>
      <div className="mb-7">
        <p className="text-sm font-semibold uppercase tracking-wider text-indigo-700">New practice session</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Set up your interview</h1>
        <p className="mt-2 leading-6 text-slate-600">Share your resume and target role so the interviewer can tailor its questions to you.</p>
      </div>

      <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <div>
          <label htmlFor="candidate-name" className="mb-2 block text-sm font-semibold text-slate-800">Your name</label>
          <input
            id="candidate-name"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Alex Morgan"
            autoComplete="name"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-800" htmlFor="resume-pdf">Resume PDF</label>
          <input
            ref={fileInput}
            id="resume-pdf"
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setError('');
              if (file && (!file.name.toLowerCase().endsWith('.pdf') || file.size > MAX_RESUME_SIZE)) {
                setResume(null);
                setError(file.size > MAX_RESUME_SIZE ? 'Choose a PDF smaller than 8 MB.' : 'Please select a PDF resume.');
                event.target.value = '';
                return;
              }
              setResume(file);
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-7 text-center transition hover:border-indigo-400 hover:bg-indigo-50/50"
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-white text-indigo-700 shadow-sm">
              {resume ? <FileText size={21} aria-hidden="true" /> : <Upload size={21} aria-hidden="true" />}
            </span>
            <span className="mt-3 font-medium text-slate-800">{resume ? resume.name : 'Choose a PDF resume'}</span>
            <span className="mt-1 text-sm text-slate-500">{resume ? `${(resume.size / (1024 * 1024)).toFixed(1)} MB` : 'Text-based PDF · up to 8 MB'}</span>
          </button>
          <p className="mt-2 text-xs leading-5 text-slate-500">Your PDF text is used to personalize questions; image-only/scanned documents may not be readable.</p>
        </div>

        <div>
          <label htmlFor="job-description" className="mb-2 block text-sm font-semibold text-slate-800">Job description</label>
          <textarea
            id="job-description"
            className="min-h-36 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            value={jobDescription}
            onChange={(event) => setJobDescription(event.target.value)}
            placeholder="Paste the role requirements or describe the position you are preparing for..."
          />
        </div>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <button
          type="button"
          onClick={() => void handleStart()}
          disabled={loading || !name.trim() || !jobDescription.trim() || !resume}
          className="w-full rounded-xl bg-indigo-600 px-5 py-3.5 font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Preparing your interview…' : 'Start interview'}
        </button>
        <p className="text-center text-xs text-slate-500">Your interviewer will guide the conversation based on your experience.</p>
      </div>
    </main>
  );
}
