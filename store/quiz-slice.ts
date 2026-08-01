/**
 * Session state for one study run.
 *
 * The reducers here are thin wrappers over the pure functions in lib/quiz —
 * the arithmetic lives there so it can be tested without a store, and this file
 * only wires it to Redux. Keeping score logic out of the reducer is what lets
 * `pnpm test` cover it directly.
 */

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import { applyEvaluation, presentQuestion } from "@/lib/quiz/score";
import {
  emptyQuizState,
  type Evaluation,
  type Material,
  type Question,
  type QuizPlan,
  type QuizState,
} from "@/lib/quiz/types";
import type { AgentMode } from "./quiz-api";

export interface QuizSessionState extends QuizState {
  /** Which agent answered most recently, so the UI can label offline runs. */
  readonly mode: AgentMode | null;
  /** True when the material was cut to fit the context budget. */
  readonly truncated: boolean;
}

const initialState: QuizSessionState = {
  ...emptyQuizState,
  mode: null,
  truncated: false,
};

const quizSlice = createSlice({
  name: "quiz",
  initialState,
  reducers: {
    /** Start a run: new material, new plan, everything else cleared. */
    materialSet(
      state,
      action: PayloadAction<{ material: Material; plan: QuizPlan }>,
    ) {
      // New material means a new session — carrying the old score across would
      // mix results from two different documents.
      return {
        ...initialState,
        material: action.payload.material,
        plan: action.payload.plan,
      };
    },

    /** Run the same material again from zero. Keeps the plan, drops the score —
     *  a second attempt is a fresh result, not an improvement to the first. */
    sessionRestarted(state) {
      return { ...initialState, material: state.material, plan: state.plan };
    },

    questionPresented(
      state,
      action: PayloadAction<{
        question: Question;
        mode: AgentMode;
        truncated: boolean;
        /** What the server clamped the plan to. */
        planLength: number;
      }>,
    ) {
      const next = presentQuestion(state, action.payload.question);
      return {
        ...next,
        // The server has the final say on length: it clamps to what the excerpt
        // can actually carry, so a plan asking for more silently running short
        // would be worse than correcting it here.
        plan:
          action.payload.planLength > 0 &&
          action.payload.planLength !== state.plan.length
            ? { ...state.plan, length: action.payload.planLength }
            : state.plan,
        mode: action.payload.mode,
        truncated: action.payload.truncated,
      };
    },

    answerEvaluated(
      state,
      action: PayloadAction<{ evaluation: Evaluation; mode: AgentMode }>,
    ) {
      const next = applyEvaluation(state, action.payload.evaluation);
      return { ...next, mode: action.payload.mode, truncated: state.truncated };
    },

    sessionReset() {
      return initialState;
    },
  },
});

export const {
  materialSet,
  sessionRestarted,
  questionPresented,
  answerEvaluated,
  sessionReset,
} = quizSlice.actions;

export const quizReducer = quizSlice.reducer;
