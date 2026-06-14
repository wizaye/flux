import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./components/theme-provider";

// enable shadcn "inline" theme variables on the document root
try {
  document.documentElement.classList.add("inline");
} catch (e) {
  // no-op for environments without DOM
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
    <App />
    </ThemeProvider>
  </React.StrictMode>,
);
