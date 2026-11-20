// Vite builds the front end for Tauri's webview (RULES.md D2, D18). The
// build has no eval and loads nothing remote (R-SEC-4); the tests run in
// jsdom, and coverage is held to its floor (D7).
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/** The port Tauri's `devUrl` names. */
const DEV_PORT = 5173;
/**
 * The largest chunk Vite builds without a warning, in KiB. The bundle is
 * read from the application's own files, never over a network, so its
 * size costs nothing a split would save.
 */
const CHUNK_WARNING_KIB = 8192;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: DEV_PORT, strictPort: true, host: "127.0.0.1" },
  build: {
    target: "es2023",
    sourcemap: false,
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: CHUNK_WARNING_KIB,
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["ui/**/*.test.{ts,tsx}"],
    setupFiles: ["ui/test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["ui/**/*.{ts,tsx}"],
      exclude: ["ui/**/*.test.{ts,tsx}", "ui/main.tsx", "ui/test/**"],
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "target/coverage-ui",
      thresholds: { lines: 97, branches: 92, functions: 96, statements: 97 },
    },
  },
});
