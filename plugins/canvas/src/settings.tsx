/**
 * Plugin-level settings panel — explanatory text only for now.
 */
export default function CanvasSettings() {
  return (
    <div className="flex flex-col gap-5 text-[13px]">
      <div>
        <h3 className="text-[14px] font-medium">Canvas</h3>
        <p className="text-[12px] text-muted-foreground">
          Infinite-canvas whiteboards powered by{" "}
          <a
            href="https://excalidraw.com"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Excalidraw
          </a>
          . Files are stored as plain <code>*.excalidraw</code> JSON
          in your vault and round-trip with the Excalidraw web app.
        </p>
        <p className="text-[12px] text-muted-foreground mt-1.5">
          New canvases default to the <code>canvases/</code> folder
          at your vault root.
        </p>
      </div>
    </div>
  );
}
