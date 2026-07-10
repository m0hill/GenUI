# Hosting generated surfaces

A host has two trusted halves:

- The server owns action definitions, surface records, policy, validation,
  approval, and execution.
- The browser owns the sandbox iframe, consent UI, transport, and visible
  surface events.

Generated code runs only inside the iframe. It never receives application
objects, credentials, direct fetch access, or a reference to the parent DOM.

Read [actions.md](actions.md) before defining the authority set. Read
[code0.md](code0.md) for the iframe and guest contract.

## Build the package

The `genui` package is private while its final npm scope and name are
undecided. Build the workspace copy before using it locally:

```sh
nub install
nub run build
```

The build emits ESM JavaScript, declarations, and source maps to
`packages/genui/dist/`. Its export map exposes `.`, `./protocol`, `./dom`, and
`./testing`. The repository's `nub run check` and `nub run test` commands build
it first.

Run the external-consumer smoke test before distributing a local build:

```sh
nub run test:pack
```

It packs the private package, installs the tarball into a temporary project
without registry access, and checks JavaScript and TypeScript imports through
all four public entrypoints. The temporary tarball is deleted after the test.

## Create the server runtime

Create one `Genui` instance from app-owned actions and a store. The in-memory
store is suitable for a single-process example.

```ts
import { Genui } from "genui"

const genui = new Genui({
  actions: [searchOrders, updateOrderStatus],
})
```

Keep the instance alive across surface creation and execution. The surface
record is the server-side source of truth for grants.

A custom `SurfaceStore` implements `get`, `set`, `revoke`, and `runIdempotent`.
`revoke` must delete the surface record and its idempotency entries.
`get` and `set` must preserve an optional `SurfaceRecord.subject` unchanged.
`runIdempotent` must atomically join concurrent calls with the same surface ID,
call ID, and fingerprint, retain the completed result for the requested window,
and report conflicting fingerprints. It must return `approval_required` to
current callers without retaining that provisional result. The bundled
`memoryStore()` implements this contract for one process.

Before using a shared adapter, run the `genui/testing` conformance check against
two connections to the real backend. Follow [stores.md](stores.md) for the
Postgres and Redis coordination algorithms, crash limits, and downstream
idempotency requirements.

## Create code surfaces

Accept generated content as a string. Choose the action names the surface may
request. The runtime projects the actual grant and stores content verbatim.

```ts
import { codeDialect } from "genui/protocol"

const surface = await genui.surface({
  dialect: codeDialect,
  content,
  actions: ["orders.search", "orders.update_status"],
  subject: currentSession.id,
})
```

Return the serializable `Surface` to the browser. Do not let the browser supply
or mutate the authoritative grant.

Set `ttlMs` when authority should expire automatically. The runtime projects
one absolute `grant.expiresAt` value. Call `await genui.reproject(surface.id)`
to apply current policy again without extending that expiry. An expired grant
returns `unknown_surface` before validation, approval, or execution and removes
its stored surface and idempotency state.

```ts
const temporarySurface = await genui.surface({
  content,
  actions: ["orders.search"],
  ttlMs: 15 * 60_000,
})
```

Call `await genui.revoke(surface.id)` to remove authority before its expiry.
Calls that entered `execute()` before expiry or revocation may complete; later
calls return `unknown_surface`.

Use `genui.instructions()` for a copyable model prompt. It includes the code/0
contract and the grantable, non-confidential action schemas.

## Execute through a server endpoint

Parse the browser boundary with the protocol codec. Pass the call to the same
`Genui` instance.

```ts
import { actionError, parseActionCall } from "genui/protocol"

const body: unknown = await request.json()
const call =
  typeof body === "object" && body !== null && "call" in body
    ? parseActionCall(body.call)
    : undefined
const approvalRetryToken =
  typeof body === "object" && body !== null && "approvalRetryToken" in body
    ? body.approvalRetryToken
    : undefined
if (
  call === undefined ||
  (approvalRetryToken !== undefined && typeof approvalRetryToken !== "string")
) {
  return Response.json(actionError("invalid_input", "Malformed action call."), {
    status: 400,
  })
}

const result = await genui.execute(call, appContext, {
  subject: currentSession.id,
  approve: (action, canonicalInput) =>
    pendingApprovals.check({
      surfaceId: call.surfaceId,
      callId: call.callId,
      subject: currentSession.id,
      action: action.name,
      input: canonicalInput,
      retryToken: approvalRetryToken,
    }),
})
const responseApprovalToken =
  !result.ok && result.error.code === "approval_required"
    ? pendingApprovals.token({
        surfaceId: call.surfaceId,
        callId: call.callId,
        subject: currentSession.id,
      })
    : undefined
return Response.json({
  result,
  ...(responseApprovalToken === undefined
    ? {}
    : { approvalToken: responseApprovalToken }),
})
```

