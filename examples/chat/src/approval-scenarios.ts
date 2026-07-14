export const approvalScenarios = [
  {
    id: "CHAT-APR-003",
    description: "Authenticated subject must match the surface subject.",
    given: "A generated surface bound to one authenticated chat subject.",
    when: "Another session, or an unauthenticated caller, executes or subscribes with its surface ID.",
    expect:
      "The request fails before action validation, approval, subscription startup, or execution.",
  },
] as const
