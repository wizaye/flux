/**
 * Single source of truth for the active theme — derived from the
 * `.dark` class on `<html>` (managed by the global ThemeProvider).
 *
 * Why this exists: every component that paints differently in light
 * vs dark (Mermaid, Shiki, future chart libs) used to mount its own
 * `MutationObserver`. With several preview panes open that's N
 * observers + N React re-renders per theme flip. This module owns a
 * single observer for the whole app and exposes a `useIsDark()` hook
 * built on `useSyncExternalStore` so components subscribe with no
 * setState plumbing.
 */
import { useSyncExternalStore } from "react";

type Listener = () => void;

let currentIsDark = readDom();
const listeners = new Set<Listener>();
let observer: MutationObserver | null = null;

function readDom(): boolean {
  if (typeof document === "undefined") return true;
  return document.documentElement.classList.contains("dark");
}

function ensureObserver(): void {
  if (observer || typeof document === "undefined") return;
  observer = new MutationObserver(() => {
    const next = readDom();
    if (next === currentIsDark) return;
    currentIsDark = next;
    for (const fn of listeners) fn();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

function subscribe(fn: Listener): () => void {
  ensureObserver();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
    // Keep the observer alive even at zero listeners — the cost is
    // a single passive MutationObserver, and tearing it down just to
    // re-create it on the next subscription causes a brief window
    // where currentIsDark goes stale.
  };
}

function getSnapshot(): boolean {
  return currentIsDark;
}

function getServerSnapshot(): boolean {
  return true;
}

/** Subscribe to the active dark-mode flag. Single observer per app. */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Read the current dark-mode flag without subscribing. Useful inside
 *  callbacks / effects that don't need to re-render when it changes. */
export function getIsDark(): boolean {
  return currentIsDark;
}

/** Subscribe to dark-mode changes WITHOUT going through React state.
 *  Use this when you need to react to a theme flip in the same frame
 *  the CSS class change lands (e.g. re-render Mermaid SVGs directly)
 *  instead of waiting for React's scheduler. Returns an unsubscribe fn. */
export function subscribeIsDark(fn: Listener): () => void {
  return subscribe(fn);
}
