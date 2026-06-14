import "./App.css";
import { LatticeShell } from "./components/flux-ui/layout/lattice-shell";
import { IconScale } from "./components/flux-ui/common/icons";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "./components/ui/sonner";
import { ErrorToaster } from "./components/flux-ui/common/error-toaster";

function App() {
  return (
    <TooltipProvider delayDuration={200}>
      <IconScale>
        <LatticeShell />
        {/* Subtle/professional defaults — no closeButton X (user-hidden),
            no richColors (too vibrant). Errors still render with the
            destructive icon via the custom `icons` map in `ui/sonner.tsx`. */}
        <Toaster position="bottom-right" />
        <ErrorToaster />
      </IconScale>
    </TooltipProvider>
  );
}

export default App;
