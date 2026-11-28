import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Each build's id (the Vercel commit, or the build time). It is put in the page and in /version.json, so an open page can
// see that a newer version was deployed (components/UpdateNotice.tsx).
const buildId = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 12) || String(Date.now());

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [react(), tailwindcss(), {
    name: "version-json",
    apply: "build",
    generateBundle() { this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ buildId }) }); },
  }],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
