import { defineConfig } from "vite";
import { pluginViteConfig } from "../plugin-build-config";

export default defineConfig(
  pluginViteConfig({ entry: "src/index.ts", name: "FluxExcalidrawPlugin" }),
);
