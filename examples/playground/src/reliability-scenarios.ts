import type { Page } from "playwright"

interface ExpectedActionCall {
  readonly action: string
  readonly input: unknown
}

export type CheckerExpectation =
  | { readonly ok: true }
  | (CheckerDiagnosticExpectation & {
      readonly ok: false
      readonly reportIncludes: readonly string[]
    })

interface AuthoredProvenance {
  readonly kind: "authored"
  readonly source: string
  readonly sanitized: true
}

interface SanitizedModelProvenance {
  readonly kind: "sanitized_model_output"
  readonly source: string
  readonly sanitized: true
  readonly privacyReview: string
}

interface ReliabilityScenarioBase {
  readonly id: string
  readonly provenance: AuthoredProvenance | SanitizedModelProvenance
  readonly prompt: {
    readonly user: string
    readonly context: string
  }
  readonly generation: {
    readonly profile: "playground"
    readonly environment: "code/0"
  }
  readonly fragment: URL
  readonly checker: CheckerExpectation
}

interface BrowserReliabilityScenario extends ReliabilityScenarioBase {
  readonly kind: "browser"
  readonly ready: (page: Page) => Promise<void>
  readonly interact: (page: Page) => Promise<void>
  readonly expected: {
    readonly ui: {
      readonly selector: string
      readonly text: string
    }
    readonly beforeInteractionActionCalls: readonly ExpectedActionCall[]
    readonly actionCalls: readonly ExpectedActionCall[]
    readonly resultCodes: readonly ("ok" | "unknown_surface")[]
    readonly auditOutcomes: readonly ("ok" | "unknown_surface")[]
    readonly guestErrors: number
    readonly violations: readonly string[]
  }
}

interface AuthorityReliabilityScenario extends Omit<BrowserReliabilityScenario, "kind"> {
  readonly kind: "authority"
  readonly authorityChange: "revoke_after_mount"
}

interface CheckerReliabilityScenario extends ReliabilityScenarioBase {
  readonly kind: "checker"
}

type CheckerDiagnosticExpectation =
  | {
      readonly diagnosticCount: number
      readonly diagnosticPrefix: string
      readonly diagnosticCodes?: never
    }
  | {
      readonly diagnosticCount: number
      readonly diagnosticCodes: readonly string[]
      readonly diagnosticPrefix?: never
    }

interface OperationalReliabilityScenario extends ReliabilityScenarioBase {
  readonly kind: "operational"
  readonly expected: {
    readonly incompatibleGenerationCode: "incompatible_generation"
    readonly cancellationReason: string
  }
}

interface BoundsReliabilityScenario extends ReliabilityScenarioBase {
  readonly kind: "bounds"
  readonly expected: {
    readonly maxSurfaceContentBytes: 102_400
    readonly maxInlineModules: 16
    readonly oversizedCode: "GENUI004"
    readonly excessModuleCode: "GENUI005"
  }
}

interface SanitizedModelOutputCase {
  readonly id: string
  readonly provenance: SanitizedModelProvenance
  readonly prompt: {
    readonly user: string
    readonly context: string
  }
  readonly generation: {
    readonly profile: "playground"
    readonly environment: "code/0"
  }
  readonly model: {
    readonly provider: "openai-codex"
    readonly id: "gpt-5.6-terra"
    readonly capturedOn: "2026-07-14"
    readonly run: string
  }
  readonly fragment: URL
  readonly checker: CheckerExpectation
  readonly browser: {
    readonly baseline: {
      readonly mounted: true
      readonly interaction: "controls_unavailable"
      readonly ui: "module startup failed before controls were wired"
      readonly actionCalls: readonly []
      readonly events: readonly ["guest_error"]
    }
    readonly current: {
      readonly mounted: false
      readonly reason: "checker_rejected"
    }
  }
}

interface RealOutputReliabilityScenario extends Omit<BrowserReliabilityScenario, "id" | "kind"> {
  readonly id: "PREFLIGHT-REAL-009"
  readonly kind: "real_outputs"
  readonly model: {
    readonly provider: "not_recorded"
    readonly id: "not_recorded"
    readonly capturedOn: "2026-07-10"
    readonly run: "incoming fixture commit 640f8be6d"
  }
  readonly retainedFailures: readonly SanitizedModelOutputCase[]
}

