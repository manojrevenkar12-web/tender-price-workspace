/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env["API_URL"] ?? "http://localhost:4000", changeOrigin: true } },
  },
  preview: {
    port: 4173,
    proxy: { "/api": { target: process.env["API_URL"] ?? "http://localhost:4000", changeOrigin: true } },
  },
  build: { sourcemap: true, chunkSizeWarningLimit: 900 },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    css: true,
  },
});
