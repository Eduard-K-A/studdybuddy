
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve, dirname, join } from "path";

/**
 * Verify that every @source directive in CSS files points to an existing
 * directory and that the SDK symlink is valid.
 *
 * If these paths break, Tailwind v4 silently stops generating utility
 * classes for SDK components — no build error, just missing styles.
 */

const projectRoot = resolve(__dirname, "..");
const nodeModulesExist = existsSync(join(projectRoot, "node_modules"));

// Detect src/ layout
const appDir = existsSync(join(projectRoot, "src", "app"))
  ? join(projectRoot, "src", "app")
  : join(projectRoot, "app");

const libDir = existsSync(join(projectRoot, "src", "lib"))
  ? join(projectRoot, "src", "lib")
  : join(projectRoot, "lib");

describe.skipIf(!nodeModulesExist)("@source paths", () => {
  // Collect all CSS files in app/
  const cssFiles: string[] = [];
  if (existsSync(appDir)) {
    for (const file of readdirSync(appDir)) {
      if (file.endsWith(".css")) {
        cssFiles.push(join(appDir, file));
      }
    }
  }

  // Extract @source directives
  const sourceDirectives: { file: string; path: string; resolved: string }[] =
    [];
  for (const cssFile of cssFiles) {
    const content = readFileSync(cssFile, "utf-8");
    const regex = /@source\s+["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      sourceDirectives.push({
        file: cssFile,
        path: match[1],
        resolved: resolve(dirname(cssFile), match[1]),
      });
    }
  }

  it("should find at least one @source directive", () => {
    expect(sourceDirectives.length).toBeGreaterThan(0);
  });

  for (const { file, path: srcPath, resolved } of sourceDirectives) {
    const relFile = file.split(/[/\\]app[/\\]/).pop() ?? file;
    it(`@source "${srcPath}" in ${relFile} should resolve to an existing path`, () => {
      expect(
        existsSync(resolved),
        `Path does not exist: ${resolved}\n` +
          `Referenced in: ${file}\n` +
          `Hint: check that lib/iblai/sdk symlink resolves (ls -la lib/iblai/sdk)`,
      ).toBe(true);
    });
  }
});

/**
 * The starter reached the SDK's compiled source through a `lib/iblai/sdk`
 * symlink. That link does not survive `git clone` on Windows, where
 * core.symlinks defaults to false and the link is checked out as a plain file
 * containing its target path — so Tailwind scanned nothing and SDK components
 * rendered unstyled with no build error.
 *
 * `@source` now points at node_modules directly (the form documented in
 * /iblai-vibe-auth Step 7), so the symlink is gone. These tests assert the
 * invariant that actually matters: the directory Tailwind scans exists and
 * holds the compiled JS it needs to extract class names from.
 */
describe.skipIf(!nodeModulesExist)("SDK Tailwind source", () => {
  const sdkSourceDir = join(
    projectRoot,
    "node_modules",
    "@iblai",
    "iblai-js",
    "dist",
    "web-containers",
    "source",
  );

  it("SDK compiled source directory should exist", () => {
    expect(
      existsSync(sdkSourceDir),
      `Path does not exist: ${sdkSourceDir}\n` +
        `Hint: run pnpm install to populate node_modules`,
    ).toBe(true);
  });

  it("SDK compiled source should contain compiled JS", () => {
    const files = readdirSync(sdkSourceDir);
    expect(files).toContain("index.esm.js");
  });

  it("no stale lib/iblai/sdk symlink should remain", () => {
    expect(
      existsSync(join(libDir, "iblai", "sdk")),
      "lib/iblai/sdk is gone by design — @source points at node_modules now",
    ).toBe(false);
  });
});
