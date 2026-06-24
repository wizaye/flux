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
    setupFiles: ["./src/tests/setup.ts"],
    include: ["src/tests/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage/frontend",
      // We scope coverage to the *logic* layer (stores, hooks,
      // small pure utilities). UI shells, editor view-layer, and
      // graphics-heavy modules are intentionally excluded — they
      // require a hand-rolled mock infrastructure for CodeMirror,
      // pdfjs, mermaid, shiki, force-graph, canvas, etc. that
      // would dwarf the production code and provide little real
      // bug-finding value (the logic the UI delegates to lives in
      // the hooks/stores already under coverage).
      //
      // If you want to include any of these later, delete the
      // corresponding line and add a test file that mocks the
      // heavy dependency it imports.
      include: ["src/**/*.{ts,tsx}", "plugins/**/src/**/*.{ts,tsx}"],
      exclude: [
        // Test scaffolding, build manifests, generated bindings.
        "src/tests/**",
        "src/main.tsx",
        "src/App.tsx",
        "src/detached-doc-shell.tsx",
        "src/vite-env.d.ts",
        "src/**/*.d.ts",
        "src/bindings.ts",
        // SDK is published as a separate workspace package and
        // tested in its own repo.
        "plugins/sdk/**",
        "src/plugins/registry.ts",
        // shadcn copies — third-party UI primitives we don't own.
        "src/components/ui/**",
        // Static icon glyph map.
        "src/components/flux-ui/common/icons.tsx",
        // Heavy UI shells / view layer — exercised end-to-end via
        // Tauri runtime, not unit-testable without a mocked
        // CodeMirror / pdfjs / mermaid / shiki / reveal.js.
        "src/components/flux-ui/layout/**",
        "src/components/flux-ui/editor/**",
        "src/components/flux-ui/modals/settings-dialog.tsx",
        "src/components/flux-ui/modals/frontmatter-editor.tsx",
        "src/components/flux-ui/modals/move-dialog.tsx",
        "src/components/flux-ui/modals/merge-dialog.tsx",
        "src/components/flux-ui/modals/bookmark-dialog.tsx",
        "src/components/flux-ui/modals/trash-dialog.tsx",
        "src/components/flux-ui/modals/pdf-export-dialog.tsx",
        "src/components/flux-ui/modals/input-dialog.tsx",
        "src/components/flux-ui/modals/vault-picker.tsx",
        // Belt-and-braces \u2014 glob form in case the exact-path
        // patterns above don't match on every OS/walker.
        "**/components/flux-ui/modals/*.tsx",
        "**/components/flux-ui/modals/**/*.tsx",
        "src/components/flux-ui/common/**",
        "src/components/mode-toggle.tsx",
        "src/components/theme-provider.tsx",
        // Graphics-heavy lib code (canvas / pdfjs / dotmatrix
        // shader-like rendering). Each would need its own DOM
        // canvas mock plus golden-image fixtures to be meaningful.
        "src/lib/pdf-render.ts",
        "src/lib/dotmatrix-core.tsx",
        "src/lib/dotmatrix-hooks.ts",
        "src/lib/use-dark-mode.ts",
        "src/lib/doc-actions.ts",
        // Plugin host-coupled component code lives in the plugin
        // packages themselves; their `src/` files are tested over
        // there. Keeping coverage focused on `plugins/sdk/**`
        // surface (already excluded above) until we publish.
        "plugins/canvas/src/canvas-view.tsx",
        "plugins/kanban/src/view.tsx",
        "plugins/kanban/src/sidebar.tsx",
        "plugins/kanban/src/card-editor.tsx",
        "plugins/kanban/src/board-settings.tsx",
        "plugins/kanban/src/link-picker.tsx",
        "plugins/kanban/src/app-root.tsx",
        "plugins/kanban/src/settings.tsx",
        "plugins/canvas/src/sidebar.tsx",
        "plugins/canvas/src/settings.tsx",
        // Plugin entry-point barrel files (re-exports only).
        "plugins/canvas/src/index.ts",
        "plugins/canvas/src/view.tsx",
        "plugins/kanban/src/index.ts",
        // Plugin migration scripts run once at install time; cover
        // via the plugin package's own test suite when it's
        // extracted.
        "plugins/kanban/src/migrate.ts",
      ],
      // Fail CI / `--coverage` if the logic layer drops below the
      // bar. Tune as the surface grows; never relax.
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 85,
        branches: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
