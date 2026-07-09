import { action, Genui, type Surface } from "@genui/genui"
import { z } from "zod"

export interface GenuiActionContext {
  readonly chatId?: string
  readonly signal?: AbortSignal
}

interface DemoNote {
  readonly id: string
  readonly text: string
  readonly createdAt: string
  readonly chatId?: string
}

const demoNotes: DemoNote[] = []

const weatherCodeText = (code: number): string => {
  if (code === 0) return "Clear"
  if ([1, 2, 3].includes(code)) return "Partly cloudy"
  if ([45, 48].includes(code)) return "Fog"
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle"
  if ([61, 63, 65, 66, 67].includes(code)) return "Rain"
  if ([71, 73, 75, 77].includes(code)) return "Snow"
  if ([80, 81, 82].includes(code)) return "Showers"
  if ([95, 96, 99].includes(code)) return "Thunderstorm"
  return "Mixed"
}

const hashText = (value: string): number => {
  let hash = 0
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }
  return hash
}

const hslToHex = (hue: number, saturation: number, lightness: number): string => {
  const normalizedSaturation = saturation / 100
  const normalizedLightness = lightness / 100
  const chroma = (1 - Math.abs(2 * normalizedLightness - 1)) * normalizedSaturation
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = normalizedLightness - chroma / 2
  const [r, g, b] =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x]

  const toHex = (channel: number): string =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, "0")

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

const createPalette = (seed: string, count: number): string[] => {
  const base = hashText(seed || "genui")
  return Array.from({ length: count }, (_value, index) => {
    const hue = (base + index * 47) % 360
    const saturation = 54 + ((base + index * 11) % 24)
    const lightness = 42 + ((base + index * 7) % 18)
    return hslToHex(hue, saturation, lightness)
  })
}

const safeFetchJson = async <T>(url: string, signal: AbortSignal | undefined): Promise<T> => {
  const timeout = AbortSignal.timeout(12_000)
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`)
  }

  return (await response.json()) as T
}

const geocodingResultSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        country: z.string().optional(),
        latitude: z.number(),
        longitude: z.number(),
        timezone: z.string().optional(),
      }),
    )
    .optional(),
})

const forecastResultSchema = z.object({
  daily: z.object({
    time: z.array(z.string()),
    temperature_2m_max: z.array(z.number()),
    temperature_2m_min: z.array(z.number()),
    weather_code: z.array(z.number()),
  }),
})

const lookupWeather = async (
  city: string,
  days: number,
  signal: AbortSignal | undefined,
): Promise<unknown> => {
  const geocodingUrl = new URL("https://geocoding-api.open-meteo.com/v1/search")
  geocodingUrl.searchParams.set("name", city)
  geocodingUrl.searchParams.set("count", "1")
  geocodingUrl.searchParams.set("language", "en")
  geocodingUrl.searchParams.set("format", "json")

  const geocoding = geocodingResultSchema.parse(
    await safeFetchJson<unknown>(geocodingUrl.href, signal),
  )
  const place = geocoding.results?.[0]
  if (place === undefined) {
    return { city, found: false, summary: `No forecast location found for ${city}.` }
  }

  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast")
  forecastUrl.searchParams.set("latitude", String(place.latitude))
  forecastUrl.searchParams.set("longitude", String(place.longitude))
  forecastUrl.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,weather_code")
  forecastUrl.searchParams.set("timezone", place.timezone ?? "auto")
  forecastUrl.searchParams.set("forecast_days", String(days))

  const forecast = forecastResultSchema.parse(
    await safeFetchJson<unknown>(forecastUrl.href, signal),
  )
  const daily = forecast.daily.time.map((date, index) => ({
    date,
    highC: forecast.daily.temperature_2m_max[index],
    lowC: forecast.daily.temperature_2m_min[index],
    condition: weatherCodeText(forecast.daily.weather_code[index] ?? -1),
  }))

  return {
    city: place.country ? `${place.name}, ${place.country}` : place.name,
    found: true,
    source: "Open-Meteo",
    daily,
  }
}

export const defaultGenuiActionNames = ["chat.follow_up"] as const

export interface CreateGeneratedSurfaceInput {
  readonly chatId: string
  readonly toolCallId: string
  readonly html: string
  readonly actions?: readonly string[]
}

export const genui = new Genui<GenuiActionContext>({
  actions: [
    action({
      name: "chat.follow_up",
      description: "Submit a follow-up prompt into the current chat composer.",
      effect: "write",
      input: z.object({ prompt: z.string().trim().min(1).max(1200) }),
      execute: () => undefined,
    }),
    action({
      name: "demo.time.now",
      description: "Return the server's current ISO time and locale display text.",
      effect: "read",
      input: z.object({}),
      execute: () => {
        const now = new Date()
        return {
          iso: now.toISOString(),
          display: now.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "medium" }),
        }
      },
    }),
    action({
      name: "demo.palette.generate",
      description: "Generate a deterministic color palette from a short seed.",
      effect: "read",
      input: z.object({
        seed: z.string().trim().min(1).max(80),
        count: z.number().int().min(3).max(8).default(5),
      }),
      execute: (_ctx, input) => ({
        seed: input.seed,
        colors: createPalette(input.seed, input.count),
      }),
    }),
    action({
      name: "demo.weather.lookup",
      description: "Look up a short weather forecast for a city using Open-Meteo.",
      effect: "read",
      input: z.object({
        city: z.string().trim().min(1).max(120),
        days: z.number().int().min(1).max(5).default(3),
      }),
      execute: (ctx, input) => lookupWeather(input.city, input.days, ctx.signal),
    }),
    action({
      name: "demo.notes.create",
      description: "Create an in-memory demo note for this local app session.",
      effect: "write",
      policy: "ask",
      input: z.object({ text: z.string().trim().min(1).max(500) }),
      execute: (ctx, input) => {
        const note = {
          id: `note-${Date.now()}-${demoNotes.length + 1}`,
          text: input.text,
          createdAt: new Date().toISOString(),
          chatId: ctx.chatId,
        }
        demoNotes.unshift(note)
        return note
      },
    }),
    action({
      name: "demo.notes.list",
      description: "List recent in-memory demo notes created through generated UI.",
      effect: "read",
      input: z.object({ limit: z.number().int().min(1).max(10).default(5) }),
      execute: (_ctx, input) => ({ notes: demoNotes.slice(0, input.limit) }),
    }),
  ],
})

export const genuiPromptActions = (): string => genui.instructions()

export const createGeneratedSurface = ({
  actions,
  chatId,
  html,
  toolCallId,
}: CreateGeneratedSurfaceInput): Promise<Surface> =>
  genui.surface({
    content: html,
    actions: actions ?? defaultGenuiActionNames,
    meta: { chatId, toolCallId },
  })
