"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { MIN_USABLE_CHARS } from "@/lib/quiz/context";
import type { Material } from "@/lib/quiz/types";

/**
 * The empty state.
 *
 * An invitation, not an apology — the copy names what to do and what happens
 * next, rather than explaining that nothing has loaded yet.
 */
export function MaterialForm({
  onSubmit,
  pending,
}: {
  onSubmit: (material: Material) => void;
  pending: boolean;
}) {
  const titleId = useId();
  const bodyId = useId();
  const hintId = useId();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const short = body.trim().length > 0 && body.trim().length < MIN_USABLE_CHARS;
  const canSubmit = body.trim().length >= MIN_USABLE_CHARS && !pending;

  return (
    <form
      className="flex max-w-[var(--sb-measure)] flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit({ title, body });
      }}
    >
      <div className="flex flex-col gap-2">
        <h2
          className="text-[length:var(--sb-text-question)] leading-[var(--sb-leading)]"
          style={{ fontFamily: "var(--sb-font-source)" }}
        >
          Paste your notes. I&rsquo;ll build questions from what&rsquo;s in it.
        </h2>
        <p
          className="text-[length:var(--sb-text-margin)]"
          style={{ color: "var(--sb-margin)" }}
        >
          Lecture notes, a textbook chapter, an article — anything you want to be
          asked about.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={titleId} className="text-[length:var(--sb-text-margin)]">
          What is this? <span style={{ color: "var(--sb-margin)" }}>(optional)</span>
        </label>
        <input
          id={titleId}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Organic Chemistry — Ch. 7"
          className="rounded-[var(--radius)] border px-3 py-2 text-[length:var(--sb-text-body)]"
          style={{ borderColor: "var(--sb-rule)", backgroundColor: "#fff" }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={bodyId} className="text-[length:var(--sb-text-margin)]">
          Your material
        </label>
        <textarea
          id={bodyId}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={12}
          required
          aria-describedby={hintId}
          // Source material is set in the serif — it came from the document.
          className="resize-y rounded-[var(--radius)] border px-3 py-2 text-[length:var(--sb-text-body)] leading-[var(--sb-leading)]"
          style={{
            borderColor: short ? "var(--sb-query)" : "var(--sb-rule)",
            backgroundColor: "#fff",
            fontFamily: "var(--sb-font-source)",
          }}
        />
        <p
          id={hintId}
          className="text-[length:var(--sb-text-margin)]"
          style={{ color: short ? "var(--sb-query)" : "var(--sb-margin)" }}
        >
          {short
            ? `That's a bit short to build questions from — paste at least ${MIN_USABLE_CHARS} characters.`
            : `At least ${MIN_USABLE_CHARS} characters. A few paragraphs is plenty.`}
        </p>
      </div>

      <div>
        <Button type="submit" disabled={!canSubmit}>
          {pending ? "Reading your material…" : "Start quizzing me"}
        </Button>
      </div>
    </form>
  );
}
