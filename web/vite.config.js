import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// 前端构建产物输出到上层项目根的 dist/，server.mjs 直接服务该目录。
// 开发时 vite dev server 把 /api 代理到 node 后端（默认 3678）。
export default defineConfig({
  plugins: [react()],
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL("../dist", import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3678",
    },
  },
});
