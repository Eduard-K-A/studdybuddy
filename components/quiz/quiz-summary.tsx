"use client";

import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { FORMAT_DESCRIPTIONS } from "@/lib/quiz/plan";
import type { Evaluation, Question, QuizPlan, Score } from "@/lib/quiz/types";
import { VERDICT_PRESENTATION, VerdictBadge } from "./verdict";

/**
 * The end of a run.
 *
 * A quiz that never ends has no result — the score is a running tally the
 * learner is expected to interpret. Ending on a fixed count turns it into
 * something they can act on: what to revisit, and what they had right.
 *
 * The review list is the point of this screen, not the percentage. It is
 * ordered as asked rather than worst-first, because the learner remembers the
 * session in order and reordering it makes the list hard to place.
 */
export function QuizSummary({
  title,
  plan,
  score,
  history,
  evaluations,
  offline,
  onRestart,
  onNewMaterial,
}: {
  title: string;
  plan: QuizPlan;
  score: Score;
  history: readonly Question[];
  evaluations: readonly Evaluation[];
  offline: boolean;
  onRestart: () => void;
  onNewMaterial: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);

  // The question the learner was reading has just been replaced by a different
  // screen. Sighted users see that; without moving focus, a screen reader user
  // is left on a control that no longer exists and gets no announcement that
  // the session ended.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const percentage = Math.round(score.ratio * 100);
  const toRevisit = evaluations.filter((e) => e.verdict === "revisit").length;

  return (
    <section className="flex max-w-[var(--sb-measure)] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2
          ref={heading}
          tabIndex={-1}
          className="text-[length:var(--sb-text-question)] leading-[var(--sb-leading)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
          style={{
            fontFamily: "var(--sb-font-source)",
            outlineColor: "var(--sb-ink)",
          }}
        >
          That&rsquo;s {plan.length} questions on {title}.
        </h2>
        <p
          className="text-[length:var(--sb-text-margin)]"
          style={{ color: "var(--sb-margin)" }}
        >
          {toRevisit === 0
            ? "Nothing flagged to revisit — try a longer run or different material."
            : `${toRevisit} ${toRevisit === 1 ? "answer" : "answers"} worth going back to, listed below.`}
        </p>
      </div>

      {/* The headline number, in mono with the rest of the metadata — a score is
          data about the session, not the session speaking. */}
      <dl
        className="grid grid-cols-2 gap-x-6 gap-y-3 border-y py-4 sm:grid-cols-4"
        style={{ borderColor: "var(--sb-rule)" }}
      >
        <Stat label="score" value={`${percentage}%`} emphasis />
        <Stat label="correct" value={String(score.correct)} />
        <Stat label="nearly" value={String(score.partial)} />
        <Stat label="to revisit" value={String(score.revisit)} />
      </dl>

      <div className="flex flex-col gap-3">
        <h3
          className="text-[length:var(--sb-text-margin)] font-semibold"
          style={{ color: "var(--sb-ink)" }}
        >
          What you were asked
        </h3>

        <ol className="flex flex-col gap-4">
          {history.map((question, index) => {
            const evaluation = evaluations.find((e) => e.questionId === question.id);
            if (!evaluation) return null;

            return (
              <li
                key={question.id}
                className="flex flex-col gap-2 border-l-2 pl-3"
                style={{
                  borderColor: VERDICT_PRESENTATION[evaluation.verdict].tone,
                }}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span
                    className="text-[length:var(--sb-text-meta)] uppercase tracking-wide"
                    style={{
                      fontFamily: "var(--sb-font-meta)",
                      color: "var(--sb-margin)",
                    }}
                  >
                    {index + 1} · {FORMAT_DESCRIPTIONS[question.format].label}
                  </span>
                  <VerdictBadge verdict={evaluation.verdict} />
                </div>

                <p
                  className="text-[length:var(--sb-text-body)] leading-[var(--sb-leading)]"
                  style={{ fontFamily: "var(--sb-font-source)" }}
                >
                  {question.prompt}
                </p>

                <p
                  className="text-[length:var(--sb-text-margin)] leading-[var(--sb-leading)]"
                  style={{ color: "var(--sb-margin)" }}
                >
                  {evaluation.explanation}
                </p>
              </li>
            );
          })}
        </ol>
      </div>

      {offline && (
        <p
          className="border-t pt-3 text-[length:var(--sb-text-meta)] leading-[var(--sb-leading)]"
          style={{ borderColor: "var(--sb-rule)", color: "var(--sb-margin)" }}
        >
          <strong style={{ color: "var(--sb-ink)" }}>Offline practice mode.</strong>{" "}
          This run was graded by matching against the source text rather than by
          the agent, so treat the score as practice rather than assessment.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button onClick={onRestart}>Run it again</Button>
        <Button variant="ghost" onClick={onNewMaterial}>
          Use different material
        </Button>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt
        className="text-[length:var(--sb-text-meta)] uppercase tracking-wide"
        style={{ fontFamily: "var(--sb-font-meta)", color: "var(--sb-margin)" }}
      >
        {label}
      </dt>
      <dd
        className={emphasis ? "text-[length:var(--sb-text-question)]" : "text-[length:var(--sb-text-body)]"}
        style={{ fontFamily: "var(--sb-font-meta)", color: "var(--sb-ink)" }}
      >
        {value}
      </dd>
    </div>
  );
}
