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

## Create the server runtime

Create one `Genui` instance from app-owned actions and a store. The in-memory
store is suitable for a single-process example.

```ts
import { Genui } from "@genui/genui"

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

## Create code surfaces

Accept generated content as a string. Choose the action names the surface may
request. The runtime projects the actual grant and stores content verbatim.

```ts
import { codeDialect } from "@genui/genui"

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
one absolute `grant.expiresAt` value and does not extend it during reprojection.
An expired grant returns `unknown_surface` before validation, approval, or
execution and removes its stored surface and idempotency state.

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
import { actionError, parseActionCall } from "@genui/protocol"

const body = await request.json()
const call = parseActionCall(body.call)
if (call === undefined) {
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
    }),
})
return Response.json(result)
```

Treat the kernel `approve` hook as authoritative. It runs after schema
validation and receives canonical input. Return `undefined` while consent is
pending, `false` for an explicit denial, and `true` only after trusted consent.
Never approve from guest-rendered UI.

Keep pending approvals on the server. Key lookup by `(surfaceId, callId)`, bind
each record to the subject, action, and canonical input fingerprint, expire it,
and consume approval once. An approval endpoint may mark only an existing
pending record for the authenticated subject. Do not accept preapproval or an
`approved: true` field on the execute request.

Authenticate the request before calling `surface()` or `execute()`. Use the
same opaque `subject` value for both operations. A subject-bound grant echoes
that value for inspection, but the server-side surface record remains
authoritative.

## Mount in the browser

Parse server responses before mounting or returning transport results.

```ts
import { mount } from "@genui/genui/dom"
import {
  actionError,
  parseActionResult,
  parseSurface,
} from "@genui/protocol"

const surface = parseSurface(await surfaceResponse.json())
if (surface === undefined) throw new Error("Invalid surface response")

const mounted = mount(container, surface, {
  confirm: async (_action, call, intent) => {
    if (!window.confirm(intent)) return false
    const response = await fetch("/genui/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ surfaceId: call.surfaceId, callId: call.callId }),
    })
    return response.ok
  },
  transport: async (call, { signal }) => {
    const response = await fetch("/genui/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ call }),
      signal,
    })
    return (
      parseActionResult(await response.json()) ??
      actionError("execution_failed", "Invalid action response")
    )
  },
  onEvent: (event) => renderSurfaceEvent(event),
})
```

The broker calls transport first. On `approval_required`, it passes the
kernel-rendered canonical intent to `confirm`. A successful callback registers
consent on the server; the broker retries the identical call once. A declined
callback returns `approval_denied` without a retry.

Call `mounted.dispose()` before removing the host view. Use `replace()` to load
a new supported surface into a live mount. Pending calls are aborted on replace
or dispose.

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

Render `onEvent` output somewhere the user or developer can inspect and copy.
At minimum, show:

- `guest_error` with its message and available stack.
- `violation` with its reason and detail.
- failed `result` events, including denied calls.

Do not silently discard these events. They are the repair channel back to the
model that generated the fragment.

The mount kills a code surface after self-navigation and emits a `navigation`
violation. Create a new surface after that event instead of reusing the dead
mount.

## Respect call limits

The kernel permits at most eight in-flight calls per surface. Excess calls
return `rate_limited`. Keep controls disabled while their call is pending and
handle this error like any other recoverable action failure.

Action input must be JSON-serializable and no larger than 64 KiB after UTF-8
JSON encoding. The kernel rejects larger or non-JSON input as `invalid_input`
before schema validation, approval, or execution.

## Run the playground

The repository playground is a complete credential-free host:

```sh
pnpm install
pnpm dev
```

Open `http://localhost:3000`. The editor starts with the orders dashboard
fixture. Use **Create surface** for paste mode, **Orders fixture** for the
working read/write flow, **Guest error fixture** for error forwarding, and
**Copy model instructions** for the manual LLM loop.

The playground intentionally has no chat UI, model credentials, frontend
framework, CSS framework, session system, or streaming layer.