Treat the kernel `approve` hook as authoritative. It runs after schema
validation and receives canonical input. Return `undefined` while consent is
pending, `false` for an explicit denial, and `true` only after trusted consent.
Never approve from guest-rendered UI.

## Implement the approval retry protocol

Treat a repeated action call as unapproved unless trusted server state says
otherwise. The browser retry is not evidence of consent.

Apply every rule below:

1. When `approve` first returns `undefined`, create a pending record bound to
   `(subject, surfaceId, callId, action, canonical input fingerprint)`. Give it
   an unpredictable token and a short expiry.
2. Return the token only in an app-owned envelope consumed by the trusted
   parent. Never put it in `ActionResult`, the surface grant, an audit event, or
   any value sent into the sandbox.
3. After trusted consent UI succeeds, send the token to an authenticated,
   CSRF-protected approval endpoint. `callId` is a correlation key, not a
   secret.
4. The approval endpoint must atomically consume an unused, unexpired approval
   token only when every bound field matches, then return a distinct,
   unpredictable one-time retry token. Reject missing, reused, expired, or
   mismatched tokens. Do not create records from the approval endpoint.
5. The trusted parent attaches the retry token to an app-owned execute envelope
   for the identical call. The server passes it to the kernel `approve`
   callback, which atomically matches and consumes it before returning `true`.
   A plain retry without the retry token remains unapproved.
6. Store pending approvals in shared server-side storage when requests can hit
   different replicas.

Do not accept preapproval, an `approved: true` request field, or a token chosen
by generated code. The reference playground implements this flow in
`examples/playground/src/pending-approvals.ts`, `app.ts`, and `client.ts`.

Authenticate the request before calling `surface()` or `execute()`. Use the
same opaque `subject` value for both operations. A subject-bound grant echoes
that value for inspection, but the server-side surface record remains
authoritative.

## Record call outcomes

Set `GenuiOptions.onCall` to observe one safe audit entry after every
`execute()` attempt:

```ts
const genui = new Genui({
  actions,
  onCall: (entry) => {
    auditQueue.push(entry)
  },
})
```

Each `CallAuditEntry` contains `surfaceId`, `callId`, attempted `subject`,
action, effect, outcome, and completion time. It never contains action input or
output. Unregistered action names use effect `unknown`.

Audit is per request, not per underlying effect. Idempotent replays and the
`approval_required`/approved retry each produce an entry even when app code
executes once. The kernel does not await the hook, and synchronous throws or
rejected promises cannot change the action result. Put durable buffering in
the hook when audit delivery must be guaranteed.

An HTTP envelope that combines results with audit entries is application
specific. It is not part of `genui/protocol`; hosts may send audit data to any
trusted sink.

## Observe trusted failures

Set `GenuiOptions.onError` to receive internal failures that the kernel hides
from generated code:

```ts
const genui = new Genui({
  actions,
  onError: ({ surfaceId, callId, action, phase, cause }) => {
    logger.error({ surfaceId, callId, action, phase, cause })
  },
})
```

`CallErrorEvent.phase` distinguishes surface storage, input-validator crashes,
approval integration, action execution, output validation, idempotency storage,
and audit delivery. The guest still receives only the stable `ActionResult`
code and safe message.

The hook is trusted-side only. Its original `cause` may contain secrets or
application data from a thrown error. Redact it before exporting telemetry and
never serialize it into an action result, surface event, or browser response.
The kernel does not await the hook, and hook failures cannot change action
outcomes.

## Mount in the browser

