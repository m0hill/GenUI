import assert from "node:assert/strict"
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { JsonlChatSession } from "./session.js"

void test("JSONL session persists and restores completed turns", async () => {
  const directory = await mkdtemp(join(tmpdir(), "genui-chat-"))
  const filePath = join(directory, "chat.jsonl")

  try {
    const session = await JsonlChatSession.open(filePath)
    await session.appendTurn({
      userId: "user-1",
      assistantId: "assistant-1",
      prompt: "Hello",
      assistantContent: [
        {
          type: "thinking",
          thinking: "Consider the greeting.",
          thinkingSignature: "thinking-signature",
        },
        { type: "tool", tool: "web_search", query: "friendly greetings", status: "complete" },
        { type: "text", text: "Hi there", textSignature: "text-signature" },
      ],
    })

    const lines = (await readFile(filePath, "utf8")).trim().split("\n")
    assert.equal(lines.length, 3)
    assert.equal(JSON.parse(lines[0] ?? "{}").type, "session")
    assert.deepEqual((await JsonlChatSession.open(filePath)).getHistory(), [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "Consider the greeting.",
            thinkingSignature: "thinking-signature",
          },
          {
            type: "tool",
            tool: "web_search",
            query: "friendly greetings",
            status: "complete",
          },
          { type: "text", text: "Hi there", textSignature: "text-signature" },
        ],
      },
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

void test("JSONL session skips malformed trailing records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "genui-chat-"))
  const filePath = join(directory, "chat.jsonl")

  try {
    const session = await JsonlChatSession.open(filePath)
    await session.appendTurn({
      userId: "user-1",
      assistantId: "assistant-1",
      prompt: "Hello",
      assistantContent: [{ type: "text", text: "Hi there" }],
    })
    await appendFile(filePath, '{"type":"message"', "utf8")

    assert.equal((await JsonlChatSession.open(filePath)).getTurns().length, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

void test("JSONL session refuses a non-empty file without a valid header", async () => {
  const directory = await mkdtemp(join(tmpdir(), "genui-chat-"))
  const filePath = join(directory, "chat.jsonl")

  try {
    await writeFile(filePath, '{"type":"message"}\n', "utf8")
    await assert.rejects(JsonlChatSession.open(filePath), /Chat session file is invalid/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
