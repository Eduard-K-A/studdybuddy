import { describe, it, expect } from "vitest";
import { firstUnsafeHeaderIndex, isHeaderSafe } from "@/lib/quiz/agent";

/**
 * Regression cover for a real production outage.
 *
 * The deployed IBLAI_API_KEY contained an em dash where a hyphen belonged, so
 * building `Authorization: Api-Token <token>` threw
 *
 *   TypeError: Cannot convert argument to a ByteString because the character
 *   at index 29 has a value of 8212 which is greater than 255
 *
 * before a single byte was sent. Every /api/quiz request 502'd on the deployed
 * origin while working perfectly on localhost, where the value was intact.
 */

const EM_DASH = String.fromCharCode(8212);

describe("firstUnsafeHeaderIndex", () => {
  it("accepts a normal hex credential", () => {
    expect(firstUnsafeHeaderIndex("a".repeat(64))).toBe(-1);
    expect(isHeaderSafe("c4a0ae439d8842dd9a21450d46c51f9f")).toBe(true);
  });

  it("finds the em dash that caused the outage, at its exact index", () => {
    const token = `abcdefghijklmnopqrs${EM_DASH}tuvwxyz`;
    expect(firstUnsafeHeaderIndex(token)).toBe(19);
    expect(isHeaderSafe(token)).toBe(false);
  });

  it("reports the index within the value, not within the header", () => {
    // The TypeError counts from the start of the whole header value, which is
    // why the reported 29 corresponded to token index 19 behind "Api-Token ".
    const token = `abcdefghijklmnopqrs${EM_DASH}`;
    expect(`Api-Token ${token}`.charCodeAt(29)).toBe(8212);
    expect(firstUnsafeHeaderIndex(token)).toBe(19);
  });

  it("allows latin-1 characters, which headers can carry", () => {
    // U+00FF is the last representable code unit; it is not the failure mode.
    expect(isHeaderSafe(String.fromCharCode(255))).toBe(true);
    expect(isHeaderSafe(String.fromCharCode(256))).toBe(false);
  });

  it("treats an empty value as safe", () => {
    expect(firstUnsafeHeaderIndex("")).toBe(-1);
  });

  it("catches the other smart-punctuation substitutions", () => {
    // Curly quotes and an en dash arrive by the same paste path as the em dash.
    const smart = [0x2018, 0x2019, 0x201c, 0x201d, 0x2013, 0x2014];
    for (const code of smart) {
      expect(isHeaderSafe(`tok${String.fromCharCode(code)}en`)).toBe(false);
    }
  });

  it("does NOT flag a non-breaking space, which is latin-1 and passes through", () => {
    // Worth pinning: U+00A0 is a common paste artefact but is representable in
    // a header, so it corrupts the credential silently rather than throwing.
    // This check is about the TypeError, not about paste damage in general.
    expect(isHeaderSafe(`tok${String.fromCharCode(0x00a0)}en`)).toBe(true);
  });
});
