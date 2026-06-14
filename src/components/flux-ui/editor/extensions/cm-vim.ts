import { vim, Vim } from "@replit/codemirror-vim";
import { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

/**
 * Vim mode extension for CodeMirror.
 *
 * Ported from `lattice/src/components/editor/extensions/cm-vim.ts` —
 * keeps the same `:hint` ex command (`window.dispatchEvent` of
 * `flux-hint-mode` so a future Vimium-style hint feature can wire in)
 * and the `F` normal-mode map shortcut.
 */
export function vimMode(enabled: boolean): Extension[] {
  if (!enabled) {
    return [];
  }

  try {
    Vim.defineEx("hint", "hint", () =>
      window.dispatchEvent(new CustomEvent("flux-hint-mode")),
    );
    Vim.defineEx("hints", "hints", () =>
      window.dispatchEvent(new CustomEvent("flux-hint-mode")),
    );
    Vim.map("F", ":hint<CR>", "normal");
  } catch {
    /* Already registered (HMR) — ignore */
  }

  return [
    vim(),
    keymap.of([
      {
        key: "Ctrl-s",
        run: () => false, // Save handled by parent
      },
    ]),
  ];
}

export function getVimStatus(view: EditorView): string {
  const vimState = (view.state as unknown as { vim?: { mode?: string } }).vim;
  return vimState?.mode ?? "normal";
}
