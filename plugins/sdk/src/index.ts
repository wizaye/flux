export * from "./types";
export {
  HOST_API_VERSION,
  CAPABILITIES,
  ALL_CAPABILITIES,
  type Capability,
} from "./contract";
export { createPluginHost, HostCallError } from "./host";
export type { CreatePluginHostOptions } from "./host";
export { PluginPaneLayout } from "./layout";
export type { PluginPaneLayoutProps } from "./layout";
export {
  HOST_DRAG_MIMES,
  pluginDragMime,
  isHostDrag,
  type HostDragMime,
} from "./drag";
// `ui` (shadcn primitives) is NOT re-exported here on purpose:
// the file pulls in host-internal `@/components/ui/*` aliases and
// cannot be bundled into a publishable npm package. Plugins that
// want shadcn primitives import `@flux/plugin-sdk/ui` explicitly,
// which is host-only and not part of the published exports map.
