/**
 * Plugin-level settings panel (Settings → Community plugins →
 * Kanban). Board-specific configuration (columns, work item types,
 * fields, filters) lives inside each board — open one and click
 * "Settings" in the board toolbar.
 *
 * Today this panel is mostly explanatory; the storage-backed
 * scratchpad exercises `PluginStorageApi` end-to-end ahead of the
 * Phase C broker.
 */
import * as React from "react";

import { Textarea } from "@flux/plugin-sdk/ui";
import { createPluginHost } from "@flux/plugin-sdk/host";

const host = createPluginHost({ pluginId: "kanban", apiVersion: "1.0" });

export default function KanbanSettings() {
  const [scratch, setScratch] = React.useState<string>("");

  React.useEffect(() => {
    void host.storage.get<string>("scratch").then((v) => setScratch(v ?? ""));
  }, []);

  return (
    <div className="flex flex-col gap-5 text-[13px]">
      <div>
        <h3 className="text-[14px] font-medium">Kanban</h3>
        <p className="text-[12px] text-muted-foreground">
          Boards live as <code>*.board.yaml</code> files in your
          vault. Each board carries its own work item types, custom
          fields, columns, filters and parent/child links — open a
          board and click <strong>Settings</strong> in its toolbar
          to edit them.
        </p>
        <p className="text-[12px] text-muted-foreground mt-1.5">
          Any Markdown note can link to a work item:{" "}
          <code>[[Sprint 23.board#wi_XXX|Implement login]]</code>.
          Run <em>Kanban: Link work item</em> from the command
          palette to insert one at the cursor.
        </p>
        <p className="text-[12px] text-muted-foreground mt-1.5">
          Legacy <code>.kanban.json</code> and <code>.kanban.md</code>{" "}
          boards migrate to <code>.board.yaml</code> automatically the
          first time you open them.
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] text-muted-foreground">Notes</span>
        <Textarea
          value={scratch}
          onChange={(e) => {
            setScratch(e.target.value);
            void host.storage.set("scratch", e.target.value);
          }}
          rows={4}
          placeholder="Scratchpad — persisted to plugin storage."
          className="text-[12.5px]"
        />
      </label>
    </div>
  );
}
