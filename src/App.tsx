import "./App.css";
import * as React from "react";
import { LatticeShell } from "./components/flux-ui/layout/lattice-shell";
import { IconScale } from "./components/flux-ui/common/icons";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "./components/ui/sonner";
import { ErrorToaster } from "./components/flux-ui/common/error-toaster";
import { VaultPicker } from "./components/flux-ui/modals/vault-picker";
import { useVaultStore } from "./state/vault-store";

function App() {
  const { isVaultOpen } = useVaultStore();
  const [showVaultPicker, setShowVaultPicker] = React.useState(false);
  
  // Show vault picker on mount if no vault is open
  React.useEffect(() => {
    if (!isVaultOpen) {
      setShowVaultPicker(true);
    }
  }, [isVaultOpen]);
  
  return (
    <TooltipProvider delayDuration={200}>
      <IconScale>
        <LatticeShell />
        <VaultPicker
          open={showVaultPicker && !isVaultOpen}
          onClose={() => setShowVaultPicker(false)}
        />
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
