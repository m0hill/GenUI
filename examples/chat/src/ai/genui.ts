import { Genui } from "genui"
import { codeDialect, type Surface } from "genui/protocol"
import { Type, type Tool } from "@earendil-works/pi-ai"

const runtime = new Genui<Readonly<Record<string, never>>>({ actions: [] })

export const renderUiTool: Tool = {
  name: "render_ui",
  description: "Render an interactive generated interface in the conversation.",
  parameters: Type.Object({
    content: Type.String({
      minLength: 1,
      maxLength: 100_000,
      description: "A complete code/0 HTML fragment following the generated UI instructions.",
    }),
  }),
}

export const generatedUiInstructions = runtime.instructions()

export const createGeneratedSurface = (content: string): Promise<Surface> =>
  runtime.surface({
    dialect: codeDialect,
    content,
    actions: [],
  })
