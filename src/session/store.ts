import { randomUUID } from "node:crypto"
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Message, TextContent } from "@earendil-works/pi-ai"
import { z } from "zod"

const SESSION_VERSION = 3
const SESSION_DIR = fileURLToPath(new URL("../../.sessions/", import.meta.url))

const messageSchema = z.custom<Message>(
  (value) => typeof value === "object" && value !== null && "role" in value,
)

const sessionHeaderSchema = z.object({
  type: z.literal("session"),
  version: z.number().optional(),
  id: z.string().min(1),
  timestamp: z.string(),
  cwd: z.string(),
})

const sessionMessageEntrySchema = z.object({
  type: z.literal("message"),
  id: z.string(),
  parentId: z.string().nullable(),
  timestamp: z.string(),
  message: messageSchema,
})

const sessionFileEntrySchema = z.discriminatedUnion("type", [
  sessionHeaderSchema,
  sessionMessageEntrySchema,
])

type SessionHeader = z.infer<typeof sessionHeaderSchema>
type SessionMessageEntry = z.infer<typeof sessionMessageEntrySchema>
type SessionFileEntry = z.infer<typeof sessionFileEntrySchema>

export interface PersistedChatSession {
  id: string
  filePath: string
  createdAt: string
  messages: Message[]
  lastEntryId: string | null
}

export interface ChatThread {
  id: string
  title: string
  updatedAt: string
  messageCount: number
}

const parseSessionLine = (line: string): SessionFileEntry | undefined => {
  if (line.trim() === "") return undefined

  let json: unknown
  try {
    json = JSON.parse(line)
  } catch {
    return undefined
  }

  const result = sessionFileEntrySchema.safeParse(json)
  return result.success ? result.data : undefined
}

const sessionFileTimestamp = (timestamp: string): string => timestamp.replace(/[:.]/g, "-")

const createEntryId = (): string => randomUUID().slice(0, 8)

const textContent = (content: Message["content"]): string => {
  if (typeof content === "string") return content

  return content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join(" ")
}

export const messagePreview = (message: Message): string => textContent(message.content).trim()

const sessionTitle = (messages: readonly Message[]): string => {
  const firstUserMessage = messages.find((message) => message.role === "user")
  const title = firstUserMessage === undefined ? "" : messagePreview(firstUserMessage)
  return title.length > 0 ? title : "New chat"
}

const loadSessionFile = async (filePath: string): Promise<PersistedChatSession | undefined> => {
  const text = await readFile(filePath, "utf8")
  const entries = text
    .split("\n")
    .map(parseSessionLine)
    .filter((entry): entry is SessionFileEntry => entry !== undefined)

  const header = entries[0]
  if (header === undefined || header.type !== "session") return undefined

  const messageEntries = entries.filter(
    (entry): entry is SessionMessageEntry => entry.type === "message",
  )

  return {
    id: header.id,
    filePath,
    createdAt: header.timestamp,
    messages: messageEntries.map((entry) => entry.message),
    lastEntryId: messageEntries.at(-1)?.id ?? null,
  }
}

const sessionFiles = async (): Promise<string[]> => {
  await mkdir(SESSION_DIR, { recursive: true })
  const entries = await readdir(SESSION_DIR, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => join(SESSION_DIR, entry.name))
}

export const createSession = async (): Promise<PersistedChatSession> => {
  await mkdir(SESSION_DIR, { recursive: true })

  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const filePath = join(SESSION_DIR, `${sessionFileTimestamp(createdAt)}_${id}.jsonl`)
  const header: SessionHeader = {
    type: "session",
    version: SESSION_VERSION,
    id,
    timestamp: createdAt,
    cwd: process.cwd(),
  }

  await writeFile(filePath, `${JSON.stringify(header)}\n`, { flag: "wx" })

  return {
    id,
    filePath,
    createdAt,
    messages: [],
    lastEntryId: null,
  }
}

export const loadSession = async (id: string): Promise<PersistedChatSession | undefined> => {
  const files = await sessionFiles()
  const matchingFile = files.find((filePath) => filePath.endsWith(`_${id}.jsonl`))
  if (matchingFile !== undefined) return loadSessionFile(matchingFile)

  for (const filePath of files) {
    const session = await loadSessionFile(filePath)
    if (session?.id === id) return session
  }

  return undefined
}

export const appendSessionMessage = async (
  session: Pick<PersistedChatSession, "filePath" | "lastEntryId">,
  message: Message,
): Promise<string> => {
  const entry: SessionMessageEntry = {
    type: "message",
    id: createEntryId(),
    parentId: session.lastEntryId,
    timestamp: new Date().toISOString(),
    message,
  }

  await appendFile(session.filePath, `${JSON.stringify(entry)}\n`)
  session.lastEntryId = entry.id
  return entry.id
}

export const listSessions = async (): Promise<ChatThread[]> => {
  const threads: ChatThread[] = []

  for (const filePath of await sessionFiles()) {
    const session = await loadSessionFile(filePath)
    if (session === undefined) continue

    const fileStats = await stat(filePath)
    const lastMessageAt = session.messages.at(-1)?.timestamp
    const updatedAt =
      lastMessageAt === undefined ? session.createdAt : new Date(lastMessageAt).toISOString()

    threads.push({
      id: session.id,
      title: sessionTitle(session.messages),
      updatedAt: Number.isNaN(Date.parse(updatedAt)) ? fileStats.mtime.toISOString() : updatedAt,
      messageCount: session.messages.length,
    })
  }

  return threads.toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}
