import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import ForceGraph from "force-graph";

/**
 * GraphCanvas — isolated force-graph surface.
 *
 * Direct port of lattice/src/components/editor/GraphCanvas.tsx with
 * three deviations:
 *
 *   1. Theme detection reads `<html>.classList.contains("dark")`
 *      (flux convention) instead of `data-theme="light"` (lattice).
 *   2. KanbanColumn / task-status branching is dropped — flux's
 *      graph has only "file" nodes until the task system lands.
 *   3. DEV-only `__latticeGraphInst` hooks are removed; flux exposes
 *      the same handle through the React ref instead.
 *
 * Owns ONLY the force-graph instance + its host `<div>`. The parent
 * (`GraphView`) supplies `{nodes, links}` and a click handler. All
 * focus / hover / drag / wheel routing lives here — see the design
 * notes inline (they were arrived at via real platform bug-hunts and
 * should not be diluted in the port).
 */

// Alpha applied to dimmed ("out of focus") nodes / links when a focus
// selection is active. Replaces lattice's old gaussian-blur composite
// (which was expensive on WebView2 / Windows because ctx.filter is
// software-rasterised at DPR-scaled buffer size). Alpha-dim matches
// the macOS branch and stays smooth on every platform.
const DIM_NODE_ALPHA = 0.18;
const DIM_LINK_ALPHA = 0.12;

export type GraphCanvasHandle = {
  /** Smoothly zoom to fit all nodes in view. */
  zoomToFit: (durationMs?: number, paddingPx?: number) => void;
  /** Clear pinned positions, re-randomize, and reheat the simulation. */
  reseedLayout: () => void;
  /** Re-render the graph by progressively adding nodes one-at-a-time
   *  starting from the highest-degree seed (BFS order). Gives the
   *  user a "growing network" animation instead of a single jarring
   *  re-randomize. Bound to the magic-wand button in `GraphView`. */
  growLayout: () => void;
};

export type GraphNode = {
  id: string;
  name?: string;
  path?: string;
  val?: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
};

export type GraphLink = { source: string | GraphNode; target: string | GraphNode };

type GraphCanvasProps = {
  nodes: GraphNode[];
  links: GraphLink[];
  textFadeThreshold: number;
  nodeSize: number;
  linkThickness: number;
  centerForce: number;
  repelForce: number;
  linkForce: number;
  linkDistance: number;
  onNodeClick?: (node: GraphNode) => void;
};

/**
 * Read the active theme palette. Returns the full set of normal /
 * dim / highlight colors the canvas needs. Reads `.dark` on `<html>`
 * (flux convention) — NOT `data-theme` like lattice.
 */
function readThemeColors() {
  const dark = document.documentElement.classList.contains("dark");
  return {
    node: dark ? "#ffffff" : "#222222",
    nodeMuted: dark ? "#cccccc" : "#555555",
    nodeDim: dark ? "rgba(255,255,255,0.30)" : "rgba(34,34,34,0.30)",
    nodeHighlight: "#8b5cf6",
    link: dark ? "#555555" : "#b3b3b3",
    linkDim: dark ? "rgba(106,106,106,0.35)" : "rgba(154,154,154,0.25)",
    linkHighlight: "#8b5cf6",
  };
}

/**
 * force-graph's `.d.ts` declares the default export as a class, but
 * at runtime it's a Kapsule factory: `ForceGraph()` returns a binder
 * that you then invoke with the host element — `ForceGraph()(el)`.
 * This alias keeps the call-site readable.
 */
type ForceGraphFactory = () => (el: HTMLElement) => ForceGraphInstance;
type ForceGraphInstance = {
  // Just enough surface to satisfy the call sites; everything else
  // bleeds through `any` because force-graph's chainable API is too
  // wide to model exhaustively.
  [key: string]: any;
};

