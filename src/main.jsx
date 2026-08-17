import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import CockpitMAG from "./CockpitMAG.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <CockpitMAG />
  </StrictMode>,
);
