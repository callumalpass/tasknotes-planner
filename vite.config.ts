import { offlineShellPlugin } from "@mdbase-dev/sdk/offline-shell/build";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), offlineShellPlugin()],
  // The SDK starts its own module Worker from a module-relative URL; keep it out of
  // dev pre-bundling so that URL still names the SDK's files, and emit ES workers.
  optimizeDeps: { exclude: ["@mdbase-dev/sdk"] },
  worker: { format: "es" },
  build: {
    chunkSizeWarningLimit: 560,
    rollupOptions: {
      output: {
        manualChunks: (id) =>
          id.includes("/node_modules/@mdbase-dev/connect")
            ? "mdbase-connect"
            : undefined,
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    exclude: ["e2e/**", "node_modules/**"],
    globals: true,
    setupFiles: "./src/test/setup.ts",
    restoreMocks: true,
  },
});