Parse server responses before mounting or returning transport results. Define
an app-owned `parseExecuteEnvelope()` that requires an approval token exactly
when its nested result is `approval_required`.

```ts
import { mount } from "genui/dom"
import { actionError, parseSurface, type ActionCall } from "genui/protocol"
import { parseApprovalResponse, parseExecuteEnvelope } from "./execute-envelope.js"

const surface = parseSurface(await surfaceResponse.json())
if (surface === undefined) throw new Error("Invalid surface response.")

const approvalTokens = new Map<string, string>()
const retryTokens = new Map<string, string>()
const callKey = (call: Pick<ActionCall, "surfaceId" | "callId">): string =>
  JSON.stringify([call.surfaceId, call.callId])

const mounted = mount(container, surface, {
  confirm: async (_action, call, intent) => {
    const key = callKey(call)
    const token = approvalTokens.get(key)
    approvalTokens.delete(key)
    if (token === undefined) throw new Error("Missing approval token.")
    if (!window.confirm(intent)) return false
    const response = await fetch("/genui/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        surfaceId: call.surfaceId,
        callId: call.callId,
        token,
      }),
    })
    if (!response.ok) return false
    const approval = parseApprovalResponse(await response.json())
    if (approval === undefined) throw new Error("Invalid approval response.")
    retryTokens.set(key, approval.retryToken)
    return true
  },
  transport: async (call, { signal }) => {
    const key = callKey(call)
    const approvalRetryToken = retryTokens.get(key)
    retryTokens.delete(key)
    const response = await fetch("/genui/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        call,
        ...(approvalRetryToken === undefined ? {} : { approvalRetryToken }),
      }),
      signal,
    })
    const envelope = parseExecuteEnvelope(await response.json())
    if (envelope === undefined) {
      return actionError("execution_failed", "Invalid action response.")
    }
    if (envelope.approvalToken === undefined) approvalTokens.delete(key)
    else approvalTokens.set(key, envelope.approvalToken)
    return envelope.result
  },
  onEvent: (event) => renderSurfaceEvent(event),
})
```

The broker calls transport first. On `approval_required`, it passes the
kernel-rendered canonical intent to `confirm`. A successful callback registers
consent on the server; the broker retries the identical call once. A declined
callback returns `approval_denied` without a retry.

`mount()` returns a `Mounted` handle. Call `mounted.dispose()` before removing
the host view. Use `replace()` to load a new supported surface into a live
mount. Pending calls are aborted on replace or dispose.

Guests opt into state preservation with `genui.snapshot(fn)`. Call
`await mounted.snapshot()` to capture the registered JSON value. Replacing a
surface with the same ID captures and restores state automatically:

```ts
await mounted.replace({ ...surface, content: regeneratedContent })
```

Different surface IDs do not share state by default. Pass an explicit snapshot
only when the host intends that transfer:

```ts
await mounted.replace(nextSurface, { snapshot: previousState })
```

Use `snapshot` in the initial `mount()` options to seed a new document. Set
`snapshotTimeoutMs` when the default one-second response deadline is not
appropriate. A missed deadline resolves to `undefined` and emits a
`snapshot_timeout` violation.

## Expose failures

Render `SurfaceEvent` values from `onEvent` somewhere the user or developer can
inspect and copy. At minimum, show:

- `guest_error` with its message and available stack.
- `violation` with its reason and detail.
- failed `result` events, including denied calls.

Do not silently discard these events. They are the repair channel back to the
model that generated the fragment.

The mount kills a code surface after self-navigation and emits a `navigation`
violation. Create a new surface after that event instead of reusing the dead
mount.

## Respect call limits

Each `Genui` instance permits at most eight in-flight calls per surface. Excess
calls on that instance return `rate_limited`. This cap is per process and per
replica; use a shared limiter when the limit must be deployment-wide. Keep
controls disabled while their call is pending and handle this error like any
other recoverable action failure.

Action input must be JSON-serializable and no larger than 64 KiB after UTF-8
JSON encoding. The kernel rejects larger or non-JSON input as `invalid_input`
before schema validation, approval, or execution.

## Run the reference host

See the [playground README](../examples/playground/README.md) to run the
credential-free example and evaluate model output through the real sandbox and
action host.
