import path from "node:path";
import { fileURLToPath } from "node:url";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [basicSsl()],
  resolve: {
    alias: {
      "@deskcapade/shared": path.resolve(root, "../shared/types.ts"),
    },
  },
  server: {
    host: true,
    allowedHosts: true, // lets tunnel hostnames (cloudflared / ngrok) through
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
      // Phone and laptop connect here; Vite forwards to the backend's websocket relay.
      "/ws": {
        target: "ws://localhost:8787",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});