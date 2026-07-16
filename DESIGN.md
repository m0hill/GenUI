# DESIGN.md — The Constitution

> **What this document is.** The founding design document for the rebuild of this
> project. It records the bet, the strategy, the architecture, the settled
> decisions, and the lessons that make them non-negotiable. It exists so that
> any future session — human or agent — starts aimed instead of drifting.
> Read it fully before writing code. When a proposed feature conflicts with
> this document, the feature is wrong or this document gets amended
> deliberately — never silently.

---

## 1. The bet

Chat is nice. Predefined components are capable. But the real opportunity is
**generative UI**: a future where interfaces stop being artifacts developers
ship and become *responses* — made per person, per task, per moment. You open
your screen and it has already adjusted to your day.

The product vision is a **Jarvis-style super app**: everything you use is
connected (MCP makes this easy), and you don't just get text answers — you get
**living interfaces**. Not JSON filled into predefined component slots, but
actual components the model authors on the spot. They breathe. They understand
you because they have your context. They transform into whatever you need at
that moment.

Requirements, in priority order: **very safe → genuinely capable → flexible →
lovely to use.**

If interfaces become responses, the scarce and durable thing is no longer
components — anyone can get a model to emit HTML. The scarce thing is
**trust**: letting model-authored code touch real capabilities — your
calendar, your email, your money — without fear. That is the asset this
project builds.

---

## 2. Product, not framework (and why)

This was the hardest decision, so the reasoning is preserved in full.

**The pull toward framework:** building for many developers feels more
helpful, and framework-building forces careful design.

**Why product wins:**

- **The goal is financial independence.** Frameworks monetize three ways:
  hosted cloud on top (Vercel/Next), enterprise support at massive scale, or
  acqui-hire. All three require winning enormous adoption *first* — and
  adoption for dev tools is a distribution contest, not a quality contest.
  How many open-source maintainers are rich?
- **We already ran this experiment.** datastar-kit was good, real effort went
  in, and it didn't gain traction — same as Datastar itself. Quality ≠
  traction for frameworks. Traction goes to whoever has the loudest ecosystem
  and biggest sponsor.
- **In this space the sponsor competition is fatal.** A generative-UI
  *standard* would compete with MCP Apps — backed by Anthropic and OpenAI. An
  independent developer does not win a standards war against the model
  vendors.
- **Products birth frameworks all the time; frameworks almost never birth
  products.** Rails came from Basecamp. React came from Facebook's ads
  dashboard. Build the product; if the kernel proves out, extraction later is
  a few weeks of work *from a position of strength* — open-sourcing "the
  engine behind the thing people have seen work." Nobody adopts a
  security-critical framework from an unknown author on the strength of a
  README. They adopt it after watching a product do it safely for a year.
  **The product is the framework's proof, marketing, and test suite.**
- **Product-first also solves the complexity problem.** V1's worst complexity
  came from serving imaginary consumers (store conformance suites,
  transport-agnostic everything). A product answers every "but what if a host
  needs…" with *"it doesn't."*
- **A product helps people more directly.** A framework helps developers
  maybe help users eventually. A product puts generative UI in front of
  actual people. If the bet is right, the strongest thing to do for that
  future is to be the first thing people point at and say "like that."

**What this costs: almost nothing.** The trust kernel is still built — as an
internal package with a clean boundary, kept clean because *we* need it
manageable, not because strangers import it. The framework door stays open.

---

## 3. What the product is

**An MCP-client super app where the differentiator is model-authored living
UI.** Users connect their tools (via MCP or directly); conversations produce
not just text but interactive surfaces bound to those tools, gated by consent.

### Positioning — the three seats in the stack

| Seat | Who sits there | What they own |
|---|---|---|
| **Servers** | MCP servers, APIs | Capabilities |
| **Middle layer** | Executor and similar | Catalog, auth, governance |
| **Client** | **Us** | **Rendering, consent UX, the model loop, personal context** |

**Generative UI's quality is determined entirely at the client seat.** That is
the seat we take, and the one seat nobody else in the stack can reach into.

- **MCP Apps** (`repos/ext-apps`) is the *app-store model*: developers author
  UI bundles ahead of time; the model picks which to show. Safe, polished,
  permanently capped — the UI can only be what someone pre-built. We are the
  *JIT model*: the model authors the interface itself, per task, disposable.
