import { useMemo, useRef, useState } from "react";
import { IconButton } from "@/components/flux-ui/common/icon-button";
import {
  IcChevronRight,
  IcClose,
  IcGear,
  IcSync,
  IcWand,
} from "@/components/flux-ui/common/icons";
import type { FileNode } from "@/state/editor";
import { EditorPaneLayout } from "../editor-pane-layout";
import type { EditorViewProps } from "../types";
import GraphCanvas, {
  type GraphCanvasHandle,
  type GraphLink,
  type GraphNode,
} from "./graph-canvas";
import "./styles.css";

/**
 * GraphView — outer chrome (data assembly, loader, error, settings
 * panel, floating overlay controls). All canvas / gesture / cursor
 * logic lives in `<GraphCanvas/>` so the rendering surface stays
 * isolated from the editor pane it's hosted inside.
 *
 * Contract: this component implements the standard `EditorViewProps`
 * contract — but unlike markdown / pdf / slides, it OPTS OUT of the
 * standard `<PaneDocHeader/>`. Graph owns its entire chrome:
 *   • No back/forward/title/source-toggle strip (those are exclusive
 *     to markdown/pdf rendering units).
 *   • A floating overlay (top-right inside the canvas) with two
 *     icon buttons: gear → toggles settings panel, magic wand →
 *     re-grows the network from its densest hub.
 *
 * The overlay is rendered via `<EditorPaneLayout overlay={...}/>` so
 * it floats above the canvas but doesn't intercept canvas pointer
 * events outside the buttons themselves.
 */

const WIKILINK_RE = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;

function buildGraph(vault: Map<string, FileNode>): {
  nodes: GraphNode[];
  links: GraphLink[];
} {
  // First pass: enumerate markdown files, build name→id lookup so
  // wikilinks (which reference display names, not ids) resolve.
  const nodes: GraphNode[] = [];
  const byName = new Map<string, string>();
  for (const node of vault.values()) {
    if (node.kind !== "file") continue;
    if (!/\.md$/i.test(node.name)) continue;
    const baseName = node.name.replace(/\.md$/i, "");
    nodes.push({ id: node.id, name: baseName, path: node.id, val: 1 });
    byName.set(baseName.toLowerCase(), node.id);
  }

  // Second pass: scan each file body for wikilinks and emit links.
  // Sizing nodes by sqrt(degree) keeps hubs visually distinct without
  // exploding into blobs that dominate the canvas.
  const links: GraphLink[] = [];
  const degree = new Map<string, number>();
  for (const node of vault.values()) {
    if (node.kind !== "file") continue;
    const content = node.content ?? "";
    if (!content) continue;
    let m: RegExpExecArray | null;
    WIKILINK_RE.lastIndex = 0;
    while ((m = WIKILINK_RE.exec(content)) !== null) {
      const targetName = m[1].trim().toLowerCase();
      const targetId = byName.get(targetName);
      if (!targetId || targetId === node.id) continue;
      links.push({ source: node.id, target: targetId });
      degree.set(node.id, (degree.get(node.id) ?? 0) + 1);
      degree.set(targetId, (degree.get(targetId) ?? 0) + 1);
    }
  }
  for (const n of nodes) {
    const d = degree.get(n.id) ?? 0;
    n.val = 1 + Math.sqrt(d);
  }
  return { nodes, links };
}

