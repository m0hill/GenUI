import { setTimeout as delay } from "node:timers/promises"
import { action, type ExecuteOptions, Genui, subscription } from "genui"
import { type ActionCall, type ActionResult, type SubscriptionRequest } from "genui/protocol"
import { Type, type Tool } from "@earendil-works/pi-ai"
import { z } from "zod"
import { type JsonPreferenceStore, PreferredTripName } from "../preferences.js"
import { searchWeb } from "./web-search.js"

interface GenuiContext {
  readonly preferences: JsonPreferenceStore
}

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
  execute: async (_context: GenuiContext, input) => ({
    content: await searchWeb(input.query, new AbortController().signal),
  }),
})

const SavePreferenceInput = z.strictObject({
  preference: PreferredTripName,
})
const SavePreferenceOutput = z.strictObject({ preference: PreferredTripName })

const savePreferenceAction = action({
  name: "preferences.save",
  description: "Save the user's preferred trip for this local app process.",
  intent: 'Save "{input.preference}" as your preferred trip',
  effect: "write",
  input: SavePreferenceInput,
  inputJsonSchema: z.toJSONSchema(SavePreferenceInput, { io: "input" }),
  output: SavePreferenceOutput,
  outputJsonSchema: z.toJSONSchema(SavePreferenceOutput),
  execute: async (context: GenuiContext, input) => {
    const saved = await context.preferences.save(input.preference)
    return { preference: saved.preferredTrip }
  },
})

const TimeTickInput = z.strictObject({})
const TimeTickEvent = z.strictObject({ timestamp: z.iso.datetime() })

const timeTickSubscription = subscription({
  name: "time.tick",
  description: "Receive the current ISO timestamp once per second.",
  input: TimeTickInput,
  inputJsonSchema: z.toJSONSchema(TimeTickInput, { io: "input" }),
  event: TimeTickEvent,
  eventJsonSchema: z.toJSONSchema(TimeTickEvent),
  async *subscribe(_context: GenuiContext, _input, { signal }) {
    while (!signal.aborted) {
      yield { timestamp: new Date().toISOString() }
      try {
        await delay(1_000, undefined, { signal })
      } catch (error) {
        if (!signal.aborted) throw error
      }
    }
  },
})

const runtime = new Genui<GenuiContext>({
  actions: [webSearchAction, savePreferenceAction],
  subscriptions: [timeTickSubscription],
})
export const generatedUi = runtime.generation({
  actions: [webSearchAction, savePreferenceAction],
  subscriptions: [timeTickSubscription],
})

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

export const executeGeneratedUiAction = (
  call: ActionCall,
  preferences: JsonPreferenceStore,
  approve?: ExecuteOptions["approve"],
): Promise<ActionResult> => runtime.execute(call, { preferences }, { approve })

export const openGeneratedUiSubscription = (
  request: SubscriptionRequest,
  preferences: JsonPreferenceStore,
  signal: AbortSignal,
) => runtime.subscribe(request, { preferences }, { signal })
