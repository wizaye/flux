/**
 * DetachedDocShell — minimal single-file webview launched by the
 * doc-header "Open in new window" command.
 *
 * Layout = just the doc-header (back/forward stub, title, view
 * toggles, ⋯) over a single editor pane that hosts ONE file. No
 * sidebars, no tab bar, no vault tree — this mirrors Obsidian's
 * detached note window where the screenshot shows just chrome +
 * content.
 *
 * Data flow:
 *   1) On mount we read `?file=<id>&vault=<absPath>` from the URL.
 *   2) If a real vault path was supplied AND we're in Tauri, we
 *      open that vault store so wikilinks and metadata resolve.
 *      In browser preview mode (mock-vault) we just look up the
 *      node from the mock vault tree.
 *   3) We render an absolute-minimal FileNode-backed pane: doc
 *      header on top, editor below, no chrome.
 *
 * The new window has its own Zustand stores (separate process) but
 * the user perceives it as "the same file open in a new window".
 */
import * as React from "react";
import { useVaultStore } from "./state/vault-store";
import { useVaultOperations } from "./hooks/use-vault-operations";
import { MarkdownPreview } from "./components/flux-ui/editor/views/markdown-preview";
import { CodeMirrorEditor } from "./components/flux-ui/editor/views/codemirror-editor";
import { SlidesView } from "./components/flux-ui/editor/views/slides-view";
import { PdfView } from "./components/flux-ui/editor/views/pdf-view";
import { GraphView } from "./components/flux-ui/editor/views/graph-view";
import { EMPTY_PANE_ACTIONS } from "./components/flux-ui/editor/views/types";
import { MOCK_VAULT_TREE, flattenVault, type FileNode, type Tab } from "./state/editor";
import { useFileOperations } from "./hooks/use-file-operations";
import { useEditorStore } from "./state/editor-store";
import { isTauri } from "./bindings";
import { bgApp, textNormal } from "./lib/lattice-tokens";
import { cn } from "./lib/utils";
import { toast } from "sonner";
import { formatError } from "./lib/errors";

interface DetachedQuery {
  fileId: string | null;
  vaultPath: string | null;
}

function readQuery(): DetachedQuery {
  if (typeof window === "undefined") return { fileId: null, vaultPath: null };
  const sp = new URLSearchParams(window.location.search);
  return {
    fileId: sp.get("file"),
    vaultPath: sp.get("vault"),
  };
}

export function DetachedDocShell() {
  const { fileId, vaultPath } = React.useMemo(readQuery, []);

  const fileTree = useVaultStore((s) => s.fileTree);
  const isVaultOpen = useVaultStore((s) => s.isVaultOpen);
  const { openVault } = useVaultOperations();
  const { openFile, saveFile } = useFileOperations();

  // ── Hydrate ──────────────────────────────────────────────────────
  // Real-vault detached window: open the vault from the parent
  // window's path. Mock-vault detached window: seed with
  // MOCK_VAULT_TREE so the file lookup succeeds.
  React.useEffect(() => {
    if (isVaultOpen) return;
    if (isTauri && vaultPath) {
      void openVault(vaultPath).catch((err) =>
        toast.error("Failed to open vault", { description: formatError(err) }),
      );
      return;
    }
    if (fileTree.length === 0) {
      useVaultStore.getState().setFileTree(MOCK_VAULT_TREE);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lazy-load the file content from disk (real vault) once the
  // vault is up. For mock vault we already have inline content.
  React.useEffect(() => {
    if (!fileId) return;
    if (!isVaultOpen || !isTauri) return;
    if (useVaultStore.getState().openFiles.has(fileId)) return;
    void openFile(fileId).catch(() => {
      /* error toast handled inside openFile */
    });
  }, [fileId, isVaultOpen, openFile]);

  const vault = React.useMemo(() => flattenVault(fileTree), [fileTree]);
  const file: FileNode | undefined = fileId ? vault.get(fileId) : undefined;

  // Local view-mode state — this window has no split tree, just a
  // single tab that owns its mode.
  const [viewMode, setViewMode] = React.useState<
    "source" | "live" | "preview" | "slides"
  >("live");

  // Live content selector for the active file.
  const loadedContent = useVaultStore((s) =>
    fileId ? s.openFiles.get(fileId) : undefined,
  );
  const overrideContent = useEditorStore((s) =>
    fileId ? s.fileContents.get(fileId) : undefined,
  );
  const setFileContent = useEditorStore((s) => s.setFileContent);
  const markDirty = useEditorStore((s) => s.markDirty);
  const markClean = useEditorStore((s) => s.markClean);

  if (!fileId) {
    return (
      <div className="flex h-screen w-screen items-center justify-center text-sm text-muted-foreground">
        Missing <code className="font-mono">?file=</code> parameter.
      </div>
    );
  }
  if (!file) {
    return (
      <div className="flex h-screen w-screen items-center justify-center text-sm text-muted-foreground">
        Loading <span className="font-mono ml-1">{fileId}</span>…
      </div>
    );
  }

  const content = overrideContent ?? loadedContent ?? file.content ?? "";

  // Synthetic single-tab descriptor so the views' props contract
  // matches what they expect from the multi-pane shell.
  const tab: Tab = {
    id: "detached-tab",
    fileId: file.id,
    title: file.name.replace(/\.md$/i, ""),
    viewMode,
  };

  const baseProps = {
    tab,
    file,
    content,
    vault,
    paneActions: {
      ...EMPTY_PANE_ACTIONS,
      onToggleReading: () =>
        setViewMode((m) => (m === "preview" ? "live" : "preview")),
      onSetLive: () => setViewMode("live"),
      onSetSource: () => setViewMode("source"),
      onSetSlides: () => setViewMode("slides"),
      onCopyPath: () =>
        navigator.clipboard
          ?.writeText(file.id)
          .then(() => toast.success("Path copied")),
      onRename: () => {},
      onShowInExplorer: () => {},
      onRevealInNav: () => {},
      onDelete: () => window.close(),
    },
    onChange: (next: string) => {
      setFileContent(file.id, next);
      markDirty(file.id);
    },
    onSave: () => {
      const toSave = overrideContent ?? loadedContent ?? file.content ?? "";
      if (isVaultOpen) {
        void saveFile(file.id, toSave)
          .then(() => markClean(file.id))
          .catch(() => undefined);
      } else {
        markClean(file.id);
      }
    },
  };

  // Dispatch by file kind / view mode.
  let body: React.ReactNode;
  if (file.kind === "graph") body = <GraphView {...baseProps} />;
  else if (file.kind === "pdf") body = <PdfView {...baseProps} />;
  else if (viewMode === "preview") body = <MarkdownPreview {...baseProps} />;
  else if (viewMode === "slides") body = <SlidesView {...baseProps} />;
  else if (viewMode === "live")
    body = <CodeMirrorEditor {...baseProps} livePreview />;
  else body = <CodeMirrorEditor {...baseProps} />;

  return (
    <div
      className={cn(
        "flex flex-col h-screen w-screen overflow-hidden",
        bgApp,
        textNormal,
      )}
    >
      {body}
    </div>
  );
}