- **Executor** (Reese Sullivan, MIT, `UsefulSoftwareCo/executor`) is a serious
  integration layer — one tool catalog across sources (MCP/OpenAPI/GraphQL),
  secrets that never reach the agent, allow/approve/block policies, sandboxed
  execution, all Effect-native. Its vision doc includes generative UI — but as
  a middle layer it **doesn't own the screen**: its plan is to piggyback on
  MCP Apps for capable clients or deep-link out to its own web app. A middle
  layer's generative UI is capped by whatever host clients permit. Ours isn't,
  because we own the client. Executor solved the N-agents × M-integrations
  problem; we have exactly one client (our own), so that problem evaporates.
- **Executor is complementary, not a dependency.** MCP is the interop
  boundary: a power user connects Executor as one MCP server and we inherit
  its whole governed catalog through the front door. Do not embed it; do
  borrow from it (see §10).

### The daily-driver debate (the Rhys thread)

Rhys Sullivan's widely-discussed thread frames the industry split: every
company ships its own agent (Linear agent, Cloudflare agent — "each week a
homepage falls to a chat interface"), but power users don't want fifty
company agents. They want **their own daily-driver agent** to ingest every
company's skills, knowledge, and APIs. dax's framing: everyone is confused
between (1) every product needs an agent and (2) every product plugs into
the agent you already use — and everyone is betting infra on one side.

**We are the daily driver** — the thing companies plug into, not another
company agent on the pile. Three consequences:

- **Beka's objection is our thesis.** The strongest argument for per-company
  agents (from the thread): "I wouldn't want Claude Code as a shopping agent —
  I want a custom UI designed around how a shopping agent should work."
  Every text-only general agent loses to that argument. **Generative UI is
  the only answer that doesn't require fifty apps**: one agent that grows the
  shopping UI when you shop and the planner when you plan. The pitch in its
  final form: *your agent, with every product's custom experience generated
  inside it.* (Nan Yu's "app-specific agents ARE the app" cuts the same way —
  the experience is the product, and we generate the experience.)
- **Bring your own model — a principle, not a detail.** Power users pay for
  the best models and resent the quantized-cheap-model-in-a-widget economics
  of company agents ("it's not your agent"). Users connect their own
  keys/subscriptions: they always get their best model, and our costs don't
  scale with their usage. Company agents structurally cannot offer this;
  as an indie product we structurally must. Alignment, not compromise.
- **Ingest skills, not just tools** (see §8) — the expertise companies
  publish for daily-driver agents is a supply line that exists precisely
  because of this debate.

### The honest risks

1. **Incumbents.** Anthropic/OpenAI adding generated UI to their own clients
   is the real competitive threat. Our edges: they move slowly on exactly
   this (model-authored code touching user tools is a safety/brand minefield
   for them — our kernel is the answer to why we can move faster safely);
   they build for the median user, we can serve power users deeply; we can go
   further on personal context.
2. **The window is real but closing.** Generative UI appears in both MCP
   Apps' trajectory and Executor's vision. This argues for the small version
   of everything, shipped soon, over the careful version in six months.
3. **Supply-side lockdown (dax's warning).** The wrestling match is coming:
   companies locking down APIs, expensive API access, restricting which
   clients may connect. As a challenger client we can be frontrun or fenced
   out, and "the best outcome for the user wins" is not guaranteed. Partial
   mitigations: MCP's momentum makes per-client discrimination harder; users
   authenticate as themselves with their own credentials; and our
   irrevocable value-add (the UI layer, the consent kernel, personal
   context) is not the part a vendor can revoke. Recorded honestly: this
   risk compounds the incumbent risk and cannot be fully engineered away.

---

## 4. Lessons from v1 (why we restarted)

The previous codebase reached **~32,000 lines** for what is essentially a
2,500-line problem. The history: product first → extracted into a framework →
**the product was deleted** → rebuilt on the framework → complexity spiral.
The moment the app was gone, the framework lost its reality check and grew
toward imagined requirements. Specific failure modes, so they are never
repeated:

1. **Platform before product.** Confidentiality tiers, audit taxonomies,
   idempotency fingerprint joins, store conformance suites, Postgres/Redis
   coordination docs, subscription reauthorization — the feature set of a
   mature multi-tenant platform with zero users. Agent-built codebases are
   especially prone: writing code is free for the agent; *carrying* it is not.
2. **Defense-in-depth became responsibility smearing.** The content byte
   limit was enforced in **six places**. Validation happened in the browser
   broker *and* the kernel. When every layer does every job, no layer owns
   anything, and every change touches everything.
3. **Subscriptions doubled the system.** Event streams brought a second
   runtime, brokers, per-event validation, backpressure, heartbeats — ~1,600
   lines plus tests, for live data most surfaces don't need. (Fix: §7 "See".)
4. **Structurally redundant components.** The checker package (~1,300 lines
   of lint rules) was advisory by its own admission — runtime enforced
   everything anyway. The `SurfaceStore` abstraction was a distributed-systems
   contract for a project running `memoryStore()` in a playground.
5. **Tests ossified the architecture.** Over 60% of the lines were tests,
   mostly of internal seams — concrete poured around the current shape.

**Standing rules derived from these lessons:**

- **One enforcement point per invariant.** If a check exists twice, one copy
  is dead weight that will drift.
- **A feature enters only when the product concretely pulls it.** Never
  pushed by imagined composition. (Executor's vision doc states the test
  perfectly: *the tell that you've slipped into vision mode is that the next
  step needs two other things built first.*)
- **Complexity budget:** the kernel stays around **2,500 lines**. Exceeding
  it is a design failure, not a reason to raise the budget.
- **The product never gets deleted.** It is the forcing function.
- **Test at trust boundaries, not internal seams.** One Playwright suite
  driving a real iframe through the real pipeline (mount, call, denied call,
  oversized content) beats 20k lines of unit tests on message schemas.
- **Keep a taste-check eval loop.** Product quality ≈ generation quality,
  and it varies wildly by model and prompt. V1's real-sandbox eval (`nub run
  eval`) was one of its good ideas: a folder of real prompts run through the
  real stack and eyeballed whenever guidance, models, or the design system
  change. A taste-check, not a benchmark suite.

---

## 5. The core problem and identity

One sentence: **let a model render live, interactive UI that can safely invoke
real capabilities.** Internal identity: **a trust kernel for model-authored
interfaces.** Not a UI framework, not a component library, not a renderer.

Two irreducible parts:

1. **Isolation** — generated code runs where it can't do anything:
   opaque-origin iframe, network-denying CSP, no storage, no parent DOM. The
   browser gives this almost free; the real engineering is the bootstrap and
   bridge.
2. **A narrow, typed door** — `genui.call(name, input)`, where the grant
   lives on the trusted side and is checked at call time. Generated code
   holds no authority; it holds a *reference* to authority.

Everything else — approvals, live data, persistence, checkers, audit — is a
layer on that kernel, added only when pulled.

The sandbox decision was examined once, deliberately: constrained DSLs cap
expressiveness (that's the thing we're betting against); server-side rendering
loops put a network round-trip inside every interaction; SES/ShadowRealms/WASM
aren't ready for DOM UI. **The opaque-origin iframe wins** — it is the one
isolation boundary hardened by two decades of adversarial pressure, at zero
cost to us. Adopt the architectural consequence of the alternatives anyway:
**the browser host is dumb**; all real enforcement is server-side.

---

## 6. The trust model

### The surface is a second caller, not a second system

A chat app that connects MCP servers has *already* decided the model may act
on the user's behalf, gated per-call by policy. A generated surface creates no
new kind of authority — it is just **another caller** into the same pipeline.
The model calls tools from a turn; the surface calls tools from a user
gesture; (later) a server script calls tools from a schedule. Same catalog,
same policy, same approval UI, same audit trail. **One gate, N callers.**

V1's entire surface-side trust apparatus (its own store, policy, approval
expiry/replay machinery, audit) was a duplicate of what the tool layer should
own once. Never rebuild it.

The surface-specific rules that remain:

- **Grants only narrow.** A surface's grant is a subset of the tools the
  generating context had. Nothing can widen at runtime.
- **No drift.** The capability contract shown to the model and the grant
  enforced at runtime come from the same selection.
- **Per-call checking, forever.** A surface is persistent code that can act
  tomorrow without fresh conversational context; the per-call gate (plus
  approval memory, §9) is what makes that safe.

### Trust is two-sided

Both ends are untrusted: the generated surface **and** the MCP servers. Tool
annotations (`readOnlyHint`, `destructiveHint`) are unverified claims —
default conservative (unknown tool ⇒ ask). Tool outputs are
attacker-influenced data (prompt injection through tool results is a live,
documented problem): validate and bound them before they reach surfaces or
model context. The user sits in the middle; **the kernel is the user's agent,
loyal to nobody else.** This is a stronger, clearer security story than v1
had — and it is marketable.

### Where intelligence lives (three roles, never conflated)

| Role | When | What it looks like |
|---|---|---|
| **LLM as author** | Once, at generation | Writes the surface's HTML/JS; its intelligence is *baked into ordinary code* (e.g. a `findFreeSlots(events)` function) |
| **Baked logic** | Every interaction (default) | Plain deterministic JS running in the iframe. Instant, free, no tokens. The chef wrote the recipe and went home; clicking a button is cooking from it |
| **LLM at runtime** | Only when granted & invoked | Either (a) the model exposed as a tool (`ai.summarize`) behind the same gate, or (b) the **report channel** starts a new chat turn, where the model can respond, call tools, or regenerate the surface |

The iframe never talks to the internet — it physically can't. Even LLM access
is just another gated tool.

---

## 7. The capability model — the four guest powers

A generated surface has exactly four powers. Nothing else enters the guest
contract without amending this document.

1. **Act** — `call(name, input)`. One-shot, typed, validated, policy-checked,
   human-approvable, executed on the trusted side. The irreducible core.
2. **See** — live data as **snapshots, not streams**. The surface declares
   data dependencies; the host pushes whole validated values when they
   change; the guest re-renders from the latest value. *Props, not sockets.*
   This deletes backpressure (new snapshot replaces old), event ordering, and
   guest-side state accumulation — the complexity bomb that doubled v1. True
   event streams are added only if a concrete case (ticking prices,
   collaborative cursors) ever demands them.
3. **Report** — one structured channel back to the conversation: "here's my
   state / here's what the user did," feeding future model turns. Quietly the
   most important power for the bet — it closes the loop that makes a surface
   part of an agentic conversation instead of a dead-end widget, and it's
   what "the surface is still there, updated, tomorrow" is built from.
4. **Look native** — host-provided theme tokens (CSS variables), fonts, dark
   mode. Not a security feature, but "lovely to use" dies without it.

### The surface language: code as substrate, design system as vocabulary

The "freeform code vs. predefined components" question was examined once,
deliberately. Predefined components promise two things: **visual
consistency** and **structural safety**. Take the first without paying for
the second — consistency is a styling problem and we own the styling seat;
structural safety is the expressiveness ceiling we're betting against
(components cap *behavior*, not just looks — no catalog contains the week
planner's drag interaction, and a catalog-only agent is just another
JSON-cards app with Beka's objection unanswered).

The synthesis, three optional layers: **tokens → primitives → freeform
code.**

- The host injects a small, static, presentational bundle into every iframe:
  theme tokens plus styled primitives for the boring 80% (buttons, inputs,
  cards, lists, tables). Plain CSS classes / dependency-free web components —
  stylesheet-weight, **no React, no runtime**.
- Model guidance: *use the primitives for standard elements; write anything
  for the rest.* The vocabulary lives in the stable, cacheable prompt
  section.
- Primitives are purely presentational — **zero capability implications**.
  Authority still flows only through `genui.call`; the kernel doesn't know
  the design system exists.

Payoff: native-looking surfaces from day one, cheaper and more reliable
generation (known vocabulary, fewer tokens than hand-rolled CSS), baked-in
accessibility, and the model's effort spent on the novel interaction — while
the ceiling stays infinite. A component catalog is just the degenerate case
where the freeform layer is banned; we keep all three layers.

Related routing note (product, not kernel): not every response deserves a
surface — plain answers stay text, simple results can be standard chat
cards, *tasks* get surfaces. The model routes per response, so generation is
spent where interactivity earns it.

---

## 8. Tools — the primitive

**Tool is the unit of capability**, not MCP. A Tool = stable id, description,
input/output schema, execute, policy. MCP is one *source* of tools among
several:

| Source | What it is | Phase |
|---|---|---|
| **Built-ins** | Tools we ship (calendar glue, `ai.summarize`, host actions) | v1 |
| **MCP servers** | Connected via the official MCP SDK; users attach freely | v1 |
| **Derived tools** | Model-authored server scripts attached to a surface (§11) | v2 |
| **User-authored** | Custom code tools the user writes | v2+ |

Policy vocabulary (borrowed from Executor, validated independently):
`allow / ask / block`, attached at source and tool level,
**most-restrictive-wins**; effect classes (`local/read/write/dangerous`)
supply conservative defaults; **visibility is separate from permission**;
**authority only narrows**.

The tool layer stays thin — a few hundred lines over the MCP SDK. The heavy
machinery Executor built (secret proxies, org scopes, OpenAPI importers)
belongs to the middle-layer seat; users who want it connect Executor over MCP.

### Skills — the knowledge primitive (v2)

Tools are hands; **skills are knowledge**: markdown expertise packages
(the emerging Agent Skills format — MCP Apps already ships them, companies
are starting to publish them) that make the agent an *expert* in a product
or domain. The Rhys thread's core ask — "the same expertise you embed in
your UI and docs, accessible to my daily-driver agent" — arrives as skills,
and we should be a first-class consumer: add the Linear skill and Jarvis
breaks down projects the way Linear's own agent would.

Two design notes:

- Skills are prompt-layer, not authority-layer: they inform generation and
  chat turns, they never grant capability. A skill that names tools still
  passes through the same grant/policy gate. Skills are also untrusted
  third-party text — prompt-injection surface; they get provenance and user
  consent like any source.
- **Skills × generative UI is our combination alone**: a company can ship
  not just "how to query PostHog" but *"how a PostHog funnel should look"* —
  surface-generation guidance that makes our generated UI render their data
  the way their own dashboard would. No text-only agent and no per-company
  agent can use that the way we can. Cheap to ingest (markdown), high
  differentiation.

---

## 9. The two settled consent decisions

### 9a. Code enters only through generation, as immutable versions

A surface is a **versioned package**: UI + any server scripts, produced as one
unit by the generation pipeline (model → check → grant projection → store).
Packages are **immutable**; evolution = a **new version** through the same
pipeline. The old version stays in history.

- At any moment, a surface's capabilities are a complete, frozen, inspectable
  set — "what can this thing do right now?" always has an answer.
- Versions give **rollback** ("yesterday's dashboard"), **diffing** ("v3
  added a script that writes to calendar" — a consent-UI moment), and a clean
  story for the model evolving a surface across chat turns.
- **The invariant:** a running surface can never `eval` code that bypassed
  generation. New code → new version → new frozen set. No exceptions.

### 9b. Per-call gate forever, with approval memory

Enforcement is **per-call at the gate, always**. The user experience layers
*remembered approvals* on top:

1. **Supervised first run.** Every consequential call prompts individually:
   "*refresh_week* wants to create 'Standup, Mon 10am' — allow?" The user
   watches it work, step by step.
2. **Graduation prompt.** After a successful run: "Run refresh_week
   automatically every morning, with these permissions?" Yes stores a policy:
   auto-answer for *these tool calls when made by this script version*.
3. **Subsequent runs.** The gate still checks every call — it answers
   silently from stored policy. Still logged, still visible in history,
   revocable with one tap.

Why per-call underneath (not blanket script approval): revocation and audit
stay real ("show me everything refresh_week did last month"); scope stays
honest (a script that unexpectedly tries `gmail.send` gets a prompt, not a
pass); and it composes with 9a: **approvals attach to a script version** — a
new version triggers one re-confirmation ("refresh_week changed — here's
what's different — keep auto-running?"). "You approved it" always refers to
exact code you can point at.

Prompt-fatigue relief is *more policy* ("always allow calendar writes from
this surface"), never blanket script approval. Approval prompts always name
the caller ("refresh_week wants…"), not a context-free request.

---

## 10. Architecture — the placement map

> **The screen in the browser iframe, the brain in a Durable Object, the
> hands behind one tool gate, untrusted server code in Dynamic Workers when
> it earns its way in.**

| Place | What it is | What runs there |
|---|---|---|
| **Iframe** (browser) | The face. Opaque-origin, no-network sandbox in our app's page | The surface: model-authored HTML+JS. Everything visual and interactive |
| **The gate** (Durable Object, one per conversation/surface) | The door. All the rules live here | *Trusted code only.* Grant + policy checks, approval prompts & memory, snapshot pushes over WebSocket, alarms, the audit log |
| **Tool workers** (our server) | Trusted plumbing | Tool implementations: MCP client, built-ins |
| **Dynamic Workers** (v2) | Errand-runners. Disposable isolates spun from a code string | *Untrusted non-UI code*: derived tools, user tools, code-mode scripts |

**Two sandboxes, one membrane.** The iframe and the Dynamic Worker are both
padded rooms with exactly one door — the same door. A Dynamic Worker's *only*
binding is a service binding back to the gate carrying its narrowed grant: no
fetch, no env, no storage. Capabilities are enforced by the platform, not by
our code.

**The browser host is dumb.** It mounts, pipes, and renders consent UI. All
real enforcement happens at the gate. (This single principle is what prevents
v1's responsibility smearing.)

Guest content rules carried over from v1 (they were right): fragments are
ordinary buildless HTML + vanilla JS, stored **verbatim** — never sanitized,
rewritten, or compiled; content is size-bounded in bytes (measured with
`TextEncoder`, never truncated), enforced **once, at creation**.

### Cloudflare mapping

The product is hosted on Cloudflare; the boilerplate (Effect + Alchemy IaC,
with examples of every resource type) already exists and is the starting
point.

- **Durable Objects** are the gate. Single-threaded execution makes the whole
  class of approval replay/race bugs (v1's last four security fixes)
  *structurally impossible*. WebSocket hibernation makes idle pinned
  dashboards nearly free. **Alarms** schedule ambient work. V1's
  `SurfaceStore`+`runIdempotent` conformance contract dissolves into "it's a
  DO."
- **Dynamic Workers / Worker Loaders** run untrusted server code with
  bindings-as-capabilities (v2).
- **Workers + D1/KV/R2** — the app and boring storage. **Cloudflare
  Workflows** — only if scheduled routines outgrow DO alarms.
- The Cloudflare marriage is accepted deliberately: portability is a
  framework virtue; we chose product. If the kernel is ever extracted, the
  Effect core extracts cleanly; only the coordination shell is
  Cloudflare-shaped.

### Generation UX: streaming, repair, reuse

The 15–30 seconds in which a surface comes into existence — and the times it
arrives broken — determine perceived quality more than any architecture
choice. Three rules:

- **Stream the birth.** Progressive preview during generation (v1's
  `SurfaceDraft` revision idea, kept) or at minimum a skeleton that
  resolves. Nobody watches a spinner for a button.
- **Bounded repair.** The iframe captures runtime errors and blank renders
  and reports them to the host; the host feeds the error back to the model
  for a fixed **new version** (§9a handles this for free), with an honest
  terminal state after N attempts. Repair is bounded application policy,
  never a silent infinite loop.
- **Reuse before regenerate.** Same intent → reopen the existing surface
  (with a data refresh); changed needs → the model *evolves* it as a new
  version. Regenerating from scratch is slow, expensive, and — worst —
  unfamiliar. Users build muscle memory; "it understands you" implies your
  planner is *your* planner, recognizable tomorrow. Consequence: the product
  grows a **surface library** — accumulated personalized interfaces. The
  library is the stickiness moat and the stepping stone from "chat with
  widgets" to the adaptive home screen.

### Surface lifecycle (one breath)

User asks → model writes a tiny app (+ scripts) → checked, versioned, grant
projected → iframe mounts it → clicks run baked logic and gated tool calls →
snapshots flow down, reports flow up → the next model turn sees the state and
can evolve the surface (new version).

---

## 11. Server-side execution (v2) — Dynamic Workers in depth

Why the iframe isn't enough, eventually — four triggers, and only these:

1. **No browser open** — scheduled refresh, ambient surfaces. Iframe code
   dies with the tab.
2. **Big intermediate data** — move the code to the data; don't ship 10k rows
   to a browser to compute a summary.
3. **Many sequential calls** — ten hops inside Cloudflare beats ten
   browser→edge round-trips.
4. **Atomicity** — a half-executed plan needs durable, resumable semantics.

But note: **the surface is already client-side code mode.** It's a program;
it can `await call(a); await call(b)` and compose in the iframe, each call
individually gated. That is the default and covers all of v1. Rendering the
UI itself stays in the browser permanently — a server rendering loop puts an
edge round-trip inside every drag and keystroke, and "components that
breathe" is a direct-manipulation vision.

**Derived tools:** at generation time the model may author non-UI scripts
alongside the surface (part of the versioned package). Example:

```js
// "refresh_week" — pure logic, no HTML
const events = await tools.call("calendar.list_events", { week: "next" })
const mails  = await tools.call("gmail.search", { query: "invite" })
return summarize(events, mails)   // baked logic
```

Stored, named, registered in the grant **like any other tool** — the surface
calls `genui.call("refresh_week")`; the gate's alarm calls it at 9am. Inner
calls route back through the gate individually, so approval can freeze a
script mid-run (the gate holds the pending approval; the worker awaits; the
user sees "refresh_week wants to create…").

Three kinds of code share this one mechanism — derived tools, user-authored
tools, and code-mode scripts from chat turns ("archive every newsletter older
than a month" as a ten-line loop instead of forty tool-call round-trips).
Build the mechanism once; all three are just different triggers.

The morning dashboard, infrastructurally: *derived tool runs at 9am in a
worker with nobody watching → gate stores the snapshot → phone opens the
surface and it's already breathing.*

---

## 12. Effect architecture

Build the core entirely in **Effect**, compose dependencies and resources into
one **Layer**, and cross into ordinary TypeScript **exactly once** through an
owned runtime. Expose explicit plain contracts: `Promise<Result>` for
one-shot work, `AsyncIterable` for streams, `AbortSignal` for cancellation,
idempotent `close()`/async disposal for lifetime. Translate `Exit`
deliberately — typed failures to public domain errors, interruption to
abort/closed semantics, defects and compound causes to an internal error
while retaining the full `Cause` in telemetry. Keep root declarations
Effect-free via explicit annotations, restrictive package exports,
generated-declaration checks, and consumer compilation tests. Add a separate
Effect-native entrypoint only when ecosystem composition is a real
requirement.

Where Effect concretely pays here:

- **`effect/Schema` deletes an entire v1 subsystem**: validation, inferred
  types, bidirectional codecs, and JSON Schema generation from one
  declaration (v1 hand-built all four). Note the flow *inverts* for MCP
  tools: their schemas arrive as JSON Schema, so we need JSON Schema →
  validator → compact model-facing contract; expect garbage schemas from real
  servers and degrade gracefully to `unknown` + raw schema.
- **The call pipeline is Effect-shaped**: a typed error union
  (`ValidationError | PolicyDenied | ApprovalRequired | ExecutionFailed`)
  instead of v1's stringly phase taxonomy; `Scope` for surface/mount
  lifetimes; interruption ↔ `AbortSignal`.
- **`Layer`** composes store/policy/telemetry; swapping implementations is a
  Layer substitution, not an abstraction ceremony.

Two hard cautions:

1. **The guest bootstrap is vanilla forever.** The JS injected into the
   iframe is the most security-critical and size-sensitive code in the
   system: tiny, boring, dependency-free, readable in one sitting. No Effect
   there, ever. The browser host package stays plain and thin too — a dumb
   host doesn't have enough logic to need Effect, and shouldn't carry the
   bundle.
2. **Effect is a complexity carrier, not a cure.** Services, layers, and
   combinators make abstraction cheaper to write — which makes v1's disease
   *easier* to catch, not harder. The discipline is §4's rules, not the
   language.

---

## 13. What we keep, what we borrow

**From GenUI v1 (keep the ideas, archive the repo as reference):**

- Verbatim buildless fragments (`code/0` spirit) — the runtime never
  rewrites model output.
- The opaque-origin iframe + network-denying CSP + trusted bridge design, and
  the hard-won bootstrap knowledge.
- Capability contracts rendered as compact TypeScript-like declarations for
  the model, with `unknown` + raw JSON Schema fallback.
- Byte-bounded content, never truncated (enforced once now).
- The red-team mindset: revoked authority must deny mid-flight; checker/mount
  acceptance never preserves revoked authority.

**From Executor (MIT — borrow shamelessly, don't depend):**

1. *Design decisions (highest value):* Tool as primitive fed by sources;
   policy attachment and most-restrictive-wins; visibility ≠ permission;
   authority only narrows; "fuse indirection, keep dimensions"; the
   build-mode YAGNI rule.
2. *Reference implementations:* the MCP source plugin (spec drift — new
   upstream tools appear **ungranted until reviewed**), schema normalization,
   the Cloudflare host and sandbox kernels (directly relevant since we're
   DO/Dynamic-Worker shaped), eventually the OpenAPI→tools importer.
3. *Actual code (lowest priority):* lift only what fits; their server isolate
   kernels solve a neighboring problem, not the UI sandbox.

---

## 14. Non-goals (v1, explicit)

Each of these killed time or clarity in v1, or belongs to a different seat in
the stack. None enters without amending this document:

- No standalone framework release, npm packaging ceremony, or docs-for-adopters.
- No static checker package (runtime enforcement makes it advisory; the
  repair loop is retry-on-failure).
- No store abstraction or conformance suites (the gate is a DO; persistence
  is the app's problem).
- No subscription/event-stream runtime (snapshots only, §7).
- No idempotency machinery (DO single-threading + app-level keys cover it).
- No confidentiality tiers, audit taxonomies, or approval intent-rendering
  machinery.
- No distributed-store coordination (Postgres/Redis algorithms, crash-limit
  docs).
- No multi-agent / N×M catalog sharing (Executor's problem, not ours — we
  have one client).
- No React/RSC in surfaces; no MCP Apps hosting (we may *consume* the pattern
  later; we don't implement the spec now).
- No secret management *platform* (vaults, rotation, org sharing — Executor
  covers power users). But be honest about custody: a hosted MCP client
  **does** hold users' OAuth tokens for connected servers, and user data
  transits the gate. "The kernel is the user's agent" extends to data
  handling: tokens encrypted at rest, per-user isolation, no training on
  user data, deletion that works.

---

## 15. The demo and the build order

### The acceptance test (v1 is exactly the code this needs, nothing else)

> Connect your calendar and email MCP servers. Say **"plan my week."** Watch
> a living planner assemble itself — drag a meeting, it asks "move the 3pm to
> Thursday? ✓" — and it's still there, updated, tomorrow morning.

### Sequencing

**Step zero — the walking skeleton (before any AI).** A *hand-written*
surface fragment, mounted in the real iframe, calling one real MCP tool
through a real DO gate, with one real approval prompt. Every trust decision
gets exercised; no generation, no design system, no chat. Generation is step
two. (V1 failed as code-without-direction; the inverse trap is
direction-without-code. This document is complete enough — the next unit of
progress is code.)

| Phase | Pulls into existence | Explicitly absent |
|---|---|---|
| **v1 — the interactive demo** | Chat app; MCP client + thin tool layer; the gate (one DO class: grant, policy, approvals, WebSocket snapshots, log); iframe host + vanilla bootstrap; generation pipeline with versioned packages; consent UX; report channel; theming tokens | Dynamic Workers, derived tools, alarms, approval memory beyond allow/deny |
| **v2 — the ambient dashboard** | Dynamic Workers + derived tools (one mechanism, three triggers); DO alarms; approval memory + graduation prompts; version diffs in consent UI; skills ingestion (§8) | Workflows, user-authored tools |
| **v3 — Jarvis** | User-authored custom tools; code-mode from chat; long-running routines (Workflows if alarms outgrow); multi-surface composition | Whatever v3 doesn't concretely pull |

### Standing open questions (decide when reached, record here)

- Product name and repo strategy (fresh repo seeded from the Cloudflare
  boilerplate; this repo becomes the reference archive).
- Monetization wedge: consumer super app is the vision; "generated internal
  tools for businesses" was identified as the more sellable day-one wedge —
  revisit after the demo exists.
- Snapshot triggering design (what marks a data dependency dirty in v1).
- Exact theming/token contract, the v1 primitive set (which 10–15 elements
  earn a styled primitive), and the report-channel schema.
- Per-domain memory/workspace separation (Beka's point: a shopping context
  shouldn't share memory with a work context, while still being able to pull
  cross-context data *when the user consents*). Product design, not kernel.
- BYO-model mechanics: API keys vs. provider subscriptions/OAuth; which
  providers at launch; what (if anything) works with no key.
- Mobile packaging (surfaces work in webviews and store rules permit
  sandboxed web content, but push notifications and a decent mobile shell
  are their own project — defer deliberately, don't discover it in v3).
- Surface library UX: naming, pinning, search, when the model reuses vs.
  evolves vs. creates fresh.
- When (if ever) the kernel gets extracted and open-sourced — from strength,
  post-traction, never before.

---

*Everything above was settled in the founding design conversation of
July 2026, after a full post-mortem of GenUI v1, a review of MCP Apps and
Executor, and deliberate decisions on product-vs-framework, the trust model,
consent semantics, and placement. When in doubt, re-read §4.*
