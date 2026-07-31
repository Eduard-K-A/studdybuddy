/**
 * Turning an uploaded file into material the quiz can use.
 *
 * Everything here is pure — no `File`, no filesystem, no parser. The route
 * handler owns the bytes and the PDF/DOCX libraries; this module owns the
 * decisions, so the rules that actually bite (what is accepted, how big is too
 * big, what a scanned PDF looks like) are testable without fixtures.
 *
 * Parsing runs on the server on purpose. Doing it in the browser would mean
 * shipping PDF.js to every visitor, and the deployed bundle is already 2.1 MB
 * with a 14.9 s LCP — see the README's performance section. The server also
 * gives one honest failure path instead of one per browser.
 */

/** What we can pull text out of, by extension. */
export type UploadKind = "pdf" | "docx" | "text";

/**
 * Vercel caps a serverless request body at 4.5 MB, so anything near that fails
 * at the platform with an opaque error rather than ours. Staying well under it
 * means the learner gets our message instead.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** For the file input's `accept` and for the copy that lists them. */
export const ACCEPTED_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  ".markdown",
] as const;

/**
 * A PDF that parses to almost nothing is a scanned image, not an empty
 * document. Below this we say so specifically rather than reporting "no text".
 */
const SCANNED_PDF_CHARS = 120;

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

/**
 * Decide by extension rather than by the browser-supplied MIME type: `type` is
 * empty on plenty of real uploads (notably drag-and-drop from some file
 * managers) and is trivially spoofed. The extension is what the user sees, so a
 * mismatch is at least explicable to them.
 */
export function detectKind(filename: string): UploadKind | null {
  switch (extensionOf(filename)) {
    case ".pdf":
      return "pdf";
    case ".docx":
      return "docx";
    case ".txt":
    case ".md":
    case ".markdown":
      return "text";
    default:
      return null;
  }
}

/**
 * Failure states say what happened and what to do, per the design brief. No
 * apologising, no vagueness, and never a raw parser error — those name
 * internals the learner cannot act on.
 */
export function validateUpload(file: {
  name: string;
  size: number;
}): string | null {
  if (detectKind(file.name) === null) {
    const ext = extensionOf(file.name);
    return `${ext || "That file type"} isn't supported. Use a PDF, Word (.docx), or plain text file.`;
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return `That file is ${mb} MB. Keep it under ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB — or paste the section you want to be quizzed on.`;
  }

  if (file.size === 0) {
    return "That file is empty. Try a different one.";
  }

  return null;
}

/**
 * A readable title from a filename.
 *
 * `ORGCHEM_ch7-notes_FINAL.pdf` reads better as "ORGCHEM ch7 notes FINAL" in
 * the header and in citations than as the raw filename. Deliberately does not
 * case-fold: "SN2" and "DNA" carry meaning that title-casing would destroy.
 */
export function titleFromFilename(filename: string): string {
  const base = filename.slice(0, filename.length - extensionOf(filename).length);
  return base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Clean up text a PDF extractor produced.
 *
 * PDF text has no paragraphs — extractors emit one line per rendered line, so
 * naive output arrives as a column of fragments. Rejoining lines that were only
 * wrapped restores the paragraph structure that `normaliseMaterial` and the
 * agent's "¶3" citations depend on.
 */
export function cleanExtractedText(raw: string): string {
  return (
    raw
      .replace(/\r\n?/g, "\n")
      // Words split across a line break by hyphenation: "photo-\nsynthesis".
      .replace(/(\w)-\n(\w)/g, "$1$2")
      // A page number alone on its own line is furniture, not content.
      .replace(/\n\s*\d{1,4}\s*\n/g, "\n\n")
      // A single newline between two word characters was a wrap, not a break.
      .replace(/(\S)\n(?=\w)/g, "$1 ")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Why a parse produced nothing useful — or `null` when it is fine.
 *
 * Separated from the parsing itself so the wording is covered by tests: telling
 * someone with a scanned PDF that their file "contains no text" sends them
 * looking for the wrong problem.
 */
export function describeEmptyExtraction(
  kind: UploadKind,
  text: string,
): string | null {
  const length = text.trim().length;

  if (kind === "pdf" && length < SCANNED_PDF_CHARS) {
    return "That PDF didn't parse. Try a text-based PDF — scanned pages won't work yet, because the text is an image.";
  }

  if (length === 0) {
    return "That file didn't contain any readable text. Try a different file, or paste the text directly.";
  }

  return null;
}
