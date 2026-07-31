import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored skill mirrors written by `npx skills add iblai/vibe`. Third-party
    // reference material, gitignored, and not ours to fix.
    ".agents/**",
    ".claude/**",
    ".codebuddy/**",
    ".kiro/**",
    ".trae/**",
    ".windsurf/**",
  ]),
]);

export default eslintConfig;
