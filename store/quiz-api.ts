/**
 * RTK Query slice for the quiz backend.
 *
 * Redux Toolkit is already a peer dependency of the ibl.ai SDK, so the store
 * exists — adding a slice works with the grain of the stack rather than
 * bringing a second state library alongside it.
 *
 * Everything here targets our own /api/quiz route handler, never ibl.ai
 * directly. The browser has no agent token and no prompt text.
 */

import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

import type { Evaluation, Material, Question } from "@/lib/quiz/types";

/** Which agent produced a reply. Mirrors the route handler's contract. */
export type AgentMode = "live" | "offline";

export interface AskRequest {
  readonly material: Material;
  readonly askedPrompts: readonly string[];
  readonly username?: string;
}

export interface AskResponse {
  readonly mode: AgentMode;
  readonly truncated: boolean;
  readonly question: Question;
}

export interface EvaluateRequest {
  readonly material: Material;
  readonly question: Question;
  readonly answer: string;
  readonly username?: string;
}

export interface EvaluateResponse {
  readonly mode: AgentMode;
  readonly truncated: boolean;
  readonly evaluation: Evaluation;
}

export const quizApi = createApi({
  reducerPath: "quizApi",
  baseQuery: fetchBaseQuery({ baseUrl: "/api" }),
  endpoints: (builder) => ({
    askQuestion: builder.mutation<AskResponse, AskRequest>({
      query: (body) => ({
        url: "/quiz",
        method: "POST",
        body: { action: "ask", ...body },
      }),
    }),
    evaluateAnswer: builder.mutation<EvaluateResponse, EvaluateRequest>({
      query: (body) => ({
        url: "/quiz",
        method: "POST",
        body: { action: "evaluate", ...body },
      }),
    }),
  }),
});

export const { useAskQuestionMutation, useEvaluateAnswerMutation } = quizApi;
