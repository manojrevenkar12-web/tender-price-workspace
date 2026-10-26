// Self-hosted (no request to Google Fonts: a German site that embeds them shares visitors' IPs).
import "@fontsource-variable/archivo/wdth.css";
import "./shared/theme/global.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
