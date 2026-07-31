"use client";

import { useCallback, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { MIN_USABLE_CHARS } from "@/lib/quiz/context";
import {
  ACCEPTED_EXTENSIONS,
  titleFromFilename,
  validateUpload,
} from "@/lib/quiz/extract";
import type { Material } from "@/lib/quiz/types";

/** What the file input advertises. Same list the copy promises and the route
 *  enforces — one source, so the three cannot drift apart. */
const ACCEPT = ACCEPTED_EXTENSIONS.join(",");

/**
 * The empty state.
 *
 * An invitation, not an apology — the copy names what to do and what happens
 * next, rather than explaining that nothing has loaded yet.
 *
 * Two ways in, one destination: an uploaded file is extracted server-side and
 * its text lands in the same textarea a paste would. The learner can then trim
 * it before starting, which matters because only the first ~12,000 characters
 * reach the agent — better they choose the section than we do.
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
  const fileId = useId();
  const fileHintId = useId();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const fileInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sourceFile, setSourceFile] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const short = body.trim().length > 0 && body.trim().length < MIN_USABLE_CHARS;
  const canSubmit =
    body.trim().length >= MIN_USABLE_CHARS && !pending && reading === null;

  const readFile = useCallback(async (file: File) => {
    setUploadError(null);

    // Check what can be checked here before spending a round trip on it — the
    // same rules the route applies, from the same module, so the two answers
    // cannot disagree.
    const invalid = validateUpload({ name: file.name, size: file.size });
    if (invalid) {
      setUploadError(invalid);
      return;
    }

    setReading(file.name);
    try {
      const form = new FormData();
      form.append("file", file);

      const response = await fetch("/api/quiz/extract", {
        method: "POST",
        body: form,
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          typeof (payload as { error?: unknown }).error === "string"
            ? (payload as { error: string }).error
            : "That file couldn't be read. Try pasting the text instead.";
        setUploadError(message);
        return;
      }

      const { body: extracted } = payload as { title: string; body: string };
      setBody(extracted);
      setSourceFile(file.name);
      // Never overwrite a title the learner typed themselves.
      setTitle((current) => current.trim() || titleFromFilename(file.name));
    } catch {
      setUploadError(
        "That file didn't reach the server. Check your connection and try again.",
      );
    } finally {
      setReading(null);
      // Clear the input so re-picking the same file still fires a change event.
      if (fileInput.current) fileInput.current.value = "";
    }
  }, []);

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
          Paste your notes or drop a PDF. I&rsquo;ll build questions from
          what&rsquo;s in it.
        </h2>
        <p
          className="text-[length:var(--sb-text-margin)]"
          style={{ color: "var(--sb-margin)" }}
        >
          Lecture notes, a textbook chapter, an article — anything you want to be
          asked about.
        </p>
      </div>

      {/* Dragging is a convenience layered over a real file input, not a
          replacement for it: a drop target is invisible to a screen reader and
          unreachable by keyboard, so the labelled input below is the control
          that actually has to work. */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const dropped = event.dataTransfer.files[0];
          if (dropped) void readFile(dropped);
        }}
        className="flex flex-col gap-2 rounded-[var(--radius)] border border-dashed px-4 py-4 transition-colors"
        style={{
          borderColor: dragging ? "var(--sb-ink)" : "var(--sb-rule)",
          backgroundColor: dragging ? "var(--sb-mark-wash)" : "transparent",
        }}
      >
        <label htmlFor={fileId} className="text-[length:var(--sb-text-margin)]">
          Upload a file{" "}
          <span style={{ color: "var(--sb-margin)" }}>— or drag one here</span>
        </label>
        <input
          ref={fileInput}
          id={fileId}
          type="file"
          accept={ACCEPT}
          disabled={reading !== null}
          aria-describedby={fileHintId}
          onChange={(event) => {
            const picked = event.target.files?.[0];
            if (picked) void readFile(picked);
          }}
          className="text-[length:var(--sb-text-margin)] file:mr-3 file:rounded-[var(--radius)] file:border file:px-3 file:py-1.5 file:text-[length:var(--sb-text-margin)] disabled:opacity-60"
          style={{ color: "var(--sb-margin)" }}
        />
        {/* aria-live: extraction is asynchronous and its result changes the
            textarea below, which a screen reader user would otherwise not be
            told about. */}
        <p
          id={fileHintId}
          aria-live="polite"
          className="text-[length:var(--sb-text-meta)]"
          style={{ fontFamily: "var(--sb-font-meta)", color: "var(--sb-margin)" }}
        >
          {reading
            ? `Reading ${reading}…`
            : sourceFile
              ? `From ${sourceFile} — edit it below before you start.`
              : "PDF, Word (.docx), or plain text. Scanned pages won't work yet."}
        </p>
        {uploadError && (
          <p
            role="alert"
            className="text-[length:var(--sb-text-margin)]"
            style={{ color: "var(--sb-query)" }}
          >
            {uploadError}
          </p>
        )}
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
          onChange={(e) => {
            setBody(e.target.value);
            // Once it has been edited by hand the filename no longer describes
            // what is in the box.
            if (sourceFile) setSourceFile(null);
          }}
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
