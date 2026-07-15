export const approvalScenarios = [
  {
    id: "CHAT-APR-001",
    description: "Kernel-required approval creates one bound pending record.",
    given: "An authenticated surface call whose validated write action requires approval.",
    when: "The kernel returns approval_required.",
    expect:
      "Chat creates a short-lived pending record bound to the subject, call, action, and canonical input.",
  },
  {
    id: "CHAT-APR-002",
    description: "Forged preapproval and guest-selected tokens create no authority.",
    given: "An authenticated generated-interface request with no server-issued approval authority.",
    when: "The request supplies preapproval fields or a token selected by the guest.",
    expect:
      "Chat rejects the request without creating pending or retry authority or executing an action.",
  },
  {
    id: "CHAT-APR-003",
    description: "Authenticated subject must match the surface subject.",
    given: "A generated surface bound to one authenticated chat subject.",
    when: "Another session, or an unauthenticated caller, executes or subscribes with its surface ID.",
    expect:
      "The request fails before action validation, approval, subscription startup, or execution.",
  },
  {
    id: "CHAT-APR-004",
    description: "Every approval request must match its pending authority.",
    given: "A valid pending or retryable approval bound to one exact request.",
    when: "The subject, surface, call, action, or canonical input differs.",
    expect:
      "Chat rejects without consuming or replacing the valid authority or executing an action.",
  },
  {
    id: "CHAT-APR-005",
    description: "Trusted consent exchanges pending authority for a distinct retry token.",
    given: "A matching authenticated pending approval.",
    when: "Trusted consent submits its pending envelope with valid CSRF material.",
    expect:
      "The pending token is consumed and a distinct one-time retry token is returned only to the trusted parent.",
  },
  {
    id: "CHAT-APR-006",
    description: "Denial does not exchange authority or execute the action.",
    given: "A pending write approval.",
    when: "The trusted user declines consent.",
    expect: "The generated interface receives approval_denied and the write is not executed.",
  },
  {
    id: "CHAT-APR-010",
    description: "Missing authentication or invalid CSRF is rejected.",
    given: "A pending approval envelope.",
    when: "The approval exchange lacks a valid authenticated chat session or CSRF token.",
    expect: "The exchange rejects before issuing retry authority.",
  },
  {
    id: "CHAT-APR-011",
    description: "Malformed approval envelopes fail closed without sensitive diagnostics.",
    given: "An approval request or response crossing a browser or server boundary.",
    when: "A required field is missing, extra, incorrectly typed, empty, invalid, or inconsistent.",
    expect:
      "Chat returns a safe failure without approval material, sensitive diagnostics, or state changes.",
  },
  {
    id: "CHAT-APR-012",
    description: "Complete browser approval succeeds and exposes only ActionResult.",
    given: "A generated chat interface that invokes a write action.",
    when: "The user accepts trusted consent.",
    expect:
      "One identical retry executes the write and the sandbox receives only the nested ActionResult.",
  },
] as const
