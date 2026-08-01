import type { Evaluation, Score } from "@/lib/quiz/types";
import { VerdictBadge } from "./verdict";

/**
 * The margin rail.
 *
 * All system feedback lives in a physical margin column, never inline with the
 * question — the way a tutor's pen lands in the margin of a returned essay. You
 * answer in the main column; the evaluation, the citation and the score appear
 * beside it.
 *
 * Below 900px it collapses BENEATH the question rather than disappearing, still
 * set in slate against a hairline rule, so annotation still reads as annotation.
 * That is handled by the parent's grid; this component only owns its contents.
 */
export function MarginRail({
  evaluation,
  score,
  total,
  pending,
  offline,
}: {
  evaluation: Evaluation | undefined;
  score: Score;
  /** Questions in the planned run, so the tally reads as progress toward an
   *  end rather than as an open-ended count. */
  total: number;
  pending: boolean;
  offline: boolean;
}) {
  return (
    // aria-live so the evaluation is announced when it arrives — a sighted user
    // sees it appear in the margin; a screen reader user would otherwise have
    // to go hunting for it.
    <aside
      aria-label="Feedback and score"
      aria-live="polite"
      aria-busy={pending}
      className="flex flex-col gap-5 border-t pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6"
      style={{ borderColor: "var(--sb-rule)" }}
    >
      <ScoreLine score={score} total={total} />

      {pending && (
        <p
          className="text-[length:var(--sb-text-margin)]"
          style={{ color: "var(--sb-margin)" }}
        >
          Reading your answer…
        </p>
      )}

      {!pending && evaluation && (
        <div className="sb-annotation-enter flex flex-col gap-3">
          <VerdictBadge verdict={evaluation.verdict} />

          <p
            className="text-[length:var(--sb-text-margin)] leading-[var(--sb-leading)]"
            style={{ color: "var(--sb-margin)" }}
          >
            {evaluation.explanation}
          </p>

          {evaluation.sourceRef && (
            <div
              className="flex flex-col gap-1 border-t pt-3"
              style={{ borderColor: "var(--sb-rule)" }}
            >
              <span
                className="text-[length:var(--sb-text-meta)] uppercase tracking-wide"
                style={{ fontFamily: "var(--sb-font-meta)", color: "var(--sb-margin)" }}
              >
                source
              </span>
              <span
                className="text-[length:var(--sb-text-meta)]"
                style={{ fontFamily: "var(--sb-font-meta)", color: "var(--sb-ink)" }}
              >
                {evaluation.sourceRef.locator}
              </span>
              {evaluation.sourceRef.quote && (
                <blockquote
                  className="mt-1 border-l-2 pl-2 text-[length:var(--sb-text-margin)] italic"
                  style={{
                    borderColor: "var(--sb-mark)",
                    color: "var(--sb-margin)",
                    fontFamily: "var(--sb-font-source)",
                  }}
                >
                  {evaluation.sourceRef.quote}
                </blockquote>
              )}
            </div>
          )}
        </div>
      )}

      {!pending && !evaluation && (
        <p
          className="text-[length:var(--sb-text-margin)]"
          style={{ color: "var(--sb-margin)" }}
        >
          Your evaluation will appear here once you check an answer.
        </p>
      )}

      {offline && <OfflineNotice />}
    </aside>
  );
}

function ScoreLine({ score, total }: { score: Score; total: number }) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="text-[length:var(--sb-text-meta)] uppercase tracking-wide"
        style={{ fontFamily: "var(--sb-font-meta)", color: "var(--sb-margin)" }}
      >
        score
      </span>
      <span
        className="text-[length:var(--sb-text-meta)]"
        style={{ fontFamily: "var(--sb-font-meta)", color: "var(--sb-ink)" }}
      >
        {score.correct} correct · {score.partial} nearly · {score.revisit} to revisit
        <span className="sr-only">
          {` out of ${score.answered} answered, in a quiz of ${total}`}
        </span>
      </span>
      <span
        className="text-[length:var(--sb-text-meta)]"
        style={{ fontFamily: "var(--sb-font-meta)", color: "var(--sb-margin)" }}
        aria-hidden="true"
      >
        {score.answered} of {total} answered
      </span>
    </div>
  );
}

/**
 * Stub grading must never be mistaken for real evaluation, so it is labelled
 * wherever it appears rather than only in the README.
 */
function OfflineNotice() {
  return (
    <p
      className="border-t pt-3 text-[length:var(--sb-text-meta)] leading-[var(--sb-leading)]"
      style={{ borderColor: "var(--sb-rule)", color: "var(--sb-margin)" }}
    >
      <strong style={{ color: "var(--sb-ink)" }}>Offline practice mode.</strong>{" "}
      The ibl.ai platform has no credit balance, so answers are graded by keyword
      overlap with the source passage rather than by the agent.
    </p>
  );
}
