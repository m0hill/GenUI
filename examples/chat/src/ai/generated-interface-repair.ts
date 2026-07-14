import { createHash } from "node:crypto"
import type { GeneratedInterfaceDiagnostic } from "@genui/check"
import { maxSurfaceContentBytes } from "genui/protocol"

export const maxGeneratedInterfaceSubmissions = 3

export const generatedInterfaceRepairOutcomeReasons = [
  "budget_exhausted",
  "repeated_content",
  "model_stopped",
] as const

export type GeneratedInterfaceRepairOutcomeReason =
  (typeof generatedInterfaceRepairOutcomeReasons)[number]

export type GeneratedInterfaceSubmissionEvidence =
  | {
      readonly kind: "content"
      readonly content: string
      readonly utf8Bytes: number
      readonly digest: string
    }
  | {
      readonly kind: "oversized"
      readonly valueType: "string"
      readonly utf8Bytes: number
      readonly digest: string
    }
  | {
      readonly kind: "malformed"
      readonly valueType: string
      readonly utf8Bytes: number
      readonly digest: string
    }

export interface GeneratedInterfaceAttempt {
  readonly type: "generated_interface_attempt"
  readonly submission: number
  readonly evidence: GeneratedInterfaceSubmissionEvidence
  readonly diagnostics: readonly GeneratedInterfaceDiagnostic[]
}

export interface GeneratedInterfaceRepairOutcome {
  readonly type: "generated_interface_repair_outcome"
  readonly submissionCount: number
  readonly reason: GeneratedInterfaceRepairOutcomeReason
  readonly diagnosticCodes: readonly string[]
}

export interface GeneratedInterfaceSubmission {
  readonly content: string | undefined
  readonly fingerprint: string
  readonly evidence: GeneratedInterfaceSubmissionEvidence
  readonly diagnostic: GeneratedInterfaceDiagnostic | undefined
}

interface PreviousRejection {
  readonly fingerprint: string
  readonly diagnostics: readonly GeneratedInterfaceDiagnostic[]
  readonly report: string
}

const digest = (value: string): string => createHash("sha256").update(value).digest("hex")

const malformedValueType = (value: unknown): string => {
  if (value === undefined) return "missing"
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

const serializeMalformedValue = (value: unknown): string => {
  if (value === undefined) return "undefined"
  try {
    return JSON.stringify(value) ?? `[${malformedValueType(value)}]`
  } catch {
    return `[unserializable ${malformedValueType(value)}]`
  }
}

const diagnostic = (code: string, message: string): GeneratedInterfaceDiagnostic => ({
  code,
  line: 1,
  column: 1,
  message,
})

/** Normalize and bound one untrusted render_ui submission before checking it. */
export const parseGeneratedInterfaceSubmission = (value: unknown): GeneratedInterfaceSubmission => {
  if (typeof value !== "string") {
    const serialized = serializeMalformedValue(value)
    return {
      content: undefined,
      fingerprint: digest(`${malformedValueType(value)}:${serialized}`),
      evidence: {
        kind: "malformed",
        valueType: malformedValueType(value),
        utf8Bytes: Buffer.byteLength(serialized, "utf8"),
        digest: digest(serialized),
      },
      diagnostic: diagnostic("CHAT_UI001", "render_ui.content must be a string."),
    }
  }

  const content = value.trim()
  const utf8Bytes = Buffer.byteLength(content, "utf8")
  const contentDigest = digest(content)
  if (utf8Bytes > maxSurfaceContentBytes) {
    return {
      content: undefined,
      fingerprint: contentDigest,
      evidence: {
        kind: "oversized",
        valueType: "string",
        utf8Bytes,
        digest: contentDigest,
      },
      diagnostic: diagnostic(
        "GENUI004",
        `Generated UI content must not exceed ${String(maxSurfaceContentBytes)} UTF-8 bytes.`,
      ),
    }
  }

  return {
    content,
    fingerprint: contentDigest,
    evidence: { kind: "content", content, utf8Bytes, digest: contentDigest },
    diagnostic:
      content.length === 0
        ? diagnostic("CHAT_UI002", "render_ui.content must not be empty.")
        : undefined,
  }
}

export const generatedInterfaceDiagnosticReport = (
  diagnostics: readonly GeneratedInterfaceDiagnostic[],
): string =>
  [
    "The generated interface was rejected. Submit changed content that addresses these diagnostics:",
    ...diagnostics.map(
      (item) => `${item.code} at ${String(item.line)}:${String(item.column)}: ${item.message}`,
    ),
  ].join("\n")

const diagnosticCodes = (diagnostics: readonly GeneratedInterfaceDiagnostic[]): string[] =>
  [...new Set(diagnostics.map((item) => item.code))].slice(0, 8)

export const generatedInterfaceOutcomeMessage = (
  reason: GeneratedInterfaceRepairOutcomeReason,
): string => {
  switch (reason) {
    case "budget_exhausted":
      return "No valid generated interface was produced after three submissions."
    case "repeated_content":
      return "The generated interface repeated invalid content, so repair stopped."
    case "model_stopped":
      return "The model stopped before producing a valid generated interface."
  }
}

/** Owns one application-local repair cycle; it grants no runtime authority. */
export class GeneratedInterfaceRepairCycle {
  private submissionCount = 0
  private previousRejection: PreviousRejection | undefined
  private finished = false

  getPreviousRejection(fingerprint: string): PreviousRejection | undefined {
    return this.previousRejection?.fingerprint === fingerprint ? this.previousRejection : undefined
  }

  reject(
    submission: GeneratedInterfaceSubmission,
    diagnostics: readonly GeneratedInterfaceDiagnostic[],
    report: string,
  ): {
    readonly attempt: GeneratedInterfaceAttempt
    readonly outcome: GeneratedInterfaceRepairOutcome | undefined
  } {
    if (this.finished) throw new Error("The generated-interface repair cycle has finished")
    this.submissionCount += 1
    const repeated = this.previousRejection?.fingerprint === submission.fingerprint
    this.previousRejection = { fingerprint: submission.fingerprint, diagnostics, report }

    const attempt: GeneratedInterfaceAttempt = {
      type: "generated_interface_attempt",
      submission: this.submissionCount,
      evidence: submission.evidence,
      diagnostics,
    }
    const reason = repeated
      ? "repeated_content"
      : this.submissionCount >= maxGeneratedInterfaceSubmissions
        ? "budget_exhausted"
        : undefined
    this.finished = reason !== undefined

    return {
      attempt,
      outcome:
        reason === undefined
          ? undefined
          : {
              type: "generated_interface_repair_outcome",
              submissionCount: this.submissionCount,
              reason,
              diagnosticCodes: diagnosticCodes(diagnostics),
            },
    }
  }

  accept(): void {
    this.submissionCount = 0
    this.previousRejection = undefined
    this.finished = false
  }

  modelStopped(): GeneratedInterfaceRepairOutcome | undefined {
    if (this.finished || this.submissionCount === 0 || this.previousRejection === undefined) {
      return undefined
    }
    this.finished = true
    return {
      type: "generated_interface_repair_outcome",
      submissionCount: this.submissionCount,
      reason: "model_stopped",
      diagnosticCodes: diagnosticCodes(this.previousRejection.diagnostics),
    }
  }
}
