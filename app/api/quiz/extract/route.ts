/**
 * POST /api/quiz/extract — turn an uploaded file into material.
 *
 * Accepts multipart/form-data with a single `file` field and returns the same
 * `{ title, body }` shape the paste form produces, so everything downstream —
 * the context budget, the prompt, the agent — stays unaware that uploads exist.
 *
 * The parsers live here rather than in the browser on purpose: PDF.js is heavy,
 * the deployed bundle is already the app's worst performance problem, and one
 * server-side failure path beats one per browser. See lib/quiz/extract.ts.
 */

import { NextResponse } from "next/server";

import {
  MAX_UPLOAD_BYTES,
  cleanExtractedText,
  describeEmptyExtraction,
  detectKind,
  titleFromFilename,
  validateUpload,
  type UploadKind,
} from "@/lib/quiz/extract";

// Both parsers need Node APIs (Buffer, and PDF.js's serverless build).
export const runtime = "nodejs";

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Extract text from bytes we have already established we can handle. */
async function extract(kind: UploadKind, bytes: Uint8Array): Promise<string> {
  if (kind === "pdf") {
    // Imported lazily so a learner pasting text never pays to load PDF.js into
    // the function instance.
    const { extractText } = await import("unpdf");
    const { text } = await extractText(bytes, { mergePages: true });
    return cleanExtractedText(text);
  }

  if (kind === "docx") {
    const mammoth = (await import("mammoth")).default;
    const { value } = await mammoth.extractRawText({
      buffer: Buffer.from(bytes),
    });
    // Word already has real paragraphs, so only whitespace needs tidying —
    // running the PDF line-rejoin over it would merge genuine line breaks.
    return value.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // Plain text. `fatal: false` so a stray non-UTF-8 byte degrades to U+FFFD
  // rather than throwing away an otherwise readable file.
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
}

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("That upload didn't arrive intact. Try again.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return fail("No file was attached.", 400);
  }

  const invalid = validateUpload({ name: file.name, size: file.size });
  // 413 for oversize so the status matches what a proxy would have said had it
  // rejected the body first; everything else is a plain bad request.
  if (invalid) return fail(invalid, file.size > MAX_UPLOAD_BYTES ? 413 : 400);

  const kind = detectKind(file.name);
  if (!kind) return fail("That file type isn't supported.", 400);

  let text: string;
  try {
    text = await extract(kind, new Uint8Array(await file.arrayBuffer()));
  } catch {
    // Parser errors name internals the learner cannot act on — a corrupt zip
    // container, a malformed xref table. Say what to do instead.
    return fail(
      "That file couldn't be read. It may be corrupted or password-protected — try re-saving it, or paste the text directly.",
      422,
    );
  }

  const empty = describeEmptyExtraction(kind, text);
  if (empty) return fail(empty, 422);

  return NextResponse.json({
    title: titleFromFilename(file.name),
    body: text,
  });
}
