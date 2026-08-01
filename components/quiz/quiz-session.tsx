"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useDispatch, useSelector } from "react-redux";

import { Button } from "@/components/ui/button";
import { FORMAT_DESCRIPTIONS } from "@/lib/quiz/plan";
import {
  askedQuestions,
  computeScore,
  evaluationFor,
  isComplete,
  questionNumber,
} from "@/lib/quiz/score";
import type { Material, QuizPlan } from "@/lib/quiz/types";
import { isChoiceFormat } from "@/lib/quiz/types";
import {
  useAskQuestionMutation,
  useEvaluateAnswerMutation,
} from "@/store/quiz-api";
import {
  answerEvaluated,
  materialSet,
  questionPresented,
  sessionReset,
  sessionRestarted,
  type QuizSessionState,
} from "@/store/quiz-slice";
import type { IblaiRootState } from "@/store/iblai-store";
import { AnswerField } from "./answer-field";
import { MarginRail } from "./margin-rail";
import { MaterialForm } from "./material-form";
import { QuizSummary } from "./quiz-summary";

function readIblUsername(): string | undefined {
  try {
    const raw = localStorage.getItem("userData");
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      const nicename = (parsed as { user_nicename?: unknown }).user_nicename;
      if (typeof nicename === "string") return nicename;
    }
  } catch {
    /* a missing or malformed session just means the server falls back */
  }
  return undefined;
}

/** Never resubscribes: `userData` is written once at SSO callback and does not
 *  change for the life of the session. */
const subscribeToNothing = () => () => {};

/**
 * The ibl.ai username, read from the session the SDK already stored. Not a
 * secret — the agent frame is addressed to it, and the route handler needs it.
 *
 * `useSyncExternalStore` rather than useEffect + setState: localStorage is an
 * external store, and reading it in an effect would set state synchronously on
 * mount and cascade a second render. The server snapshot is `undefined`, which
 * is correct — there is no localStorage on the server, and the route handler
 * falls back to IBLAI_USERNAME when the field is absent.
 */
function useIblUsername(): string | undefined {
  return useSyncExternalStore(
    subscribeToNothing,
    readIblUsername,
    () => undefined,
  );
}

