import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(__dirname, "web"),
  server: {
    host: "127.0.0.1",
    port: 47321,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 47321,
    strictPort: true,
  },
  build: {
    outDir: resolve(__dirname, "dist-web"),
    emptyOutDir: true,
  },
});
