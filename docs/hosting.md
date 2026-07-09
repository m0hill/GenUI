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

A custom `SurfaceStore` implements `get`, `set`, and `runIdempotent`.
`runIdempotent` must atomically join concurrent calls with the same surface ID,
call ID, and fingerprint, retain the completed result for the requested window,
and report conflicting fingerprints. The bundled `memoryStore()` implements
this contract for one process.

## Create code surfaces

Accept generated content as a string. Choose the action names the surface may
request. The runtime projects the actual grant and stores content verbatim.

```ts
import { codeDialect } from "@genui/genui"

const surface = await genui.surface({
  dialect: codeDialect,
  content,
  actions: ["orders.search", "orders.update_status"],
})
```

Return the serializable `Surface` to the browser. Do not let the browser supply
or mutate the authoritative grant.

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
  approve: (_action, canonicalInput) => trustedApproval(body, canonicalInput),
})
return Response.json(result)
```

Treat the kernel `approve` hook as authoritative. It runs after schema
validation and receives canonical input. Never approve from guest-rendered UI.

## Mount in the browser

Parse server responses before mounting or returning transport results.

```ts
import { renderActionIntent } from "@genui/genui"
import { mount } from "@genui/genui/dom"
import {
  actionError,
  parseActionResult,
  parseSurface,
} from "@genui/protocol"

const surface = parseSurface(await surfaceResponse.json())
if (surface === undefined) throw new Error("Invalid surface response")

const confirmedCalls = new Set<string>()

const mounted = mount(container, surface, {
  confirm: (action, call) => {
    const message = action.intent
      ? renderActionIntent(action.intent, call.input)
      : action.description
    const approved = window.confirm(message)
    if (approved) confirmedCalls.add(call.callId)
    return approved
  },
  transport: async (call, { signal }) => {
    const approved = confirmedCalls.delete(call.callId)
    const response = await fetch("/genui/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ call, approved }),
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

The browser `confirm` hook is trusted consent UX over raw input. The example
tracks accepted `callId` values and forwards that decision with the transport
request. The server decides how to authenticate and honor that signal.

Call `mounted.dispose()` before removing the host view. Use `replace()` to load
a new supported surface into a live mount. Pending calls are aborted on replace
or dispose.

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
