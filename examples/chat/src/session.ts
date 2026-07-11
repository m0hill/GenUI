import { randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"

const SessionHeader = z.object({
  type: z.literal("session"),
  version: z.literal(1),
  id: z.string().min(1),
  timestamp: z.iso.datetime(),
})

const MessageEntry = z.object({
  type: z.literal("message"),
  id: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  timestamp: z.iso.datetime(),
  message: z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(16_000),
  }),
})

type MessageEntry = z.infer<typeof MessageEntry>

export type ChatMessage = MessageEntry["message"]

export interface PersistedTurn {
  readonly userId: string
  readonly assistantId: string
  readonly prompt: string
  readonly response: string
}

export interface AppendTurnInput {
  readonly userId: string
  readonly assistantId: string
  readonly prompt: string
  readonly response: string
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
        version: 1,
        id: randomUUID(),
        timestamp: new Date().toISOString(),
      } as const
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, `${JSON.stringify(header)}\n`, { encoding: "utf8", mode: 0o600 })
      return new JsonlChatSession(filePath, [])
    }

    if (content.length === 0) {
      const header = {
        type: "session",
        version: 1,
        id: randomUUID(),
        timestamp: new Date().toISOString(),
      } as const
      await writeFile(filePath, `${JSON.stringify(header)}\n`, { encoding: "utf8", mode: 0o600 })
      return new JsonlChatSession(filePath, [])
    }

    const lines = content.split("\n")
    const header = SessionHeader.safeParse(parseLine(lines[0] ?? ""))
    if (!header.success) {
      throw new Error(`Chat session file is invalid: ${filePath}`)
    }

    const entries: MessageEntry[] = []
    for (const line of lines.slice(1)) {
      if (line.trim().length === 0) continue
      const entry = MessageEntry.safeParse(parseLine(line))
      if (entry.success) entries.push(entry.data)
    }

    return new JsonlChatSession(filePath, entries)
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
        response: assistant.message.content,
      })
      index += 1
    }
    return turns
  }

  getHistory(): ChatMessage[] {
    return this.getTurns().flatMap((turn) => [
      { role: "user", content: turn.prompt },
      { role: "assistant", content: turn.response },
    ])
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
        message: { role: "assistant", content: input.response },
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
}
