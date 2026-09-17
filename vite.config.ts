import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: "client",
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Allow importing files (shared/) that live outside the client root.
    fs: { allow: [root] },
    // Proxy the websocket to the game server during dev so the client can
    // always talk to `/ws` regardless of ports.
    proxy: {
      "/ws": {
        target: "ws://localhost:8787",
        ws: true,
      },
    },
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
});
