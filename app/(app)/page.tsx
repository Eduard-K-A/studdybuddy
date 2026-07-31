import Link from "next/link";

/**
 * StudyBuddy landing.
 *
 * Replaces the vibe-starter placeholder, which still said "Welcome to ibl.ai —
 * add features with the ibl.ai CLI" and linked to the CLI repo. On the deployed
 * origin that left a visitor with no route into the product at all.
 *
 * Server component: there is nothing interactive here, so nothing ships to the
 * client. It is also the LCP element, so it stays deliberately light — no hero
 * image, no gradient text, no client JS.
 */
export default function Home() {
  return (
    <main
      data-sb-surface
      className="flex min-h-full flex-col items-center justify-center px-6 py-16"
    >
      <div className="w-full max-w-[34rem] space-y-8">
        <div className="space-y-3">
          <p
            className="text-[0.8125rem] uppercase tracking-[0.14em]"
            style={{ color: "var(--sb-margin)", fontFamily: "var(--sb-font-meta)" }}
          >
            StudyBuddy
          </p>
          <h1
            className="text-3xl leading-tight sm:text-4xl"
            style={{ fontFamily: "var(--sb-font-source)", color: "var(--sb-ink)" }}
          >
            Upload what you&rsquo;re revising. Get quizzed on it.
          </h1>
          <p
            className="text-base leading-relaxed"
            style={{ color: "var(--sb-margin)" }}
          >
            One question at a time, drawn from your own material — with the
            evaluation and the source citation set in the margin, the way a
            tutor&rsquo;s pen lands beside a returned essay.
          </p>
        </div>

        <div
          className="border-t pt-8"
          style={{ borderColor: "var(--sb-rule)" }}
        >
          <Link
            href="/quiz"
            className="inline-flex items-center rounded-md px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
            style={{
              backgroundColor: "var(--sb-ink)",
              color: "var(--sb-paper)",
            }}
          >
            Start a quiz
          </Link>
          <p className="mt-3 text-sm" style={{ color: "var(--sb-margin)" }}>
            Bring a PDF, a Word document, or a few paragraphs of lecture notes.
            Paste it if you&rsquo;d rather.
          </p>
        </div>

        <p
          className="text-[0.8125rem]"
          style={{ color: "var(--sb-margin)", fontFamily: "var(--sb-font-meta)" }}
        >
          Built on the ibl.ai platform
        </p>
      </div>
    </main>
  );
}
