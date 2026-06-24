/**
 * Settings panel — rendered inside the host's Settings →
 * Community plugins → Example section.
 *
 * Use the SDK's `ui` re-exports for any shadcn primitive so the
 * plugin doesn't have to vendor its own copy. When the SDK is
 * published, `@flux/plugin-sdk/ui` resolves to a pinned set of
 * primitives — no version drift between plugins.
 */
import * as React from "react";

export function ExampleSettings(): React.ReactElement {
  return (
    <div className="flex flex-col gap-2 p-4">
      <h2 className="text-lg font-medium">Example Plugin</h2>
      <p className="text-sm text-muted-foreground">
        Replace this with your real settings UI. The host renders
        whatever React tree you return inside its existing
        settings-dialog scroll area.
      </p>
    </div>
  );
}
