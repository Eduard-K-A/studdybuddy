"use client";

import { useId } from "react";

import type { Question } from "@/lib/quiz/types";
import { isChoiceFormat } from "@/lib/quiz/types";

/**
 * The answer control for whichever format the current question took.
 *
 * One component rather than a branch inside the session, because the shapes are
 * genuinely different — a radio group and a textarea have different labelling,
 * different keyboard behaviour and different disabled semantics — and because
 * this is the file to open when a new format is added.
 *
 * `value` is an option id for choice questions and free text for written ones.
 * The route handler resolves the id back to its wording before the agent sees
 * it, so the browser never has to send the option text back.
 */
export function AnswerField({
  question,
  value,
  onChange,
  disabled,
}: {
  question: Question;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const fieldId = useId();
  const name = useId();
  const hintId = useId();

  if (isChoiceFormat(question.format) && question.options?.length) {
    return (
      <fieldset className="flex flex-col gap-2 border-0 p-0" disabled={disabled}>
        <legend className="text-[length:var(--sb-text-margin)]">
          {question.format === "true-false" ? "True or false?" : "Your answer"}
        </legend>

        <div className="flex flex-col gap-2">
          {question.options.map((option) => {
            const selected = option.id === value;
            return (
              <label
                key={option.id}
                className="flex cursor-pointer items-start gap-3 rounded-[var(--radius)] border px-3 py-2.5 transition-colors has-[:disabled]:cursor-default has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2"
                style={{
                  borderColor: selected ? "var(--sb-ink)" : "var(--sb-rule)",
                  backgroundColor: selected ? "var(--sb-mark-wash)" : "#fff",
                  outlineColor: "var(--sb-ink)",
                }}
              >
                <input
                  type="radio"
                  name={name}
                  value={option.id}
                  checked={selected}
                  onChange={() => onChange(option.id)}
                  className="sr-only"
                />
                {/* Decorative: the checked radio above already carries state. */}
                <span
                  aria-hidden="true"
                  className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                  style={{
                    borderColor: selected ? "var(--sb-ink)" : "var(--sb-rule)",
                  }}
                >
                  {selected && (
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: "var(--sb-ink)" }}
                    />
                  )}
                </span>
                {/* Options are quoted from the learner's material, so they are
                    set in the serif alongside the question rather than in the
                    UI sans. */}
                <span
                  className="text-[length:var(--sb-text-body)] leading-[var(--sb-leading)]"
                  style={{ fontFamily: "var(--sb-font-source)" }}
                >
                  {option.text}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  const essay = question.format === "essay";

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId} className="text-[length:var(--sb-text-margin)]">
        Your answer
      </label>
      <textarea
        id={fieldId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={essay ? 12 : 6}
        disabled={disabled}
        aria-describedby={hintId}
        className="resize-y rounded-[var(--radius)] border px-3 py-2 text-[length:var(--sb-text-body)] leading-[var(--sb-leading)] disabled:opacity-70"
        style={{ borderColor: "var(--sb-rule)", backgroundColor: "#fff" }}
      />
      <p
        id={hintId}
        className="text-[length:var(--sb-text-meta)]"
        style={{ fontFamily: "var(--sb-font-meta)", color: "var(--sb-margin)" }}
      >
        {essay
          ? "A developed paragraph — connect at least two ideas from the material."
          : "Two or three sentences, in your own words."}
      </p>
    </div>
  );
}
