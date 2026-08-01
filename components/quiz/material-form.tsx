"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { MIN_USABLE_CHARS, normaliseMaterial } from "@/lib/quiz/context";
import {
  ACCEPTED_EXTENSIONS,
  titleFromFilename,
  validateUpload,
} from "@/lib/quiz/extract";
import {
  FORMAT_DESCRIPTIONS,
  QUIZ_FORMATS,
  maxQuestionsFor,
  offeredLengths,
} from "@/lib/quiz/plan";
import { DEFAULT_PLAN, type Material, type QuizFormat, type QuizPlan } from "@/lib/quiz/types";

/** What the file input advertises. Same list the copy promises and the route
 *  enforces — one source, so the three cannot drift apart. */
const ACCEPT = ACCEPTED_EXTENSIONS.join(",");

/**
 * A group of radio cards.
 *
 * A real `<fieldset>` + `<legend>` + `<input type="radio">` rather than a set of
 * buttons with aria-pressed: the browser then supplies grouping, arrow-key
 * navigation, and a single tab stop for the whole group, and the legend is what
 * a screen reader announces before the options. None of that has to be built,
 * and none of it can be got subtly wrong.
 */
function RadioCards<T extends string | number>({
  legend,
  hint,
  name,
  value,
  options,
  onChange,
  columns,
}: {
  legend: string;
  hint?: string;
  name: string;
  value: T;
  options: readonly { value: T; label: string; hint?: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  columns: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0">
      <legend className="text-[length:var(--sb-text-margin)]">{legend}</legend>
      {hint && (
        <p
          className="text-[length:var(--sb-text-meta)]"
          style={{ fontFamily: "var(--sb-font-meta)", color: "var(--sb-margin)" }}
        >
          {hint}
        </p>
      )}
      <div className={`grid gap-2 ${columns}`}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={String(option.value)}
              className="flex cursor-pointer flex-col gap-1 rounded-[var(--radius)] border px-3 py-2 transition-colors has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2"
              style={{
                borderColor: selected ? "var(--sb-ink)" : "var(--sb-rule)",
                backgroundColor: selected ? "var(--sb-mark-wash)" : "#fff",
                outlineColor: "var(--sb-ink)",
              }}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name={name}
                  value={String(option.value)}
                  checked={selected}
                  disabled={option.disabled}
                  onChange={() => onChange(option.value)}
                  className="sr-only"
                />
                {/* The dot is decorative — the label text and the checked input
                    already carry the state for assistive technology. */}
                <span
                  aria-hidden="true"
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                  style={{ borderColor: selected ? "var(--sb-ink)" : "var(--sb-rule)" }}
                >
                  {selected && (
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: "var(--sb-ink)" }}
                    />
                  )}
                </span>
                <span className="text-[length:var(--sb-text-margin)]">
                  {option.label}
                </span>
              </span>
              {option.hint && (
                <span
                  className="pl-6 text-[length:var(--sb-text-meta)]"
                  style={{ color: "var(--sb-margin)" }}
                >
                  {option.hint}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

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
 *
 * The format and length live here rather than mid-session because changing
 * either half way through would make one score describe two different
 * exercises.
 */
export function MaterialForm({
  onSubmit,
  pending,
}: {
  onSubmit: (material: Material, plan: QuizPlan) => void;
  pending: boolean;
}) {
  const titleId = useId();
  const bodyId = useId();
  const hintId = useId();
  const fileId = useId();
  const fileHintId = useId();
  const formatName = useId();
  const lengthName = useId();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [format, setFormat] = useState<QuizFormat>(DEFAULT_PLAN.format);
  const [length, setLength] = useState<number>(DEFAULT_PLAN.length);

  const fileInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sourceFile, setSourceFile] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const trimmed = body.trim();
  const short = trimmed.length > 0 && trimmed.length < MIN_USABLE_CHARS;

  // Measured the way the server measures it, so the lengths offered here match
  // the ones it will agree to run.
  const usableChars = useMemo(() => normaliseMaterial(body).length, [body]);
  const lengths = useMemo(() => offeredLengths(usableChars), [usableChars]);
  const capacity = maxQuestionsFor(usableChars);

  // Keep the selection valid as the material shrinks: silently running five
  // questions when the learner picked fifteen is the failure this avoids.
  const effectiveLength = lengths.includes(length)
    ? length
    : (lengths[lengths.length - 1] ?? capacity);

  const canSubmit =
    trimmed.length >= MIN_USABLE_CHARS && !pending && reading === null;

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
    // Two columns on wide screens, mirroring the quiz surface below it: the
    // material on the left at the same measure the question will occupy, and
    // the right column carrying the app's side of the exchange — setup now,
    // evaluation once the session starts. Same width as the margin rail, so
    // pressing Start does not reflow the page.
    //
    // Stacking these vertically made the form about 1,360px tall, which is two
    // screens on a laptop; side by side it is roughly 770px, which is one.
    <form
      className="grid gap-6 lg:grid-cols-[minmax(0,var(--sb-measure))_var(--sb-rail-width)] lg:items-start"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          onSubmit({ title, body }, { format, length: effectiveLength });
        }
      }}
    >
      {/* Left: what you want to be quizzed on. */}
      <div className="flex flex-col gap-5">
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
      </div>

      {/* Right: how you want to be asked.
          `sticky` keeps Start reachable while a long document scrolls past —
          the panel is shorter than the material column, so it would otherwise
          leave the viewport. It sticks to `main.overflow-y-auto` in the app
          layout, which is the nearest scrolling ancestor. `self-start` stops
          the grid stretching the item, which would make sticky inert.
          A plain div, not <aside>: this is primary input, not complementary
          content, so it should not become a landmark. */}
      <div
        className="flex flex-col gap-6 border-t pt-6 lg:sticky lg:top-6 lg:self-start lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6"
        style={{ borderColor: "var(--sb-rule)" }}
      >
        <RadioCards
          legend="How should I ask?"
          name={formatName}
          value={format}
          onChange={setFormat}
          columns="grid-cols-1"
          options={QUIZ_FORMATS.map((value) => ({
            value,
            label: FORMAT_DESCRIPTIONS[value].label,
            hint: FORMAT_DESCRIPTIONS[value].hint,
          }))}
        />

        <RadioCards
          legend="How many questions?"
          hint={
            // Say why an option is missing. A silently absent "15" reads as a
            // bug; "your material supports 7" reads as a reason to paste more.
            lengths.length < 3
              ? `This much material supports about ${capacity} questions — paste more for a longer quiz.`
              : undefined
          }
          name={lengthName}
          value={effectiveLength}
          onChange={setLength}
          columns="grid-cols-3"
          options={lengths.map((value) => ({ value, label: `${value}` }))}
        />

        <Button type="submit" disabled={!canSubmit} className="w-full">
          {pending ? "Reading your material…" : "Start quizzing me"}
        </Button>
      </div>
    </form>
  );
}
