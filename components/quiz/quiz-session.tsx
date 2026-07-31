"use client";

import {
  useCallback,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useDispatch, useSelector } from "react-redux";

import { Button } from "@/components/ui/button";
import { computeScore, evaluationFor } from "@/lib/quiz/score";
import type { Material } from "@/lib/quiz/types";
import {
  useAskQuestionMutation,
  useEvaluateAnswerMutation,
} from "@/store/quiz-api";
import {
  answerEvaluated,
  materialSet,
  questionPresented,
  sessionReset,
  type QuizSessionState,
} from "@/store/quiz-slice";
import type { IblaiRootState } from "@/store/iblai-store";
import { MarginRail } from "./margin-rail";
import { MaterialForm } from "./material-form";

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
  const answerId = useId();
  const username = useIblUsername();

  const quiz = useSelector<IblaiRootState, QuizSessionState>(
    (state) => state.quiz,
  );

  const [askQuestion, ask] = useAskQuestionMutation();
  const [evaluateAnswer, evaluation] = useEvaluateAnswerMutation();

  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);

  const askedPrompts = useMemo(
    () => quiz.evaluations.map((e) => e.questionId),
    [quiz.evaluations],
  );

  const score = useMemo(() => computeScore(quiz.evaluations), [quiz.evaluations]);
  const currentEvaluation = evaluationFor(quiz, quiz.current?.id);

  const nextQuestion = useCallback(
    async (material: Material, asked: readonly string[]) => {
      setError(null);
      setAnswer("");
      try {
        const result = await askQuestion({
          material,
          askedPrompts: asked,
          username,
        }).unwrap();
        dispatch(
          questionPresented({
            question: result.question,
            mode: result.mode,
            truncated: result.truncated,
          }),
        );
      } catch {
        setError("I couldn't build a question from that. Try different material.");
      }
    },
    [askQuestion, dispatch, username],
  );

  const handleMaterial = useCallback(
    (material: Material) => {
      dispatch(materialSet(material));
      void nextQuestion(material, []);
    },
    [dispatch, nextQuestion],
  );

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
    return (
      <MaterialForm
        onSubmit={handleMaterial}
        pending={ask.isLoading}
      />
    );
  }

  const checking = evaluation.isLoading;
  const answered = Boolean(currentEvaluation);

  return (
    <div className="flex flex-col gap-6">
      <header
        className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3"
        style={{ borderColor: "var(--sb-rule)" }}
      >
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
          question {quiz.asked}
        </p>
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

          <div className="flex flex-col gap-2">
            <label
              htmlFor={answerId}
              className="text-[length:var(--sb-text-margin)]"
            >
              Your answer
            </label>
            <textarea
              id={answerId}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={6}
              disabled={answered || checking}
              className="resize-y rounded-[var(--radius)] border px-3 py-2 text-[length:var(--sb-text-body)] leading-[var(--sb-leading)] disabled:opacity-70"
              style={{ borderColor: "var(--sb-rule)", backgroundColor: "#fff" }}
            />
          </div>

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
              <Button onClick={() => void handleCheck()} disabled={checking}>
                {checking ? "Checking…" : "Check my answer"}
              </Button>
            ) : (
              <Button
                onClick={() =>
                  void nextQuestion(quiz.material as Material, askedPrompts)
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
          pending={checking}
          offline={quiz.mode === "offline"}
        />
      </div>
    </div>
  );
}