export function GraphView(props: EditorViewProps) {
  const { vault, onOpenFile } = props;
  const canvasRef = useRef<GraphCanvasHandle>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [showOrphans, setShowOrphans] = useState(true);

  // Display
  const [textFadeThreshold, setTextFadeThreshold] = useState(1.5);
  const [nodeSize, setNodeSize] = useState(4);
  const [linkThickness, setLinkThickness] = useState(0.6);

  // Forces
  const [centerForce, setCenterForce] = useState(0.5);
  const [repelForce, setRepelForce] = useState(10);
  const [linkForce, setLinkForce] = useState(0.4);
  const [linkDistance, setLinkDistance] = useState(150);

  // Build the raw graph from the vault, then apply UI filters.
  const rawGraph = useMemo(() => buildGraph(vault), [vault]);

  const filteredGraph = useMemo(() => {
    let nodes = rawGraph.nodes;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      nodes = nodes.filter(
        (n) =>
          (n.name?.toLowerCase().includes(q) ?? false) ||
          (n.path?.toLowerCase().includes(q) ?? false),
      );
    }
    const nodeIds = new Set(nodes.map((n) => n.id));
    let links = rawGraph.links.filter((l) => {
      const s = typeof l.source === "object" ? l.source.id : l.source;
      const t = typeof l.target === "object" ? l.target.id : l.target;
      return nodeIds.has(s) && nodeIds.has(t);
    });
    if (!showOrphans) {
      const linked = new Set<string>();
      for (const l of links) {
        const s = typeof l.source === "object" ? l.source.id : l.source;
        const t = typeof l.target === "object" ? l.target.id : l.target;
        linked.add(s);
        linked.add(t);
      }
      nodes = nodes.filter((n) => linked.has(n.id));
    }
    return { nodes, links };
  }, [rawGraph, searchQuery, showOrphans]);

  const handleReset = () => {
    setSearchQuery("");
    setShowOrphans(true);
    setTextFadeThreshold(1.5);
    setNodeSize(4);
    setLinkThickness(0.6);
    setCenterForce(0.5);
    setRepelForce(10);
    setLinkForce(0.4);
    setLinkDistance(150);
  };

  // No notes yet — short-circuit before initialising the simulation
  // (force-graph's zoomToFit crashes on empty data in some builds).
  if (rawGraph.nodes.length === 0) {
    return (
      <EditorPaneLayout>
        <div className="graph-view graph-view--empty">
          <div className="graph-empty-message">
            No notes yet — create a few markdown files with{" "}
            <code>[[wikilinks]]</code> between them to see the graph.
          </div>
        </div>
      </EditorPaneLayout>
    );
  }

  return (
    <EditorPaneLayout
      // NB: no `header` slot — graph deliberately opts out of the
      // standard PaneDocHeader. See contract notes in ../types.ts.
      overlay={
        <>
          <IconButton
            size="tiny"
            aria-label="Graph settings"
            aria-pressed={showSettings}
            title="Graph settings"
            onClick={() => setShowSettings((o) => !o)}
            className={showSettings ? "ring-1 ring-purple-500/40" : undefined}
          >
            <IcGear />
          </IconButton>
          <IconButton
            size="tiny"
            aria-label="Re-grow network"
            title="Re-grow network from densest hub"
            onClick={() => canvasRef.current?.growLayout()}
          >
            <IcWand />
          </IconButton>
        </>
      }
    >
      <div className="graph-view">
        <GraphCanvas
          ref={canvasRef}
          nodes={filteredGraph.nodes}
          links={filteredGraph.links}
          textFadeThreshold={textFadeThreshold}
          nodeSize={nodeSize}
          linkThickness={linkThickness}
          centerForce={centerForce}
          repelForce={repelForce}
          linkForce={linkForce}
          linkDistance={linkDistance}
          onNodeClick={(n) => {
            if (n?.id) onOpenFile?.(n.id);
          }}
        />
        {showSettings && (
          <GraphSettingsPanel
            onClose={() => setShowSettings(false)}
            onReset={handleReset}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            showOrphans={showOrphans}
            setShowOrphans={setShowOrphans}
            textFadeThreshold={textFadeThreshold}
            setTextFadeThreshold={setTextFadeThreshold}
            nodeSize={nodeSize}
            setNodeSize={setNodeSize}
            linkThickness={linkThickness}
            setLinkThickness={setLinkThickness}
            centerForce={centerForce}
            setCenterForce={setCenterForce}
            repelForce={repelForce}
            setRepelForce={setRepelForce}
            linkForce={linkForce}
            setLinkForce={setLinkForce}
            linkDistance={linkDistance}
            setLinkDistance={setLinkDistance}
          />
        )}
      </div>
    </EditorPaneLayout>
  );
}

