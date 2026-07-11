import { Genui } from "genui"
import { codeDialect, type Surface } from "genui/protocol"
import { Type, type Tool } from "@earendil-works/pi-ai"

const runtime = new Genui<Readonly<Record<string, never>>>({ actions: [] })

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
    actions: [],
  })
