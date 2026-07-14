import type { Page } from "playwright"

interface ExpectedActionCall {
  readonly action: string
  readonly input: unknown
}

interface ReliabilityScenarioBase {
  readonly id: string
  readonly provenance: {
    readonly kind: "authored"
    readonly source: string
    readonly sanitized: true
  }
  readonly prompt: {
    readonly user: string
    readonly context: string
  }
  readonly generation: {
    readonly profile: "playground"
    readonly environment: "code/0"
  }
  readonly fragment: URL
}

interface BrowserReliabilityScenario extends ReliabilityScenarioBase {
  readonly kind: "browser"
  readonly interact: (page: Page) => Promise<void>
  readonly expected: {
    readonly ui: {
      readonly selector: string
      readonly text: string
    }
    readonly actionCalls: readonly ExpectedActionCall[]
  }
}

interface CheckerReliabilityScenario extends ReliabilityScenarioBase {
  readonly kind: "checker"
  readonly expected:
    | { readonly ok: true }
    | {
        readonly ok: false
        readonly diagnosticCount: number
        readonly diagnosticPrefix: string
        readonly reportIncludes: readonly string[]
      }
}

interface OperationalReliabilityScenario extends ReliabilityScenarioBase {
  readonly kind: "operational"
  readonly expected: {
    readonly incompatibleGenerationCode: "incompatible_generation"
    readonly cancellationReason: string
  }
}

export type ReliabilityScenario =
  | BrowserReliabilityScenario
  | CheckerReliabilityScenario
  | OperationalReliabilityScenario

export const reliabilityScenarios = [
  {
    id: "PREFLIGHT-VALID-001",
    kind: "browser",
    provenance: {
      kind: "authored",
      source: "GenUI portable preflight Feature Contract",
      sanitized: true,
    },
    prompt: {
      user: "Build an order-search panel that waits for the user to press Search.",
      context: "The Playground Generation selects the orders.search action.",
    },
    generation: {
      profile: "playground",
      environment: "code/0",
    },
    fragment: new URL("../fixtures/reliability/preflight-valid-001.html", import.meta.url),
    interact: async (page) => {
      await page.frameLocator("#surface iframe").locator("#search-orders").click()
    },
    expected: {
      ui: {
        selector: "#orders-search-result",
        text: "ord-1001 — Aster Labs — processing",
      },
      actionCalls: [{ action: "orders.search", input: { query: "Aster" } }],
    },
  },
  {
    id: "PREFLIGHT-PERMISSIVE-002",
    kind: "checker",
    provenance: {
      kind: "authored",
      source: "GenUI portable preflight Feature Contract",
      sanitized: true,
    },
    prompt: {
      user: "Build a start-and-stop order updates panel.",
      context: "The Playground Generation selects the orders.changes subscription.",
    },
    generation: {
      profile: "playground",
      environment: "code/0",
    },
    fragment: new URL("../fixtures/reliability/preflight-permissive-002.html", import.meta.url),
    expected: { ok: true },
  },
  {
    id: "PREFLIGHT-CAPABILITY-003",
    kind: "checker",
    provenance: {
      kind: "authored",
      source: "GenUI portable preflight Feature Contract",
      sanitized: true,
    },
    prompt: {
      user: "Build an order search panel.",
      context: "The submitted fragment contains three selected-contract mistakes.",
    },
    generation: {
      profile: "playground",
      environment: "code/0",
    },
    fragment: new URL("../fixtures/reliability/preflight-capability-003.html", import.meta.url),
    expected: {
      ok: false,
      diagnosticCount: 3,
      diagnosticPrefix: "TS",
      reportIncludes: ["capabilities", "orders.missing", "number"],
    },
  },
  {
    id: "PREFLIGHT-OPERATIONAL-008",
    kind: "operational",
    provenance: {
      kind: "authored",
      source: "GenUI portable preflight Feature Contract",
      sanitized: true,
    },
    prompt: {
      user: "Build a static order summary.",
      context: "The scenario exercises public cancellation and Generation compatibility failures.",
    },
    generation: {
      profile: "playground",
      environment: "code/0",
    },
    fragment: new URL("../fixtures/reliability/preflight-operational-008.html", import.meta.url),
    expected: {
      incompatibleGenerationCode: "incompatible_generation",
      cancellationReason: "reliability_request_cancelled",
    },
  },
] as const satisfies readonly ReliabilityScenario[]
