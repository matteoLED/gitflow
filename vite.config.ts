import { defineConfig } from "vite";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [
    // Before react(): turns `src/routes/*.tsx` into the route tree (`src/routeTree.gen.ts`), one chunk per page.
    tanstackRouter({ target: "react", autoCodeSplitting: true, routeFileIgnorePattern: "\\.test\\.tsx?$" }),
    react(),
    // The React Compiler memoizes components and hooks at build time (its lint rules already guard the code).
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  clearScreen: false,
  // ES-module workers keep dynamic imports split: Shiki languages still load one by one inside the worker.
  worker: { format: "es" },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    css: false,
  },
});
