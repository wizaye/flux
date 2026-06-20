import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

/**
 * Separate Vitest config — intentionally decoupled from vite.config.ts
 * which has Tauri-specific async setup (TAURI_DEV_HOST, clearScreen, etc.)
 * that is irrelevant and potentially disruptive in a test environment.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    // Provide browser-like globals (describe, it, expect, vi, …) without
    // needing an explicit import in every test file.
    globals: true,
    // jsdom gives us a full DOM + localStorage for store tests.
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}", "plugins/**/src/**/*.{ts,tsx}"],
      exclude: [
        "src/test/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/**/*.d.ts",
        "plugins/sdk/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
