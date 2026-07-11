import { fileURLToPath } from "node:url"
import { build } from "esbuild"

await build({
  bundle: true,
  entryPoints: [fileURLToPath(new URL("../src/client.ts", import.meta.url))],
  format: "esm",
  outfile: fileURLToPath(new URL("../public/client.js", import.meta.url)),
  minify: true,
  platform: "browser",
  target: "es2022",
})
