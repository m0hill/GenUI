import { randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { codeDialect, parseSurface, type Surface } from "genui/protocol"
import { z } from "zod"

const StoredSurface = z.custom<Surface>(
  (value) => parseSurface(value)?.dialect === codeDialect,
  "Invalid generated UI surface",
)

const SessionHeader = z
  .object({
    type: z.literal("session"),
    id: z.string().min(1),
    timestamp: z.iso.datetime(),
  })
  .strict()

const AssistantContentBlock = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text"),
      text: z.string().max(64_000),
      textSignature: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("thinking"),
      thinking: z.string().max(64_000),
      thinkingSignature: z.string().optional(),
      redacted: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool"),
      tool: z.literal("web_search"),
      query: z.string().min(1).max(8_000),
      status: z.enum(["complete", "error"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("surface"),
      surface: StoredSurface,
    })
    .strict(),
])

const StoredMessage = z.discriminatedUnion("role", [
  z
    .object({
      role: z.literal("user"),
      content: z.string().min(1).max(16_000),
    })
    .strict(),
  z
    .object({
      role: z.literal("assistant"),
      content: z.array(AssistantContentBlock).min(1),
    })
    .strict(),
])

const MessageEntry = z
  .object({
    type: z.literal("message"),
    id: z.string().min(1),
    parentId: z.string().min(1).nullable(),
    timestamp: z.iso.datetime(),
    message: StoredMessage,
  })
  .strict()

type MessageEntry = z.infer<typeof MessageEntry>

/** Maximum UTF-8 JSON size persisted for one generated surface snapshot. */
export const maxSurfaceSnapshotBytes = 64 * 1024

export const SurfaceSnapshot = z
  .json()
  .refine(
    (snapshot) => Buffer.byteLength(JSON.stringify(snapshot), "utf8") <= maxSurfaceSnapshotBytes,
    "Generated UI snapshot is too large.",
  )

const SurfaceSnapshotEntry = z
  .object({
    type: z.literal("surface_snapshot"),
    surfaceId: z.string().min(1).max(256),
    timestamp: z.iso.datetime(),
    snapshot: SurfaceSnapshot,
  })
  .strict()

const SessionEntry = z.discriminatedUnion("type", [MessageEntry, SurfaceSnapshotEntry])

export type SurfaceSnapshot = z.infer<typeof SurfaceSnapshot>

export type AssistantContentBlock = z.infer<typeof AssistantContentBlock>
export type ChatMessage = MessageEntry["message"]

export interface PersistedTurn {
  readonly userId: string
  readonly assistantId: string
  readonly prompt: string
  readonly assistantContent: readonly AssistantContentBlock[]
}

export interface AppendTurnInput {
  readonly userId: string
  readonly assistantId: string
  readonly prompt: string
  readonly assistantContent: readonly AssistantContentBlock[]
}

export interface SurfaceSnapshotInput {
  readonly surfaceId: string
  readonly snapshot: SurfaceSnapshot
}

