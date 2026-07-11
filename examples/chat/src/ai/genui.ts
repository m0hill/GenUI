import { action, Genui } from "genui"
import { codeDialect, type ActionCall, type ActionResult, type Surface } from "genui/protocol"
import { Type, type Tool } from "@earendil-works/pi-ai"
import { z } from "zod"
import { searchWeb } from "./web-search.js"

const WebSearchInput = z.strictObject({
  query: z.string().trim().min(1).max(500),
})

const WebSearchOutput = z.strictObject({
  content: z.string().max(50_000),
})

const webSearchAction = action({
  name: "web.search",
  description: "Search the web for current information and return text results.",
  effect: "read",
  input: WebSearchInput,
  inputJsonSchema: z.toJSONSchema(WebSearchInput, { io: "input" }),
  output: WebSearchOutput,
  outputJsonSchema: z.toJSONSchema(WebSearchOutput),
  execute: async (_context: Readonly<Record<string, never>>, input) => ({
    content: await searchWeb(input.query, new AbortController().signal),
  }),
})

const runtime = new Genui<Readonly<Record<string, never>>>({ actions: [webSearchAction] })
const context = Object.freeze({})

export const renderUiTool: Tool = {
  name: "render_ui",
  description:
    "Render an interactive generated interface in the conversation. Before calling this tool, audit the CSS: every visual property covered by a standardized host token must use that token through var(...); direct hardcoded colors, typography, borders, radii, rings, and shadows are invalid.",
  parameters: Type.Object({
    content: Type.String({
      minLength: 1,
      maxLength: 100_000,
      description:
        "A complete code/0 HTML fragment following all generated UI instructions, including the mandatory host-token visual policy.",
    }),
  }),
}

export const generatedUiInstructions = runtime.instructions()

export const createGeneratedSurface = (content: string): Promise<Surface> =>
  runtime.surface({
    dialect: codeDialect,
    content,
    actions: [webSearchAction.name],
  })

export const executeGeneratedUiAction = (call: ActionCall): Promise<ActionResult> =>
  runtime.execute(call, context)
