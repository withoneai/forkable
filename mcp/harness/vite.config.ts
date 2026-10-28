import { defineConfig } from "vite";
export default defineConfig({ root: __dirname, server: { port: 52291, strictPort: true, proxy: { "/mcp": "http://127.0.0.1:52290" } } });