export function QuizSession() {
  const dispatch = useDispatch();
  const username = useIblUsername();

  const quiz = useSelector<IblaiRootState, QuizSessionState>(
    (state) => state.quiz,
  );

  const [askQuestion, ask] = useAskQuestionMutation();
  const [evaluateAnswer, evaluation] = useEvaluateAnswerMutation();

  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);

  const score = useMemo(() => computeScore(quiz.evaluations), [quiz.evaluations]);
  const currentEvaluation = evaluationFor(quiz, quiz.current?.id);
  const complete = isComplete(quiz);

  const nextQuestion = useCallback(
    async (material: Material, plan: QuizPlan, asked: readonly string[]) => {
      setError(null);
      setAnswer("");
      try {
        const result = await askQuestion({
          material,
          plan,
          askedQuestions: asked,
          username,
        }).unwrap();
        dispatch(
          questionPresented({
            question: result.question,
            mode: result.mode,
            truncated: result.truncated,
            planLength: result.planLength,
          }),
        );
      } catch {
        setError("I couldn't build a question from that. Try different material.");
      }
    },
    [askQuestion, dispatch, username],
  );

  const handleMaterial = useCallback(
    (material: Material, plan: QuizPlan) => {
      dispatch(materialSet({ material, plan }));
      void nextQuestion(material, plan, []);
    },
    [dispatch, nextQuestion],
  );

  // The dependency lists below name `quiz.material` / `quiz.current` rather
  // than `quiz`, and must keep doing so. `react-hooks/exhaustive-deps` argues
  // for the whole object, but the React Compiler infers the member accesses and
  // fails the build outright when the manual list is broader than what it
  // derived ("Existing memoization could not be preserved"). A warning from one
  // rule beats an error from the other.
  const handleRestart = useCallback(() => {
    if (!quiz.material) return;
    dispatch(sessionRestarted());
    void nextQuestion(quiz.material, quiz.plan, []);
  }, [dispatch, nextQuestion, quiz.material, quiz.plan]);

  const handleCheck = useCallback(async () => {
    if (!quiz.material || !quiz.current) return;
    setError(null);
    try {
      const result = await evaluateAnswer({
        material: quiz.material,
        question: quiz.current,
        answer,
        username,
      }).unwrap();
      dispatch(
        answerEvaluated({ evaluation: result.evaluation, mode: result.mode }),
      );
    } catch {
      setError("That answer didn't get through. Try checking it again.");
    }
  }, [answer, dispatch, evaluateAnswer, quiz.current, quiz.material, username]);

  if (!quiz.material || !quiz.current) {
    return <MaterialForm onSubmit={handleMaterial} pending={ask.isLoading} />;
  }

  if (complete) {
    return (
      <QuizSummary
        title={quiz.material.title || "your material"}
        plan={quiz.plan}
        score={score}
        history={quiz.history}
        evaluations={quiz.evaluations}
        offline={quiz.mode === "offline"}
        onRestart={handleRestart}
        onNewMaterial={() => {
          dispatch(sessionReset());
          setAnswer("");
        }}
      />
    );
  }

  const checking = evaluation.isLoading;
  const answered = Boolean(currentEvaluation);
  const number = questionNumber(quiz);

  // A choice question with nothing selected is not an answer — sending it would
  // spend an agent call to be told "you selected nothing". A written one may be
  // submitted empty; the rubric handles it and the learner may genuinely want
  // to say "I don't know".
  const canCheck =
    !checking && (!isChoiceFormat(quiz.current.format) || answer !== "");

  return (
    <div className="flex flex-col gap-6">
      <header
        className="flex flex-col gap-2 border-b pb-3"
        style={{ borderColor: "var(--sb-rule)" }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            className="text-[length:var(--sb-text-margin)]"
            style={{ color: "var(--sb-margin)" }}
          >
            {quiz.material.title || "Untitled material"}
          </h2>
          <p
            className="text-[length:var(--sb-text-meta)]"
            style={{ fontFamily: "var(--sb-font-meta)", color: "var(--sb-margin)" }}
          >
            question {number} of {quiz.plan.length} ·{" "}
            {FORMAT_DESCRIPTIONS[quiz.current.format].label.toLowerCase()}
          </p>
        </div>

        {/* Progress is measured in answers, not in questions shown — the bar
            should not advance for arriving at a question you have not done. */}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={quiz.plan.length}
          aria-valuenow={score.answered}
          aria-valuetext={`${score.answered} of ${quiz.plan.length} answered`}
          className="h-1 w-full overflow-hidden rounded-full"
          style={{ backgroundColor: "var(--sb-rule)" }}
        >
          <div
            className="h-full transition-[width] duration-300 motion-reduce:transition-none"
            style={{
              width: `${(score.answered / quiz.plan.length) * 100}%`,
              backgroundColor: "var(--sb-mark)",
            }}
          />
        </div>
      </header>

      {quiz.truncated && (
        <p
          className="text-[length:var(--sb-text-margin)]"
          style={{ color: "var(--sb-margin)" }}
        >
          Your material was longer than one session can hold, so questions come
          from the opening section.
        </p>
      )}

      {/* The rail: a real column on wide screens, stacked beneath below 900px
          (lg = 1024px here, close enough and it is the Tailwind breakpoint the
          rest of the app already uses). */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,var(--sb-measure))_var(--sb-rail-width)]">
        <div className="flex flex-col gap-5">
          <h3
            className="text-[length:var(--sb-text-question)] leading-[var(--sb-leading)]"
            // Serif: this came from your document.
            style={{ fontFamily: "var(--sb-font-source)" }}
          >
            {quiz.current.prompt}
          </h3>

          <AnswerField
            question={quiz.current}
            value={answer}
            onChange={setAnswer}
            disabled={answered || checking}
          />

          {error && (
            <p
              role="alert"
              className="text-[length:var(--sb-text-margin)]"
              style={{ color: "var(--sb-query)" }}
            >
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            {!answered ? (
              // The action keeps its name through the flow.
              <Button onClick={() => void handleCheck()} disabled={!canCheck}>
                {checking ? "Checking…" : "Check my answer"}
              </Button>
            ) : (
              <Button
                onClick={() =>
                  void nextQuestion(
                    quiz.material as Material,
                    quiz.plan,
                    askedQuestions(quiz),
                  )
                }
                disabled={ask.isLoading}
              >
                {ask.isLoading ? "Finding one…" : "Next question"}
              </Button>
            )}

            <Button
              variant="ghost"
              onClick={() => {
                dispatch(sessionReset());
                setAnswer("");
              }}
            >
              Use different material
            </Button>
          </div>
        </div>

        <MarginRail
          evaluation={currentEvaluation}
          score={score}
          total={quiz.plan.length}
          pending={checking}
          offline={quiz.mode === "offline"}
        />
      </div>
    </div>
  );
}