const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(
  function GraphCanvas(
    {
      nodes,
      links,
      textFadeThreshold,
      nodeSize,
      linkThickness,
      centerForce,
      repelForce,
      linkForce,
      linkDistance,
      onNodeClick,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const instanceRef = useRef<ForceGraphInstance | null>(null);
    // Track the last data payload we pushed so we don't restart the
    // simulation / recenter when the parent re-renders with the same
    // structural data.
    const lastDataRef = useRef<{ nodes: GraphNode[]; links: GraphLink[] } | null>(null);
    // True once we've framed the network with the first zoomToFit
    // after data arrives — subsequent data pushes don't re-frame.
    const framedRef = useRef(false);
    // Latest click handler, exposed via ref so the init effect can stay
    // dep-free (init runs exactly once for the lifetime of the canvas).
    const onNodeClickRef = useRef(onNodeClick);
    useEffect(() => {
      onNodeClickRef.current = onNodeClick;
    }, [onNodeClick]);
    // True while the user is mid-drag (panning background or moving
    // a node). Suppresses hover-cursor flips during drag.
    const draggingRef = useRef(false);
    // Snapshot of `lockedNodeIdRef` at drag-start so we can restore
    // (or clear) the click-selection when the user releases.
    const dragPriorSelectionRef = useRef<string | null>(null);
    // Selection state for click-to-focus. Refs (not state) so the
    // force-graph accessors — which run every frame inside the canvas
    // render loop — read the latest value without forcing a React
    // re-render. `connectedNodeIdsRef` is the 1-hop neighborhood of
    // the selected node (plus the selected node itself).
    const lockedNodeIdRef = useRef<string | null>(null);
    const selectedNodeIdRef = useRef<string | null>(null);
    const connectedNodeIdsRef = useRef<Set<string>>(new Set());
    // True while the wand's progressive-grow animation is running.
    // Suppresses the parent-data useEffect so a mid-animation render
    // doesn't snap straight to the full graph and abort the build-up.
    const animatingRef = useRef(false);
    const animationTimerRef = useRef<number | null>(null);

    /**
     * Update the selection refs so the next render frame redraws with
     * the new highlight state.
     *
     * `silent` (default false): when true, do NOT reheat the d3-force
     * simulation. Used by the HOVER path — hover state changes already
     * trigger force-graph's internal canvas repaint, so we only need
     * the new refs to be in place; reheating would re-energise the
     * physics, which (with our loose velocityDecay=0.15) causes nodes
     * to drift away from the cursor, which flips hover-target, which
     * triggers another reheat — an unbounded orbit feedback loop that
     * manifested as the graph "spinning under the cursor".
     *
     * When called from CLICK / DRAG (silent=false), we DO reheat
     * briefly so the in-flight simulation snaps the highlighted
     * node's neighbourhood into a slightly more compact configuration.
     * The setTimeout cools down again within 600ms.
     */
    const applySelection = (
      selectedId: string | null,
      opts?: { silent?: boolean },
    ) => {
      const connected = new Set<string>();
      if (selectedId && lastDataRef.current) {
        connected.add(selectedId);
        for (const link of lastDataRef.current.links) {
          const sId = typeof link.source === "object"
            ? (link.source as GraphNode).id
            : link.source;
          const tId = typeof link.target === "object"
            ? (link.target as GraphNode).id
            : link.target;
          if (sId === selectedId) connected.add(tId as string);
          else if (tId === selectedId) connected.add(sId as string);
        }
      }
      selectedNodeIdRef.current = selectedId;
      connectedNodeIdsRef.current = connected;
      if (opts?.silent) return;
      const g = instanceRef.current;
      if (!g) return;
      // Wake the render loop just enough to repaint with the new
      // highlight; particles on highlighted links also need an active
      // sim to animate.
      if (typeof g.d3AlphaTarget === "function") {
        g.d3AlphaTarget(0.05);
      }
      if (typeof g.d3ReheatSimulation === "function") {
        g.d3ReheatSimulation();
      }
      window.setTimeout(() => {
        if (typeof instanceRef.current?.d3AlphaTarget === "function") {
          instanceRef.current.d3AlphaTarget(0);
        }
      }, 600);
    };

    // ── Init the force-graph instance exactly once ─────────────────
    useEffect(() => {
      if (!containerRef.current || instanceRef.current) return;
      const el = containerRef.current;
      const FG = ForceGraph as unknown as ForceGraphFactory;
      const inst = FG()(el);
      instanceRef.current = inst;

      inst
        .backgroundColor("transparent")
        .nodeLabel("name")
        // Must match nodeSize so force-graph's BUILT-IN pointer
        // hit-test (which uses sqrt(val) * nodeRelSize) lines up with
        // the visual radius we draw in `nodeCanvasObject`. If these
        // diverge, clicks miss or register on empty space.
        .nodeRelSize(nodeSize)
        .minZoom(0.2)
        .maxZoom(8)
        // Explicit re-enable on every property — some force-graph
        // builds toggle interactions off when other accessors fire
        // on init under WebView2. Cheap and idempotent.
        .enableZoomInteraction(true)
        .enablePointerInteraction(true)
        .enableNodeDrag(true)
        // Fluid feel: lower velocity decay (default 0.4) makes nodes
        // glide and bounce elastically instead of snapping into place;
        // lower alpha decay lets the sim breathe longer.
        .d3VelocityDecay(0.15)
        .d3AlphaDecay(0.01)
        // Custom link renderer. With focus active, "incident" links
        // (those touching the selected node) draw bright on top while
        // every other link draws at very low alpha. Mode "replace"
        // means force-graph skips its built-in line draw and uses ours.
        .linkCanvasObjectMode(() => "replace")
        .linkCanvasObject((link: any, ctx: CanvasRenderingContext2D) => {
          const c = readThemeColors();
          const selectedId = selectedNodeIdRef.current;
          const s = link.source;
          const t = link.target;
          // After force-graph's first graphData() call it mutates
          // string ids into node refs; both shapes need to work.
          if (typeof s !== "object" || typeof t !== "object") return;
          if (s.x == null || s.y == null || t.x == null || t.y == null) return;
          const sId = s.id;
          const tId = t.id;
          const incident = selectedId
            ? sId === selectedId || tId === selectedId
            : false;
          const prevAlpha = ctx.globalAlpha;
          if (selectedId && !incident) {
            ctx.strokeStyle = c.link;
            ctx.lineWidth = linkThickness;
            ctx.globalAlpha = prevAlpha * DIM_LINK_ALPHA;
          } else if (incident) {
            ctx.strokeStyle = c.linkHighlight;
            ctx.lineWidth = linkThickness * 2;
          } else {
            ctx.strokeStyle = c.link;
            ctx.lineWidth = linkThickness;
          }
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(t.x, t.y);
          ctx.stroke();
          ctx.globalAlpha = prevAlpha;
        })
        .linkDirectionalParticles((link: any) => {
          // Particles ONLY on the selected node's edges — gives a
          // subtle "flowing" effect that draws the eye to the focus
          // neighborhood without bogging down the whole canvas.
          const selectedId = selectedNodeIdRef.current;
          if (!selectedId) return 0;
          const sId = typeof link.source === "object" ? link.source.id : link.source;
          const tId = typeof link.target === "object" ? link.target.id : link.target;
          return sId === selectedId || tId === selectedId ? 2 : 0;
        })
        .linkDirectionalParticleSpeed(0.006)
        .linkDirectionalParticleWidth(1.5)
        .linkDirectionalParticleColor(() => readThemeColors().linkHighlight)
        .nodeCanvasObject(
          (node: any, ctx: CanvasRenderingContext2D, scale: number) => {
            const c = readThemeColors();
            const selectedId = selectedNodeIdRef.current;
            const connected = connectedNodeIdsRef.current;

            // Dim state: focus is active AND this node is neither the
            // selected node nor a 1-hop neighbor. Draw the node + its
            // label at very low alpha so the focused subgraph pops.
            const dimmed = !!selectedId
              && node.id !== selectedId
              && !connected.has(node.id);

            let fillColor: string;
            let labelColor: string;
            let forceLabel = false;

            if (!selectedId) {
              fillColor = c.node;
              labelColor = c.nodeMuted;
            } else if (node.id === selectedId) {
              fillColor = c.nodeHighlight;
              labelColor = c.nodeHighlight;
              forceLabel = true;
            } else if (!dimmed) {
              fillColor = c.node;
              labelColor = c.nodeMuted;
              forceLabel = true;
            } else {
              fillColor = c.node;
              labelColor = c.nodeMuted;
            }

            const prevAlpha = ctx.globalAlpha;
            if (dimmed) ctx.globalAlpha = prevAlpha * DIM_NODE_ALPHA;

            const radius = Math.sqrt(node.val ?? 1) * nodeSize;
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
            ctx.fillStyle = fillColor;
            ctx.fill();

            // Outline the selected node so it pops even more.
            if (node.id === selectedId) {
              ctx.lineWidth = 2 / scale;
              ctx.strokeStyle = c.nodeHighlight;
              ctx.beginPath();
              ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
              ctx.stroke();
            }

            if (!dimmed && (scale > textFadeThreshold || forceLabel)) {
              // Font scales inversely with zoom so labels stay a
              // consistent on-screen size. Dimmed nodes never get
              // labels — they're meant to recede into the backdrop.
              const fontSize = Math.max(10, 14 / scale);
              ctx.font = `${fontSize}px Inter, sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillStyle = labelColor;
              ctx.fillText(
                node.name ?? "",
                node.x,
                node.y + radius + fontSize * 0.9,
              );
            }

            ctx.globalAlpha = prevAlpha;
          },
        )
        .onNodeClick((node: any) => {
          // Toggle: clicking the already-selected node clears focus.
          const same = lockedNodeIdRef.current === node?.id;
          const nextLock = same ? null : (node?.id ?? null);
          lockedNodeIdRef.current = nextLock;
          applySelection(nextLock);
          // Still fire the parent's open-file handler so the editor
          // navigates as usual.
          if (!same) onNodeClickRef.current?.(node);
        })
        .onBackgroundClick(() => {
          lockedNodeIdRef.current = null;
          applySelection(null);
        })
        // Hover swaps the cursor between grab (background) and
        // pointer (node) — but ONLY when not actively dragging so
        // we don't flicker mid-pan.
        .onNodeHover((node: any) => {
          if (draggingRef.current) return;
          el.style.cursor = node ? "pointer" : "grab";
          if (!lockedNodeIdRef.current) {
            // Silent: never reheat the d3-force simulation from a
            // hover event. Reheating + loose velocityDecay (0.15)
            // makes nodes drift away from the cursor, which then
            // flips the hover target, which reheats again — an
            // unbounded orbit feedback loop that manifests as the
            // graph "spinning under the cursor". force-graph's
            // internal renderer already calls a repaint on hover-
            // state change, so we get the dim/highlight pass for
            // free without touching the simulation.
            applySelection(node?.id ?? null, { silent: true });
          }
        })
        .onNodeDrag((node: any) => {
          // First tick of a drag: latch focus onto the grabbed node
          // so its 1-hop neighborhood lights up while the user drags
          // it around. dragPriorSelectionRef remembers whether there
          // was already a click-selection so we know whether to
          // restore it (or clear focus) on drag end.
          if (!draggingRef.current) {
            draggingRef.current = true;
            el.style.cursor = "grabbing";
            dragPriorSelectionRef.current = lockedNodeIdRef.current;
            lockedNodeIdRef.current = node?.id ?? null;
            if (selectedNodeIdRef.current !== node?.id) {
              applySelection(node?.id ?? null);
            }
          }
        })
        .onNodeDragEnd(() => {
          draggingRef.current = false;
          el.style.cursor = "grab";
          // Restore whatever focus state existed before the drag —
          // if the user had nothing selected, clear focus; if they
          // had a click-selection on a different node, put it back.
          // This keeps drag's highlight strictly transient so it
          // doesn't compete with the existing click-to-focus model.
          const prior = dragPriorSelectionRef.current;
          dragPriorSelectionRef.current = null;
          lockedNodeIdRef.current = prior;
          if (prior !== selectedNodeIdRef.current) {
            applySelection(prior);
          }
        });

      // ── Force tuning ───────────────────────────────────────────
      // The default d3-force config fans the network across the
      // entire pane. We tighten three forces so the layout stays
      // compact and readable:
      //   • charge: weaker repulsion with distanceMax bounded, so
      //     disconnected nodes don't fly off to the edges.
      //   • link distance: longer springs (150) since nodes are now
      //     much larger; tighter values jam edges through node centers.
      //   • center: strong pull toward (0,0) so disconnected nodes
      //     and isolated components don't drift off-camera.
      inst.d3VelocityDecay(0.15);
      inst.d3AlphaDecay(0.01);
      const charge = inst.d3Force?.("charge");
      if (charge?.strength) charge.strength(-repelForce * 16);
      if (charge?.distanceMax) charge.distanceMax(500);
      const link = inst.d3Force?.("link");
      if (link?.distance) link.distance(linkDistance);
      if (link?.strength) link.strength(linkForce);
      const center = inst.d3Force?.("center");
      if (center?.strength) center.strength(centerForce);

      // ── Custom wheel routing ───────────────────────────────────
      // Three input devices generate `wheel` events:
      //   1. MOUSE WHEEL  → zoom (let d3-zoom handle).
      //   2. TRACKPAD PINCH → zoom (ctrlKey === true, let d3-zoom handle).
      //   3. TRACKPAD TWO-FINGER SWIPE → PAN (we handle).
      // The `|deltaY| < 25 && fractional` test catches trackpad swipes
      // without misclassifying Windows hi-dpi mouse wheels (which emit
      // fractional deltaY ~33).
      const isTrackpadSwipe = (e: WheelEvent) => {
        if (e.ctrlKey) return false;
        if (e.deltaX !== 0) return true;
        if (e.deltaMode !== 0) return false;
        if (Math.abs(e.deltaY) < 25 && e.deltaY !== Math.trunc(e.deltaY)) {
          return true;
        }
        return false;
      };
      const onWheel = (e: WheelEvent) => {
        if (!isTrackpadSwipe(e)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const g = instanceRef.current;
        if (!g) return;
        const c = g.centerAt?.() ?? { x: 0, y: 0 };
        const k = g.zoom?.() ?? 1;
        g.centerAt(c.x + e.deltaX / k, c.y + e.deltaY / k);
      };
      el.addEventListener("wheel", onWheel, { passive: false, capture: true });

      // Pan-on-drag cursor: force-graph's bundled d3-zoom handles the
      // actual pan logic, but it doesn't update CSS cursor.
      const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        draggingRef.current = true;
        el.style.cursor = "grabbing";
      };
      const onPointerUp = () => {
        draggingRef.current = false;
        el.style.cursor = "grab";
      };
      el.addEventListener("pointerdown", onPointerDown);
      window.addEventListener("pointerup", onPointerUp);

      if (el.clientWidth && el.clientHeight) {
        inst.width(el.clientWidth).height(el.clientHeight);
      }
      const ro = new ResizeObserver(() => {
        if (!instanceRef.current) return;
        const { clientWidth, clientHeight } = el;
        if (clientWidth && clientHeight) {
          instanceRef.current.width(clientWidth).height(clientHeight);
        }
      });
      ro.observe(el);

      // Re-evaluate accessor colors when the user toggles theme.
      // Flux toggles `.dark` on `<html>` so we watch for class
      // mutations there (lattice watches `data-theme`).
      const themeObs = new MutationObserver(() => {
        const g = instanceRef.current;
        if (!g) return;
        if (typeof g.d3AlphaTarget === "function") g.d3AlphaTarget(0.02);
        if (typeof g.d3ReheatSimulation === "function") g.d3ReheatSimulation();
        window.setTimeout(() => {
          if (typeof instanceRef.current?.d3AlphaTarget === "function") {
            instanceRef.current.d3AlphaTarget(0);
          }
        }, 400);
      });
      themeObs.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });

      el.style.cursor = "grab";

      return () => {
        ro.disconnect();
        themeObs.disconnect();
        el.removeEventListener("wheel", onWheel, { capture: true } as any);
        el.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("pointerup", onPointerUp);
        if (animationTimerRef.current !== null) {
          window.clearInterval(animationTimerRef.current);
          animationTimerRef.current = null;
        }
        if (instanceRef.current?._destructor) {
          instanceRef.current._destructor();
        }
        instanceRef.current = null;
        lastDataRef.current = null;
        framedRef.current = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Push data only when structurally different ─────────────────
    useEffect(() => {
      if (!instanceRef.current) return;
      // Don't trample the wand's progressive-grow animation.
      if (animatingRef.current) return;
      const last = lastDataRef.current;
      const same =
        last &&
        last.nodes.length === nodes.length &&
        last.links.length === links.length;
      if (same) return;
      // New parent data invalidates any focus on a now-stale id.
      if (selectedNodeIdRef.current) {
        const stillThere = nodes.some((n) => n.id === selectedNodeIdRef.current);
        if (!stillThere) {
          lockedNodeIdRef.current = null;
          selectedNodeIdRef.current = null;
          connectedNodeIdsRef.current = new Set();
        }
      }
      instanceRef.current.graphData({ nodes, links });
      lastDataRef.current = { nodes, links };
      // First data push for this canvas instance: let the simulation
      // settle for ~1s, then frame the network.
      if (!framedRef.current) {
        framedRef.current = true;
        window.setTimeout(() => {
          instanceRef.current?.zoomToFit?.(800, 80);
        }, 1000);
      }
    }, [nodes, links]);

    // Dynamic property updates ─────────────────────────────────────
    useEffect(() => {
      if (instanceRef.current) {
        instanceRef.current.nodeRelSize(nodeSize);
      }
    }, [nodeSize]);

    useEffect(() => {
      const g = instanceRef.current;
      if (!g) return;
      const center = g.d3Force?.("center");
      if (center?.strength) {
        center.strength(centerForce);
        g.d3ReheatSimulation();
      }
    }, [centerForce]);

    useEffect(() => {
      const g = instanceRef.current;
      if (!g) return;
      const charge = g.d3Force?.("charge");
      if (charge?.strength) {
        charge.strength(-repelForce * 16);
        g.d3ReheatSimulation();
      }
    }, [repelForce]);

    useEffect(() => {
      const g = instanceRef.current;
      if (!g) return;
      const link = g.d3Force?.("link");
      if (link?.strength) {
        link.strength(linkForce);
        g.d3ReheatSimulation();
      }
    }, [linkForce]);

    useEffect(() => {
      const g = instanceRef.current;
      if (!g) return;
      const link = g.d3Force?.("link");
      if (link?.distance) {
        link.distance(linkDistance);
        g.d3ReheatSimulation();
      }
    }, [linkDistance]);

    useImperativeHandle(
      ref,
      () => ({
        zoomToFit: (duration = 400, padding = 40) => {
          instanceRef.current?.zoomToFit?.(duration, padding);
        },
        reseedLayout: () => {
          const g = instanceRef.current;
          if (!g) return;
          const data = g.graphData();
          if (data && Array.isArray(data.nodes)) {
            for (const n of data.nodes) {
              // Seed each node with random coords near origin so the
              // sim doesn't start from a degenerate single point.
              n.x = (Math.random() - 0.5) * 200;
              n.y = (Math.random() - 0.5) * 200;
              n.vx = 0;
              n.vy = 0;
              n.fx = undefined;
              n.fy = undefined;
            }
          }
          if (typeof g.d3ReheatSimulation === "function") {
            g.d3ReheatSimulation();
          }
          if (typeof g.zoomToFit === "function") {
            setTimeout(() => g.zoomToFit(600, 40), 800);
          }
        },
        growLayout: () => {
          const g = instanceRef.current;
          if (!g || !lastDataRef.current) return;
          if (animationTimerRef.current !== null) {
            window.clearInterval(animationTimerRef.current);
            animationTimerRef.current = null;
          }

          // Snapshot the FULL graph (the parent's source of truth)
          // before we tear down. We rebuild from this snapshot.
          const fullNodes = lastDataRef.current.nodes.map((n) => ({
            id: n.id,
            name: n.name,
            path: n.path,
            val: n.val,
          }));
          const fullLinks = lastDataRef.current.links.map((l) => ({
            source: typeof l.source === "object" ? l.source.id : l.source,
            target: typeof l.target === "object" ? l.target.id : l.target,
          })) as Array<{ source: string; target: string }>;
          if (fullNodes.length === 0) return;

          // Build adjacency for BFS + degree calc.
          const adjacency = new Map<string, Set<string>>();
          for (const n of fullNodes) adjacency.set(n.id, new Set());
          for (const l of fullLinks) {
            adjacency.get(l.source)?.add(l.target);
            adjacency.get(l.target)?.add(l.source);
          }

          // Seed = highest-degree node so the network grows from its
          // densest hub outward (visually most satisfying).
          let seed = fullNodes[0];
          let maxDeg = -1;
          for (const n of fullNodes) {
            const d = adjacency.get(n.id)?.size ?? 0;
            if (d > maxDeg) {
              maxDeg = d;
              seed = n;
            }
          }

          // BFS order from the seed. Disconnected components are
          // appended at the end so every node eventually shows up.
          const order: typeof fullNodes = [];
          const seen = new Set<string>();
          const queue: string[] = [seed.id];
          seen.add(seed.id);
          order.push(seed);
          while (queue.length > 0) {
            const cur = queue.shift()!;
            for (const next of adjacency.get(cur) ?? []) {
              if (seen.has(next)) continue;
              seen.add(next);
              const nextNode = fullNodes.find((n) => n.id === next);
              if (nextNode) {
                order.push(nextNode);
                queue.push(next);
              }
            }
          }
          for (const n of fullNodes) {
            if (!seen.has(n.id)) order.push(n);
          }

          // Clear focus before animating; otherwise the dimmer kicks
          // in mid-grow and the build is confusing to watch.
          lockedNodeIdRef.current = null;
          selectedNodeIdRef.current = null;
          connectedNodeIdsRef.current = new Set();

          // Start fresh with just the seed at origin.
          animatingRef.current = true;
          const seedNode: GraphNode = { ...order[0], x: 0, y: 0, vx: 0, vy: 0 };
          let live: GraphNode[] = [seedNode];
          let liveLinks: GraphLink[] = [];
          g.graphData({ nodes: live, links: liveLinks });
          lastDataRef.current = { nodes: live, links: liveLinks };

          let i = 1;
          animationTimerRef.current = window.setInterval(() => {
            const inst = instanceRef.current;
            if (!inst || i >= order.length) {
              if (animationTimerRef.current !== null) {
                window.clearInterval(animationTimerRef.current);
                animationTimerRef.current = null;
              }
              animatingRef.current = false;
              setTimeout(() => instanceRef.current?.zoomToFit?.(600, 80), 200);
              return;
            }
            const nextRaw = order[i];
            // Spawn each new node near one of its already-placed
            // neighbors so the camera doesn't have to chase nodes
            // flying in from random corners.
            const neighborIds = adjacency.get(nextRaw.id) ?? new Set();
            const anchor = live.find((n) => neighborIds.has(n.id));
            const ax = anchor?.x ?? 0;
            const ay = anchor?.y ?? 0;
            const spawn: GraphNode = {
              ...nextRaw,
              x: ax + (Math.random() - 0.5) * 30,
              y: ay + (Math.random() - 0.5) * 30,
              vx: 0,
              vy: 0,
            };
            live = [...live, spawn];
            const liveIds = new Set(live.map((n) => n.id));
            // CRITICAL: force-graph MUTATES link objects in place,
            // replacing the string `source`/`target` IDs with node
            // object references after the first graphData() call.
            // If we filter `fullLinks` directly and pass those same
            // objects back in, by tick 2 every link's source/target
            // is an object — `liveIds.has(objectRef)` is always false
            // and we end up rendering nodes with no edges between
            // them. Clone each surviving link into a fresh object
            // every tick so force-graph mutates the copies and our
            // master list stays pristine.
            liveLinks = fullLinks
              .filter((l) => liveIds.has(l.source) && liveIds.has(l.target))
              .map((l) => ({ source: l.source, target: l.target }));
            inst.graphData({ nodes: live, links: liveLinks });
            lastDataRef.current = { nodes: live, links: liveLinks };
            if (typeof inst.d3ReheatSimulation === "function") {
              inst.d3ReheatSimulation();
            }
            if (i % 6 === 0 && typeof inst.zoomToFit === "function") {
              inst.zoomToFit(400, 80);
            }
            i++;
          }, 90);
        },
      }),
      [],
    );

    return (
      <div
        ref={containerRef}
        // Hard-set absolute fill + `touch-action: none` so WebView2 /
        // Chromium don't intercept trackpad gestures as page-level
        // pan/pinch BEFORE force-graph's d3-zoom sees them.
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          touchAction: "none",
          overscrollBehavior: "contain",
          cursor: "grab",
        }}
      />
    );
  },
);

export default GraphCanvas;
