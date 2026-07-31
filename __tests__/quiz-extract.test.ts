import { describe, it, expect } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  cleanExtractedText,
  describeEmptyExtraction,
  detectKind,
  extensionOf,
  titleFromFilename,
  validateUpload,
} from "@/lib/quiz/extract";
import { normaliseMaterial } from "@/lib/quiz/context";

describe("detectKind", () => {
  it("recognises the accepted extensions regardless of case", () => {
    expect(detectKind("notes.PDF")).toBe("pdf");
    expect(detectKind("chapter.DocX")).toBe("docx");
    expect(detectKind("readme.md")).toBe("text");
  });

  it("rejects formats we cannot read, including legacy .doc", () => {
    // .doc is a different container entirely — mammoth cannot open it, so
    // accepting it would only move the failure later.
    expect(detectKind("essay.doc")).toBeNull();
    expect(detectKind("slides.pptx")).toBeNull();
    expect(detectKind("scan.png")).toBeNull();
  });

  it("does not treat a dot in a folder-ish name as an extension", () => {
    expect(extensionOf("no-extension")).toBe("");
    expect(detectKind("no-extension")).toBeNull();
  });
});

describe("validateUpload", () => {
  it("accepts a normal file", () => {
    expect(validateUpload({ name: "ch7.pdf", size: 500_000 })).toBeNull();
  });

  it("names the offending extension so the message is actionable", () => {
    const message = validateUpload({ name: "scan.png", size: 10 });
    expect(message).toContain(".png");
  });

  it("rejects a file over the cap and quotes its size", () => {
    const message = validateUpload({
      name: "textbook.pdf",
      size: MAX_UPLOAD_BYTES + 1,
    });
    expect(message).toContain("MB");
  });

  it("accepts a file exactly at the cap", () => {
    expect(
      validateUpload({ name: "textbook.pdf", size: MAX_UPLOAD_BYTES }),
    ).toBeNull();
  });

  it("rejects an empty file", () => {
    expect(validateUpload({ name: "empty.txt", size: 0 })).toContain("empty");
  });
});

describe("titleFromFilename", () => {
  it("turns separators into spaces without touching meaningful case", () => {
    expect(titleFromFilename("ORGCHEM_ch7-notes_FINAL.pdf")).toBe(
      "ORGCHEM ch7 notes FINAL",
    );
  });

  it("strips only the final extension", () => {
    expect(titleFromFilename("lecture.2026.03.docx")).toBe("lecture.2026.03");
  });
});

describe("cleanExtractedText", () => {
  it("rejoins a word hyphenated across a line break", () => {
    expect(cleanExtractedText("photo-\nsynthesis occurs")).toBe(
      "photosynthesis occurs",
    );
  });

  it("rejoins wrapped lines so paragraphs survive", () => {
    const pdfish = "The nucleophile attacks\nfrom the opposite\nface.";
    expect(cleanExtractedText(pdfish)).toBe(
      "The nucleophile attacks from the opposite face.",
    );
  });

  it("keeps a blank-line paragraph break, which citations depend on", () => {
    const out = cleanExtractedText("First para.\n\nSecond para.");
    expect(out).toBe("First para.\n\nSecond para.");
    // The pipeline downstream must still see two paragraphs.
    expect(normaliseMaterial(out).split("\n\n")).toHaveLength(2);
  });

  it("drops a page number sitting alone on its own line", () => {
    const out = cleanExtractedText("end of page.\n214\nStart of next.");
    expect(out).not.toMatch(/\b214\b/);
  });

  it("normalises CRLF from Windows-produced extractors", () => {
    expect(cleanExtractedText("one\r\n\r\ntwo")).toBe("one\n\ntwo");
  });
});

describe("describeEmptyExtraction", () => {
  it("blames the scan, not the document, for a near-empty PDF", () => {
    const message = describeEmptyExtraction("pdf", "Fig. 1");
    expect(message).toMatch(/scanned/i);
  });

  it("passes a PDF with real text through", () => {
    expect(describeEmptyExtraction("pdf", "word ".repeat(100))).toBeNull();
  });

  it("does not apply the scanned-page threshold to text files", () => {
    // A short .txt is short on purpose; only PDFs get the image diagnosis.
    expect(describeEmptyExtraction("text", "brief note")).toBeNull();
  });

  it("reports a genuinely empty non-PDF", () => {
    expect(describeEmptyExtraction("docx", "   \n  ")).toMatch(/readable text/i);
  });
});
