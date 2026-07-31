import type { Metadata } from "next";

import { QuizSession } from "@/components/quiz/quiz-session";

export const metadata: Metadata = {
  title: "Quiz — StudyBuddy",
  description: "Upload your course material and get quizzed on it.",
};

/**
 * The quiz page.
 *
 * A server component: the page shell, heading and metadata render on the
 * server, and only the interactive session below is a client component. Server
 * components are the default here, client ones the exception.
 *
 * `data-sb-surface` opts this subtree into the StudyBuddy token system. Outside
 * it — the navbar and the SDK's own pages — ibl.ai's brand styling is untouched.
 */
export default function QuizPage() {
  return (
    <div data-sb-surface className="min-h-full">
      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-5 py-10">
        <header className="flex flex-col gap-1">
          <h1 className="text-[length:var(--sb-text-question)] font-semibold">
            StudyBuddy
          </h1>
          <p
            className="text-[length:var(--sb-text-margin)]"
            style={{ color: "var(--sb-margin)" }}
          >
            Upload or paste something you&rsquo;re revising, and answer questions
            on it.
          </p>
        </header>

        <QuizSession />
      </main>
    </div>
  );
}