/**
 * Floating, collapsible settings panel mirroring Obsidian's graph
 * popover. Sits in the top-right corner under the overlay buttons.
 * Each section is independently collapsible so the panel doesn't
 * dominate the canvas when only Forces tweaks are needed.
 */
type SettingsProps = {
  onClose: () => void;
  onReset: () => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  showOrphans: boolean;
  setShowOrphans: (v: boolean) => void;
  textFadeThreshold: number;
  setTextFadeThreshold: (v: number) => void;
  nodeSize: number;
  setNodeSize: (v: number) => void;
  linkThickness: number;
  setLinkThickness: (v: number) => void;
  centerForce: number;
  setCenterForce: (v: number) => void;
  repelForce: number;
  setRepelForce: (v: number) => void;
  linkForce: number;
  setLinkForce: (v: number) => void;
  linkDistance: number;
  setLinkDistance: (v: number) => void;
};

function GraphSettingsPanel(p: SettingsProps) {
  return (
    <div
      className="graph-settings-panel"
      role="dialog"
      aria-label="Graph settings"
    >
      <div className="graph-settings-header">
        <span className="graph-settings-title">Graph settings</span>
        <div className="graph-settings-header-actions">
          <IconButton
            size="tiny"
            aria-label="Reset to defaults"
            title="Reset to defaults"
            onClick={p.onReset}
          >
            <IcSync />
          </IconButton>
          <IconButton
            size="tiny"
            aria-label="Close settings"
            title="Close"
            onClick={p.onClose}
          >
            <IcClose />
          </IconButton>
        </div>
      </div>

      <GraphSettingsSection title="Filters" defaultOpen={true}>
        <div className="graph-settings-row">
          <input
            type="text"
            className="graph-settings-input"
            placeholder="Search nodes…"
            value={p.searchQuery}
            onChange={(e) => p.setSearchQuery(e.target.value)}
          />
        </div>
        <label className="graph-settings-row">
          <input
            type="checkbox"
            checked={p.showOrphans}
            onChange={(e) => p.setShowOrphans(e.target.checked)}
          />
          <span>Show orphans</span>
        </label>
      </GraphSettingsSection>

      <GraphSettingsSection title="Display">
        <SliderRow
          label="Text fade threshold"
          value={p.textFadeThreshold}
          min={0}
          max={3}
          step={0.1}
          onChange={p.setTextFadeThreshold}
        />
        <SliderRow
          label="Node size"
          value={p.nodeSize}
          min={1}
          max={12}
          step={0.5}
          onChange={p.setNodeSize}
        />
        <SliderRow
          label="Link thickness"
          value={p.linkThickness}
          min={0.1}
          max={3}
          step={0.1}
          onChange={p.setLinkThickness}
        />
      </GraphSettingsSection>

      <GraphSettingsSection title="Forces">
        <SliderRow
          label="Center force"
          value={p.centerForce}
          min={0}
          max={2}
          step={0.05}
          onChange={p.setCenterForce}
        />
        <SliderRow
          label="Repel force"
          value={p.repelForce}
          min={1}
          max={30}
          step={1}
          onChange={p.setRepelForce}
        />
        <SliderRow
          label="Link force"
          value={p.linkForce}
          min={0.1}
          max={2}
          step={0.05}
          onChange={p.setLinkForce}
        />
        <SliderRow
          label="Link distance"
          value={p.linkDistance}
          min={20}
          max={400}
          step={5}
          onChange={p.setLinkDistance}
        />
      </GraphSettingsSection>
    </div>
  );
}

function GraphSettingsSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="graph-settings-section">
      <button
        type="button"
        className="graph-settings-section-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <IcChevronRight
          className={`graph-settings-chevron${open ? " is-open" : ""}`}
        />
        <span>{title}</span>
      </button>
      {open && <div className="graph-settings-section-body">{children}</div>}
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="graph-settings-row graph-settings-slider-row">
      <span className="graph-settings-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="graph-settings-value">{value}</span>
    </label>
  );
}
