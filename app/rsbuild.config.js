import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { index: "./src/main.jsx" }, define: { APP_VERSION: JSON.stringify(version) } },
  html: { template: "./index.html" },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8788" } }
});
