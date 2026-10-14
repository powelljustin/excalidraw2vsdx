import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(__dirname, "web"),
  server: {
    host: "127.0.0.1",
    port: 47321,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8080",
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 47321,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8080",
    },
  },
  build: {
    outDir: resolve(__dirname, "dist-web"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "web/index.html"),
        library: resolve(__dirname, "web/library.html"),
        upload: resolve(__dirname, "web/upload.html"),
      },
    },
  },
});
