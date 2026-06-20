/**
 * Task-line action affordance.
 *
 * For every markdown line that begins with `- [ ]` / `- [x]` we
 * paint a small button at the end of the line. Hidden by default;
 * appears when the cursor / pointer is on that line via CSS
 * (`.cm-line:hover .flux-task-action`).
 *
 * Click → dispatch `flux-kanban-link-work-item` with:
 *   • `initialTitle` — the task body, seeds the picker.
 *   • `replaceFrom` / `replaceTo` — absolute document range that
 *     covers the task text after the `- [ ] ` prefix, so the
 *     picker's caller can REPLACE the task text with the inserted
 *     wikilink instead of dropping it at the user's last cursor.
 *
 * Without that range the link would land wherever the cursor
 * happened to be — usually the top of the file, since clicking the
 * chip steals focus from the editor without moving the caret.
 */
import { type Extension, type Range, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

const TASK_RE = /^(\s*-\s+\[(?: |x|X)\]\s)(.*)$/;
const LINK_EVENT = "flux-kanban-link-work-item";

class TaskActionWidget extends WidgetType {
  constructor(
    readonly taskText: string,
    readonly replaceFrom: number,
    readonly replaceTo: number,
  ) {
    super();
  }
  override eq(other: WidgetType): boolean {
    return (
      other instanceof TaskActionWidget &&
      other.taskText === this.taskText &&
      other.replaceFrom === this.replaceFrom &&
      other.replaceTo === this.replaceTo
    );
  }
  toDOM(): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "flux-task-action";
    btn.dataset.taskText = this.taskText;
    btn.dataset.replaceFrom = String(this.replaceFrom);
    btn.dataset.replaceTo = String(this.replaceTo);
    btn.title = "Link to work item";
    btn.setAttribute("aria-label", "Link to work item");
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11">' +
      '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
      '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>' +
      "</svg>" +
      '<span class="flux-task-action-label">work item</span>';
    return btn;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

const taskLineClass = Decoration.line({ class: "flux-task-line" });

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const lineDecos: Range<Decoration>[] = [];
  const widgetDecos: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const text = line.text;
      const m = TASK_RE.exec(text);
      if (m) {
        const prefixLen = m[1].length;
        const taskText = m[2].trim();
        const replaceFrom = line.from + prefixLen;
        const replaceTo = line.to;
        lineDecos.push(taskLineClass.range(line.from));
        widgetDecos.push(
          Decoration.widget({
            widget: new TaskActionWidget(taskText, replaceFrom, replaceTo),
            side: 1, // after the content
          }).range(line.to),
        );
      }
      pos = line.to + 1;
      if (pos > view.state.doc.length) break;
    }
  }

  for (const d of lineDecos) builder.add(d.from, d.to, d.value);
  const set = builder.finish();
  return set.update({ add: widgetDecos, sort: true });
}

const taskActionPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        this.decorations = build(u.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(event, view) {
        const target = event.target as HTMLElement;
        const btn = target.closest(".flux-task-action") as HTMLElement | null;
        if (!btn) return false;
        event.preventDefault();
        event.stopPropagation();
        const taskText = btn.dataset.taskText ?? "";
        const replaceFrom = Number(btn.dataset.replaceFrom ?? -1);
        const replaceTo = Number(btn.dataset.replaceTo ?? -1);
        // Move the selection onto the task line first so any
        // fallback `flux-insert-at-cursor` path (where the consumer
        // doesn't honour replaceFrom/To) still lands in the right
        // neighbourhood instead of file-top.
        if (replaceFrom >= 0 && replaceTo >= replaceFrom) {
          view.dispatch({
            selection: { anchor: replaceTo },
            scrollIntoView: true,
          });
        }
        window.dispatchEvent(
          new CustomEvent(LINK_EVENT, {
            detail: {
              initialTitle: taskText,
              replaceFrom,
              replaceTo,
              // The document path the editor is bound to. Read off
              // the CM view's parent so we don't import editor-store
              // here (would create a cycle).
              fileId: view.dom.dataset.fluxFileId ?? null,
            },
          }),
        );
        return true;
      },
    },
  },
);

const taskActionStyles = EditorView.baseTheme({
  ".flux-task-action": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    marginLeft: "8px",
    padding: "0 6px",
    height: "18px",
    fontSize: "10.5px",
    fontFamily: "var(--font-text)",
    color: "var(--text-faint)",
    background: "transparent",
    border: "1px solid var(--border, rgba(127,127,127,0.25))",
    borderRadius: "4px",
    cursor: "pointer",
    opacity: "0",
    pointerEvents: "none",
    transition: "opacity 120ms ease, color 120ms ease, background 120ms ease",
    verticalAlign: "middle",
    userSelect: "none",
  },
  ".cm-active.flux-task-line .flux-task-action, .flux-task-line:hover .flux-task-action":
    {
      opacity: "0.6",
      pointerEvents: "auto",
    },
  ".flux-task-action:hover": {
    opacity: "1 !important",
    color: "var(--text-normal)",
    background: "var(--hover, rgba(127,127,127,0.12))",
  },
  ".flux-task-action-label": {
    lineHeight: "1",
  },
});

export const taskActionExtension: Extension = [taskActionPlugin, taskActionStyles];
