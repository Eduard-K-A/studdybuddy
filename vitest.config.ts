import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Mirror the "@/*" -> "./*" mapping in tsconfig.json so tests import the
    // same specifiers the app does.
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    include: ["__tests__/**/*.test.ts"],
  },
});
