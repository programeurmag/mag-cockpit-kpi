import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Le build sort dans docs/ (GitHub Pages sert /docs sur main). On NE vide
// pas docs/ au build (emptyOutDir: false) parce que docs/data/kpis.json et
// docs/data/history.json sont écrits séparément par scripts/build_kpis.py
// (workflow kpis.yml) et doivent survivre à chaque déploiement du front.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "docs",
    emptyOutDir: false,
  },
});
