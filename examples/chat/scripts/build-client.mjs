import { fileURLToPath } from "node:url"
import { build } from "esbuild"

await build({
  bundle: true,
  entryPoints: [fileURLToPath(new URL("../src/client.ts", import.meta.url))],
  format: "esm",
  outfile: fileURLToPath(new URL("../dist/client.js", import.meta.url)),
  platform: "browser",
  sourcemap: true,
  target: "es2022",
})
