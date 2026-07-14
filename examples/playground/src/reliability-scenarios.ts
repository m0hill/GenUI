import type { Page } from "playwright"

interface ExpectedActionCall {
  readonly action: string
  readonly input: unknown
}

export interface ReliabilityScenario {
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
  readonly interact: (page: Page) => Promise<void>
  readonly expected: {
    readonly ui: {
      readonly selector: string
      readonly text: string
    }
    readonly actionCalls: readonly ExpectedActionCall[]
  }
}

export const reliabilityScenarios = [
  {
    id: "PREFLIGHT-VALID-001",
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
] as const satisfies readonly ReliabilityScenario[]
