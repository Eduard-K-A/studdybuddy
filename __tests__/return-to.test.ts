import { describe, it, expect } from "vitest";
import { isSafeReturnPath } from "@/lib/return-to";

/**
 * The return path comes from a cookie, so it is attacker-controllable. Getting
 * this wrong is an open redirect, which is why it is tested directly rather
 * than only through the E2E flow.
 */
describe("isSafeReturnPath", () => {
  it("accepts root-relative paths", () => {
    expect(isSafeReturnPath("/quiz")).toBe(true);
    expect(isSafeReturnPath("/quiz?x=1")).toBe(true);
  });

  it("rejects protocol-relative URLs", () => {
    // "//evil.com" is a valid URL to another origin.
    expect(isSafeReturnPath("//evil.com")).toBe(false);
    expect(isSafeReturnPath("///evil.com")).toBe(false);
  });

  it("rejects absolute URLs", () => {
    expect(isSafeReturnPath("https://evil.com")).toBe(false);
    expect(isSafeReturnPath("http://evil.com/quiz")).toBe(false);
    expect(isSafeReturnPath("javascript:alert(1)")).toBe(false);
  });

  it("rejects relative paths and empty values", () => {
    expect(isSafeReturnPath("quiz")).toBe(false);
    expect(isSafeReturnPath("")).toBe(false);
    expect(isSafeReturnPath(undefined)).toBe(false);
  });
});
