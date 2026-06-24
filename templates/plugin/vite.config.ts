import { defineConfig } from "vite";
import { pluginViteConfig } from "../../plugins/plugin-build-config";

export default defineConfig(
  pluginViteConfig({ entry: "src/index.ts", name: "FluxExamplePlugin" }),
);