export type ReliabilityScenario =
  | BrowserReliabilityScenario
  | AuthorityReliabilityScenario
  | CheckerReliabilityScenario
  | BoundsReliabilityScenario
  | OperationalReliabilityScenario
  | RealOutputReliabilityScenario

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
    checker: { ok: true },
    ready: async (page) => {
      await page.frameLocator("#surface iframe").locator('[data-ready="true"]').waitFor()
    },
    interact: async (page) => {
      await page.frameLocator("#surface iframe").locator("#search-orders").click()
    },
    expected: {
      ui: {
        selector: "#orders-search-result",
        text: "ord-1001 — Aster Labs — processing",
      },
      beforeInteractionActionCalls: [],
      actionCalls: [{ action: "orders.search", input: { query: "Aster" } }],
      resultCodes: ["ok"],
      auditOutcomes: ["ok"],
      guestErrors: 0,
      violations: [],
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
    checker: { ok: true },
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
    checker: {
      ok: false,
      diagnosticCount: 3,
      diagnosticPrefix: "TS",
      reportIncludes: ["capabilities", "orders.missing", "number"],
    },
  },
  {
    id: "PREFLIGHT-NULL-004",
    kind: "checker",
    provenance: {
      kind: "authored",
      source: "GenUI portable preflight Feature Contract",
      sanitized: true,
    },
    prompt: {
      user: "Build an order search and live-update panel.",
      context: "The submitted fragment passes nullish values to object input contracts.",
    },
    generation: {
      profile: "playground",
      environment: "code/0",
    },
    fragment: new URL("../fixtures/reliability/preflight-null-004.html", import.meta.url),
    checker: {
      ok: false,
      diagnosticCount: 2,
      diagnosticCodes: ["GENUI006", "GENUI006"],
      reportIncludes: ["action input excludes null", "subscription input excludes undefined"],
    },
  },
  {
    id: "PREFLIGHT-ENVIRONMENT-005",
    kind: "checker",
    provenance: {
      kind: "authored",
      source: "GenUI portable preflight Feature Contract",
      sanitized: true,
    },
    prompt: {
      user: "Build an order panel using browser facilities that code/0 cannot support.",
      context: "One authored fixture exercises every stable environment diagnostic family.",
    },
    generation: {
      profile: "playground",
      environment: "code/0",
    },
    fragment: new URL("../fixtures/reliability/preflight-environment-005.html", import.meta.url),
    checker: {
      ok: false,
      diagnosticCount: 8,
      diagnosticCodes: [
        "GENUI014",
        "GENUI008",
        "GENUI009",
        "GENUI010",
        "GENUI011",
        "GENUI012",
        "GENUI013",
        "GENUI007",
      ],
      reportIncludes: [
        "external stylesheets",
        "network or worker-loading",
        "persistent browser storage",
        "access a parent page",
        "navigate directly",
        "evaluate code at runtime",
        "currentScript is always null",
        "load or re-export modules",
      ],
    },
  },
  {
    id: "PREFLIGHT-BOUNDS-006",
    kind: "bounds",
    provenance: {
      kind: "authored",
      source: "GenUI portable preflight Feature Contract",
      sanitized: true,
    },
    prompt: {
      user: "Build an interface from a bounded HTML fragment with inline module scripts.",
      context: "The scenario crosses every GenUI-owned Surface content ingress.",
    },
    generation: {
      profile: "playground",
      environment: "code/0",
    },
    fragment: new URL("../fixtures/reliability/preflight-bounds-006.html", import.meta.url),
    checker: { ok: true },
    expected: {
      maxSurfaceContentBytes: 102_400,
      maxInlineModules: 16,
      oversizedCode: "GENUI004",
      excessModuleCode: "GENUI005",
    },
  },
  {
    id: "PREFLIGHT-AUTHORITY-007",
    kind: "authority",
    provenance: {
      kind: "authored",
      source: "GenUI portable preflight Feature Contract",
      sanitized: true,
    },
    prompt: {
      user: "Build a button that searches orders only when the user presses it.",
      context: "The selected action is visible while checking and Surface creation succeeds.",
    },
    generation: {
      profile: "playground",
      environment: "code/0",
    },
    fragment: new URL("../fixtures/reliability/preflight-authority-007.html", import.meta.url),
    checker: { ok: true },
    authorityChange: "revoke_after_mount",
    ready: async (page) => {
      await page.frameLocator("#surface iframe").locator('[data-ready="true"]').waitFor()
    },
    interact: async (page) => {
      await page.frameLocator("#surface iframe").locator("#check-authority").click()
    },
    expected: {
      ui: {
        selector: "#authority-result",
        text: "Surface is not available.",
      },
      beforeInteractionActionCalls: [],
      actionCalls: [{ action: "orders.search", input: { query: "Aster" } }],
      resultCodes: ["unknown_surface"],
      auditOutcomes: ["unknown_surface"],
      guestErrors: 0,
      violations: [],
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
    checker: { ok: true },
    expected: {
      incompatibleGenerationCode: "incompatible_generation",
      cancellationReason: "reliability_request_cancelled",
    },
  },
  {
    id: "PREFLIGHT-REAL-009",
    kind: "real_outputs",
    provenance: {
      kind: "sanitized_model_output",
      source: "Raw Playground model-output fixture introduced in commit 640f8be6d",
      sanitized: true,
      privacyReview:
        "Reviewed the retained fragment; it contains only public demo order data and no user data or credentials.",
    },
    prompt: {
      user: "Build an order lookup interface.",
      context:
        "The original prompt and model identity were not retained with this raw model output.",
    },
    generation: {
      profile: "playground",
      environment: "code/0",
    },
    model: {
      provider: "not_recorded",
      id: "not_recorded",
      capturedOn: "2026-07-10",
      run: "incoming fixture commit 640f8be6d",
    },
    fragment: new URL("../fixtures/reliability/preflight-real-009-valid.html", import.meta.url),
    checker: { ok: true },
    ready: async (page) => {
      await page
        .frameLocator("#surface iframe")
        .locator("#orders-search-result")
        .filter({ hasText: "ord-1001" })
        .waitFor()
    },
    interact: () => Promise.resolve(),
    expected: {
      ui: {
        selector: "#orders-search-result",
        text: "ord-1001",
      },
      beforeInteractionActionCalls: [{ action: "orders.search", input: { query: "Aster" } }],
      actionCalls: [{ action: "orders.search", input: { query: "Aster" } }],
      resultCodes: ["ok"],
      auditOutcomes: ["ok"],
      guestErrors: 0,
      violations: [],
    },
    retainedFailures: [
      {
        id: "search-current-script-startup",
        provenance: {
          kind: "sanitized_model_output",
          source: "Measured checker-to-runtime baseline in Kaam-dō #29",
          sanitized: true,
          privacyReview:
            "Removed user data, mapped the capability to the Playground profile, and retained the currentScript.closest startup failure.",
        },
        prompt: {
          user: "Build an interactive search panel that waits for submit.",
          context:
            "Sanitized from the measured web-search-shaped output and adapted to the Playground Generation.",
        },
        generation: {
          profile: "playground",
          environment: "code/0",
        },
        model: {
          provider: "openai-codex",
          id: "gpt-5.6-terra",
          capturedOn: "2026-07-14",
          run: "baseline currentScript startup failure 1 of 2",
        },
        fragment: new URL(
          "../fixtures/reliability/preflight-real-009-search.html",
          import.meta.url,
        ),
        checker: {
          ok: false,
          diagnosticCount: 1,
          diagnosticCodes: ["GENUI013"],
          reportIncludes: ["currentScript is always null"],
        },
        browser: {
          baseline: {
            mounted: true,
            interaction: "controls_unavailable",
            ui: "module startup failed before controls were wired",
            actionCalls: [],
            events: ["guest_error"],
          },
          current: { mounted: false, reason: "checker_rejected" },
        },
      },
      {
        id: "preference-current-script-startup",
        provenance: {
          kind: "sanitized_model_output",
          source: "Measured checker-to-runtime baseline in Kaam-dō #29",
          sanitized: true,
          privacyReview:
            "Removed user and preference data, mapped the fixture to the Playground profile, and retained the currentScript.closest startup failure.",
        },
        prompt: {
          user: "Build an interactive preference panel that waits for submit.",
          context:
            "Sanitized from the measured preference-shaped output and adapted to the Playground Generation.",
        },
        generation: {
          profile: "playground",
          environment: "code/0",
        },
        model: {
          provider: "openai-codex",
          id: "gpt-5.6-terra",
          capturedOn: "2026-07-14",
          run: "baseline currentScript startup failure 2 of 2",
        },
        fragment: new URL(
          "../fixtures/reliability/preflight-real-009-preference.html",
          import.meta.url,
        ),
        checker: {
          ok: false,
          diagnosticCount: 1,
          diagnosticCodes: ["GENUI013"],
          reportIncludes: ["currentScript is always null"],
        },
        browser: {
          baseline: {
            mounted: true,
            interaction: "controls_unavailable",
            ui: "module startup failed before controls were wired",
            actionCalls: [],
            events: ["guest_error"],
          },
          current: { mounted: false, reason: "checker_rejected" },
        },
      },
    ],
  },
] as const satisfies readonly ReliabilityScenario[]
