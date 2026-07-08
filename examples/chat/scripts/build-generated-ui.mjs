import * as esbuild from "esbuild"

const options = {
  entryPoints: ["src/browser/generated-ui.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: "public/generated-ui.js",
}

if (process.argv.includes("--watch")) {
  const context = await esbuild.context({ ...options, logLevel: "info" })
  await context.watch()
  console.log("Watching generated UI browser bundle...")
} else {
  await esbuild.build(options)
}
