/**
 * Detached-window detection — pure helper, no React.
 *
 * Lives in its own module so `detached-doc-shell.tsx` can stay a
 * pure component file. Vite's react-refresh plugin requires
 * component files to ONLY export React components; mixing
 * function exports breaks HMR.
 */
export function isDetachedWindow(): boolean {
  if (typeof window === "undefined") return false;
  return (
    new URLSearchParams(window.location.search).get("mode") === "detached"
  );
}
