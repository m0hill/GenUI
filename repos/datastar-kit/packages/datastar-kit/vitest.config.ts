import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: "datastar-kit/jsx-runtime", replacement: fromRoot("./src/jsx-runtime.ts") },
      { find: "datastar-kit/jsx-dev-runtime", replacement: fromRoot("./src/jsx-dev-runtime.ts") },
      { find: "datastar-kit/sse", replacement: fromRoot("./src/sse.ts") },
      { find: "datastar-kit/debugger", replacement: fromRoot("./src/debugger.ts") },
      { find: "datastar-kit", replacement: fromRoot("./src/index.ts") }
    ]
  },
  test: {
    environment: "node",
    exclude: ["dist/**", "node_modules/**"]
  }
})
