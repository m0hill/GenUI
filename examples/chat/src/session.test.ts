import assert from "node:assert/strict"
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  GeneratedInterfaceRepairCycle,
  generatedInterfaceDiagnosticReport,
  parseGeneratedInterfaceSubmission,
} from "./ai/generated-interface-repair.js"
import { JsonlChatSession, maxSurfaceSnapshotBytes } from "./session.js"

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
        {
          type: "surface",
          surface: {
            id: "surface-1",
            content: "<button>Hello</button>",
            dialect: "code/0",
            grant: { surfaceId: "surface-1", actions: [], subscriptions: [] },
          },
        },
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
          {
            type: "surface",
            surface: {
              id: "surface-1",
              content: "<button>Hello</button>",
              dialect: "code/0",
              grant: { surfaceId: "surface-1", actions: [], subscriptions: [] },
            },
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

void test("JSONL session keeps generated-interface attempts and outcomes outside history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "genui-chat-"))
  const filePath = join(directory, "chat.jsonl")

  try {
    const session = await JsonlChatSession.open(filePath)
    const repair = new GeneratedInterfaceRepairCycle()
    const submission = parseGeneratedInterfaceSubmission(
      '<script type="module">genui.missing()</script>',
    )
    const diagnostics = [
      {
        code: "TS2339",
        line: 1,
        column: 29,
        message: "Property missing does not exist.",
      },
    ] as const
    const rejection = repair.reject(
      submission,
      diagnostics,
      generatedInterfaceDiagnosticReport(diagnostics),
    )
    const outcome = repair.modelStopped()
    assert(outcome)

    await session.appendGeneratedInterfaceAttempt({
      turnId: "turn-1",
      submission: rejection.attempt.submission,
      evidence: rejection.attempt.evidence,
      diagnostics: rejection.attempt.diagnostics,
    })
    await session.appendGeneratedInterfaceRepairOutcome({
      turnId: "turn-1",
      submissionCount: outcome.submissionCount,
      reason: outcome.reason,
      diagnosticCodes: outcome.diagnosticCodes,
    })

    const lines = (await readFile(filePath, "utf8")).trim().split("\n")
    assert.equal(lines.length, 3)
    const attempt = JSON.parse(lines[1] ?? "{}")
    assert.deepEqual(attempt, {
      type: "generated_interface_attempt",
      turnId: "turn-1",
      submission: 1,
      evidence: submission.evidence,
      diagnostics,
      timestamp: attempt.timestamp,
    })
    const terminal = JSON.parse(lines[2] ?? "{}")
    assert.deepEqual(terminal, {
      type: "generated_interface_repair_outcome",
      turnId: "turn-1",
      submissionCount: 1,
      reason: "model_stopped",
      diagnosticCodes: ["TS2339"],
      timestamp: terminal.timestamp,
    })
    assert.equal("terminal" in attempt, false)
    assert.equal("prompt" in attempt, false)
    assert.equal((await JsonlChatSession.open(filePath)).getHistory().length, 0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

void test("JSONL session never persists oversized or malformed generated-interface payloads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "genui-chat-"))
  const filePath = join(directory, "chat.jsonl")

  try {
    const session = await JsonlChatSession.open(filePath)
    const repair = new GeneratedInterfaceRepairCycle()
    const values = ["界".repeat(40_000), { privateMarker: "PRIVATE_MALFORMED_PAYLOAD" }]

    for (const value of values) {
      const submission = parseGeneratedInterfaceSubmission(value)
      assert(submission.diagnostic)
      const diagnostics = [submission.diagnostic]
      const rejection = repair.reject(
        submission,
        diagnostics,
        generatedInterfaceDiagnosticReport(diagnostics),
      )
      await session.appendGeneratedInterfaceAttempt({
        turnId: "turn-bounded",
        submission: rejection.attempt.submission,
        evidence: rejection.attempt.evidence,
        diagnostics: rejection.attempt.diagnostics,
      })
    }

    const persisted = await readFile(filePath, "utf8")
    assert.doesNotMatch(persisted, /界界/)
    assert.doesNotMatch(persisted, /PRIVATE_MALFORMED_PAYLOAD/)
    const records = persisted
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => JSON.parse(line))
    assert.deepEqual(
      records.map((record) => record.evidence.kind),
      ["oversized", "malformed"],
    )
    assert.equal(
      records.every((record) => !("content" in record.evidence)),
      true,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

void test("JSONL session persists the latest snapshot for a known surface", async () => {
  const directory = await mkdtemp(join(tmpdir(), "genui-chat-"))
  const filePath = join(directory, "chat.jsonl")

  try {
    const session = await JsonlChatSession.open(filePath)
    await session.appendTurn({
      userId: "user-1",
      assistantId: "assistant-1",
      prompt: "Make a counter",
      assistantContent: [
        {
          type: "surface",
          surface: {
            id: "surface-1",
            content: "<button>Increment</button>",
            dialect: "code/0",
            grant: { surfaceId: "surface-1", actions: [], subscriptions: [] },
          },
        },
      ],
    })

    await session.appendSurfaceSnapshots([
      { surfaceId: "surface-1", snapshot: { count: 1 } },
      { surfaceId: "unknown-surface", snapshot: { count: 99 } },
    ])
    await session.appendSurfaceSnapshots([{ surfaceId: "surface-1", snapshot: { count: 2 } }])

    const restored = await JsonlChatSession.open(filePath)
    assert.deepEqual(restored.getSurfaceSnapshot("surface-1"), { count: 2 })
    assert.equal(restored.getSurfaceSnapshot("unknown-surface"), undefined)
    assert.equal(restored.getTurns().length, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

void test("JSONL session does not append an unchanged surface snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "genui-chat-"))
  const filePath = join(directory, "chat.jsonl")

  try {
    const session = await JsonlChatSession.open(filePath)
    await session.appendTurn({
      userId: "user-1",
      assistantId: "assistant-1",
      prompt: "Make a selector",
      assistantContent: [
        {
          type: "surface",
          surface: {
            id: "surface-1",
            content: "<select></select>",
            dialect: "code/0",
            grant: { surfaceId: "surface-1", actions: [], subscriptions: [] },
          },
        },
      ],
    })
    await session.appendSurfaceSnapshots([{ surfaceId: "surface-1", snapshot: ["a", "b"] }])
    await session.appendSurfaceSnapshots([{ surfaceId: "surface-1", snapshot: ["a", "b"] }])

    assert.equal((await readFile(filePath, "utf8")).trim().split("\n").length, 4)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

void test("JSONL session does not append an oversized surface snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "genui-chat-"))
  const filePath = join(directory, "chat.jsonl")

  try {
    const session = await JsonlChatSession.open(filePath)
    await session.appendTurn({
      userId: "user-1",
      assistantId: "assistant-1",
      prompt: "Make a text editor",
      assistantContent: [
        {
          type: "surface",
          surface: {
            id: "surface-1",
            content: "<textarea></textarea>",
            dialect: "code/0",
            grant: { surfaceId: "surface-1", actions: [], subscriptions: [] },
          },
        },
      ],
    })
    await session.appendSurfaceSnapshots([
      { surfaceId: "surface-1", snapshot: "x".repeat(maxSurfaceSnapshotBytes) },
    ])

    assert.equal((await readFile(filePath, "utf8")).trim().split("\n").length, 3)
    assert.equal(session.getSurfaceSnapshot("surface-1"), undefined)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

void test("JSONL session reset deletes the conversation and starts a new session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "genui-chat-"))
  const filePath = join(directory, "chat.jsonl")

  try {
    const session = await JsonlChatSession.open(filePath)
    const originalHeader = JSON.parse((await readFile(filePath, "utf8")).trim())
    await session.appendTurn({
      userId: "user-1",
      assistantId: "assistant-1",
      prompt: "Hello",
      assistantContent: [{ type: "text", text: "Hi there" }],
    })
    const repair = new GeneratedInterfaceRepairCycle()
    const submission = parseGeneratedInterfaceSubmission("")
    assert(submission.diagnostic)
    const diagnostics = [submission.diagnostic]
    const rejection = repair.reject(
      submission,
      diagnostics,
      generatedInterfaceDiagnosticReport(diagnostics),
    )
    const outcome = repair.modelStopped()
    assert(outcome)
    await session.appendGeneratedInterfaceAttempt({
      turnId: "turn-reset",
      submission: rejection.attempt.submission,
      evidence: rejection.attempt.evidence,
      diagnostics: rejection.attempt.diagnostics,
    })
    await session.appendGeneratedInterfaceRepairOutcome({
      turnId: "turn-reset",
      submissionCount: outcome.submissionCount,
      reason: outcome.reason,
      diagnosticCodes: outcome.diagnosticCodes,
    })

    await session.reset()

    const lines = (await readFile(filePath, "utf8")).trim().split("\n")
    const newHeader = JSON.parse(lines[0] ?? "{}")
    assert.equal(lines.length, 1)
    assert.equal(newHeader.type, "session")
    assert.notEqual(newHeader.id, originalHeader.id)
    assert.deepEqual(session.getTurns(), [])
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
