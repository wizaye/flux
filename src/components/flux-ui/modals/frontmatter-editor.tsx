/**
 * File-properties (YAML frontmatter) editor dialog.
 *
 * Matches the same surface Obsidian's "Add file property" command
 * opens: a list of `key: value` rows with add/delete and a save
 * button. Mutates the doc's leading `---\n…\n---\n` frontmatter
 * block, creating one if missing.
 *
 * Why YAML by hand and not a library:
 *   • The frontmatter is always TOP-OF-FILE and shaped as a flat
 *     map of strings — full YAML is overkill and would pull in
 *     ~50KB of `js-yaml`.
 *   • Round-tripping arbitrary YAML (anchors, multi-line strings,
 *     tags) loses fidelity in any library and is what motivates
 *     Obsidian's own custom parser.
 *   • If the user types raw YAML the dialog still works on the
 *     leading text — we just won't recognise list/object values
 *     and surface them as raw strings.
 */
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IcPlus, IcTrash } from "@/components/flux-ui/common/icons";

interface FrontmatterEditorProps {
  open: boolean;
  fileName: string;
  /** Full file source. Frontmatter (if any) is parsed off the top. */
  source: string;
  /** Called with the entire NEW file source after the user clicks Save. */
  onSave: (newSource: string) => void;
  onCancel: () => void;
}

interface Row {
  key: string;
  value: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseFrontmatter(source: string): { rows: Row[]; body: string } {
  const m = FRONTMATTER_RE.exec(source);
  if (!m) return { rows: [], body: source };
  const yaml = m[1];
  const body = source.slice(m[0].length);
  const rows: Row[] = [];
  for (const line of yaml.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const rawVal = line.slice(colon + 1).trim();
    if (!key) continue;
    // Strip simple surrounding quotes — round-trip will re-quote
    // values that contain `:` or start with whitespace.
    let value = rawVal;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    rows.push({ key, value });
  }
  return { rows, body };
}

function serialiseFrontmatter(rows: Row[], body: string): string {
  const live = rows.filter((r) => r.key.trim());
  if (live.length === 0) {
    // No properties → strip any existing frontmatter.
    return body;
  }
  const lines = live.map((r) => {
    const v = r.value;
    // Quote values that contain `:` (would break parsing) or that
    // start/end with whitespace.
    const needsQuote =
      v !== v.trim() || v.includes(":") || v.includes("#") || v === "";
    const escapedV = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const out = needsQuote ? `"${escapedV}"` : v;
    return `${r.key}: ${out}`;
  });
  const yaml = lines.join("\n");
  return `---\n${yaml}\n---\n${body.startsWith("\n") ? "" : body.length > 0 ? "\n" : ""}${body}`;
}

export function FrontmatterEditor({
  open,
  fileName,
  source,
  onSave,
  onCancel,
}: FrontmatterEditorProps) {
  const initial = React.useMemo(() => parseFrontmatter(source), [source]);
  const [rows, setRows] = React.useState<Row[]>(initial.rows);
  const body = initial.body;

  // Reset on re-open or source change.
  React.useEffect(() => {
    if (open) setRows(parseFrontmatter(source).rows);
  }, [open, source]);

  const addRow = () => setRows((r) => [...r, { key: "", value: "" }]);
  const removeRow = (i: number) =>
    setRows((r) => r.filter((_, idx) => idx !== i));
  const updateRow = (i: number, patch: Partial<Row>) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const handleSave = () => {
    onSave(serialiseFrontmatter(rows, body));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>File properties</DialogTitle>
          <DialogDescription>
            Edit the YAML frontmatter block at the top of{" "}
            <span className="font-medium">{fileName}</span>. Each row maps to a
            single key. Properties with empty keys are dropped.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5 py-2 max-h-[360px] overflow-auto">
          {rows.length === 0 ? (
            <p className="text-[12px] italic text-[var(--text-faint)] px-1">
              No properties yet. Click "Add property" below.
            </p>
          ) : null}
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                value={r.key}
                placeholder="key"
                className="w-[36%]"
                onChange={(e) => updateRow(i, { key: e.target.value })}
              />
              <Input
                value={r.value}
                placeholder="value"
                className="flex-1"
                onChange={(e) => updateRow(i, { value: e.target.value })}
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label="Remove property"
                onClick={() => removeRow(i)}
                className="px-2"
              >
                <IcTrash className="[width:var(--icon-sm)] [height:var(--icon-sm)]" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={addRow}
            className="self-start mt-2"
          >
            <IcPlus className="mr-1 [width:var(--icon-sm)] [height:var(--icon-sm)]" />
            Add property
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
