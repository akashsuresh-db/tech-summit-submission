import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds straight into the FastAPI server's static dir so the app deploys
// as a single Databricks App. Dev proxies /api to the local backend.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "../server/static", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
