import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from '@tailwindcss/vite'
import { resolve } from "path";

/* "@ts-expect-error" process is a nodejs global */
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Vite's alias matcher is prefix-based and resolves the FIRST
    // matching entry — so longer / more-specific keys MUST come
    // before shorter ones. With `@flux/plugin-sdk` listed first,
    // `import "@flux/plugin-sdk/host"` would resolve to
    // `<index.ts>/host` and break. Using regex aliases for the
    // sub-paths also makes the intent unambiguous.
    alias: [
      {
        find: /^@flux\/plugin-sdk\/ui$/,
        replacement: resolve(__dirname, "plugins/sdk/src/ui.ts"),
      },
      {
        find: /^@flux\/plugin-sdk\/drag$/,
        replacement: resolve(__dirname, "plugins/sdk/src/drag.ts"),
      },
      {
        find: /^@flux\/plugin-sdk\/layout$/,
        replacement: resolve(__dirname, "plugins/sdk/src/layout.tsx"),
      },
      {
        find: /^@flux\/plugin-sdk\/host$/,
        replacement: resolve(__dirname, "plugins/sdk/src/host.ts"),
      },
      {
        find: /^@flux\/plugin-sdk\/types$/,
        replacement: resolve(__dirname, "plugins/sdk/src/types.ts"),
      },
      {
        find: /^@flux\/plugin-sdk$/,
        replacement: resolve(__dirname, "plugins/sdk/src/index.ts"),
      },
      {
        find: /^@flux\/plugin-kanban$/,
        replacement: resolve(__dirname, "plugins/kanban/src/index.ts"),
      },
      {
        find: /^@flux\/plugin-canvas$/,
        replacement: resolve(__dirname, "plugins/canvas/src/index.ts"),
      },
      { find: "@/", replacement: resolve(__dirname, "src") + "/" },
      { find: "@", replacement: resolve(__dirname, "src") },
    ],
  },

  // Pre-bundle heavy editor-surface deps so dynamic `import()` calls in
  // MarkdownPreview / PdfView / SlidesView / GraphView resolve to stable
  // hashed chunks and don't 504 after HMR cycles.
  optimizeDeps: {
    include: [
      "mermaid",
      "markdown-it",
      "markdown-it-texmath",
      "katex",
      "reveal.js",
      "force-graph",
      "pdfjs-dist",
      "highlight.js",
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