const parseLine = (line: string): unknown => {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

/** Append-only JSONL storage for the chat's single local session. */
export class JsonlChatSession {
  private writeQueue: Promise<void> = Promise.resolve()

  private constructor(
    private readonly filePath: string,
    private readonly entries: MessageEntry[],
    private readonly surfaceSnapshots: Map<string, SurfaceSnapshot>,
  ) {}

  static async open(filePath: string): Promise<JsonlChatSession> {
    let content: string
    try {
      content = await readFile(filePath, "utf8")
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error
      }

      const header = {
        type: "session",
        id: randomUUID(),
        timestamp: new Date().toISOString(),
      } as const
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, `${JSON.stringify(header)}\n`, { encoding: "utf8", mode: 0o600 })
      return new JsonlChatSession(filePath, [], new Map())
    }

    if (content.length === 0) {
      const header = {
        type: "session",
        id: randomUUID(),
        timestamp: new Date().toISOString(),
      } as const
      await writeFile(filePath, `${JSON.stringify(header)}\n`, { encoding: "utf8", mode: 0o600 })
      return new JsonlChatSession(filePath, [], new Map())
    }

    const lines = content.split("\n")
    const header = SessionHeader.safeParse(parseLine(lines[0] ?? ""))
    if (!header.success) {
      throw new Error(`Chat session file is invalid: ${filePath}`)
    }

    const entries: MessageEntry[] = []
    const surfaceSnapshots = new Map<string, SurfaceSnapshot>()
    for (const line of lines.slice(1)) {
      if (line.trim().length === 0) continue
      const entry = SessionEntry.safeParse(parseLine(line))
      if (!entry.success) continue
      if (entry.data.type === "message") entries.push(entry.data)
      else surfaceSnapshots.set(entry.data.surfaceId, entry.data.snapshot)
    }

    return new JsonlChatSession(filePath, entries, surfaceSnapshots)
  }

  getTurns(): PersistedTurn[] {
    const turns: PersistedTurn[] = []
    for (let index = 0; index < this.entries.length - 1; index += 1) {
      const user = this.entries[index]
      const assistant = this.entries[index + 1]
      if (user?.message.role !== "user" || assistant?.message.role !== "assistant") continue

      turns.push({
        userId: user.id,
        assistantId: assistant.id,
        prompt: user.message.content,
        assistantContent: assistant.message.content,
      })
      index += 1
    }
    return turns
  }

  getHistory(): ChatMessage[] {
    return this.getTurns().flatMap((turn) => [
      { role: "user", content: turn.prompt },
      { role: "assistant", content: [...turn.assistantContent] },
    ])
  }

  getSurfaceSnapshot(surfaceId: string): SurfaceSnapshot | undefined {
    return this.surfaceSnapshots.get(surfaceId)
  }

  appendTurn(input: AppendTurnInput): Promise<void> {
    const write = this.writeQueue.then(async () => {
      const timestamp = new Date().toISOString()
      const previousEntry = this.entries.at(-1)
      const user: MessageEntry = {
        type: "message",
        id: input.userId,
        parentId: previousEntry?.id ?? null,
        timestamp,
        message: { role: "user", content: input.prompt },
      }
      const assistant: MessageEntry = {
        type: "message",
        id: input.assistantId,
        parentId: user.id,
        timestamp: new Date().toISOString(),
        message: { role: "assistant", content: [...input.assistantContent] },
      }

      await appendFile(
        this.filePath,
        `${JSON.stringify(user)}\n${JSON.stringify(assistant)}\n`,
        "utf8",
      )
      this.entries.push(user, assistant)
    })

    this.writeQueue = write.catch(() => undefined)
    return write
  }

  appendSurfaceSnapshots(inputs: readonly SurfaceSnapshotInput[]): Promise<void> {
    const write = this.writeQueue.then(async () => {
      const knownSurfaceIds = new Set(
        this.entries.flatMap((entry) =>
          entry.message.role === "assistant"
            ? entry.message.content.flatMap((block) =>
                block.type === "surface" ? [block.surface.id] : [],
              )
            : [],
        ),
      )
      const entries = inputs.flatMap((input) => {
        if (!knownSurfaceIds.has(input.surfaceId)) return []
        if (!SurfaceSnapshot.safeParse(input.snapshot).success) return []
        if (
          JSON.stringify(this.surfaceSnapshots.get(input.surfaceId)) ===
          JSON.stringify(input.snapshot)
        ) {
          return []
        }
        return [
          {
            type: "surface_snapshot",
            surfaceId: input.surfaceId,
            timestamp: new Date().toISOString(),
            snapshot: input.snapshot,
          } as const,
        ]
      })
      if (entries.length === 0) return

      await appendFile(
        this.filePath,
        entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
        "utf8",
      )
      for (const entry of entries) this.surfaceSnapshots.set(entry.surfaceId, entry.snapshot)
    })

    this.writeQueue = write.catch(() => undefined)
    return write
  }
}
