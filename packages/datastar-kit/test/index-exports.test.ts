import { describe, expect, it } from "vitest"
import * as Root from "datastar-kit"
import * as debuggerModule from "datastar-kit/debugger"
import * as sse from "datastar-kit/sse"
import {
  action,
  del,
  event,
  get,
  h,
  js,
  local,
  mod,
  patch,
  peek,
  post,
  preserve,
  put,
  queryUrl,
  read,
  regex,
  renderToString,
  reply,
  setAll,
  signal,
  state,
  toggleAll,
  unsafeHtml
} from "datastar-kit"

const exportedKeys = (module: object): readonly string[] => Object.keys(module).sort()

describe("package exports", () => {
  it("exposes the intended root API only", () => {
    expect(exportedKeys(Root)).toEqual([
      "ActionNameError",
      "RegexExpressionError",
      "Signal",
      "SignalNameError",
      "StatePathError",
      "action",
      "del",
      "event",
      "get",
      "h",
      "js",
      "local",
      "mod",
      "patch",
      "peek",
      "post",
      "preserve",
      "put",
      "queryUrl",
      "read",
      "regex",
      "renderToString",
      "reply",
      "setAll",
      "signal",
      "state",
      "toggleAll",
      "unsafeHtml"
    ])
  })

  it("wires root helpers to their public implementations", () => {
    expect(Root.signal).toBe(signal)
    expect(Root.state).toBe(state)
    expect(Root.local).toBe(local)
    expect(Root.get).toBe(get)
    expect(Root.h).toBe(h)
    expect(Root.post).toBe(post)
    expect(Root.put).toBe(put)
    expect(Root.patch).toBe(patch)
    expect(Root.del).toBe(del)
    expect(Root.queryUrl).toBe(queryUrl)
    expect(Root.peek).toBe(peek)
    expect(Root.setAll).toBe(setAll)
    expect(Root.toggleAll).toBe(toggleAll)
    expect(Root.action).toBe(action)
    expect(Root.js).toBe(js)
    expect(Root.regex).toBe(regex)
    expect(Root.mod).toBe(mod)
    expect(Root.preserve).toBe(preserve)
    expect(Root.renderToString).toBe(renderToString)
    expect(Root.unsafeHtml).toBe(unsafeHtml)
  })

  it("keeps helper namespaces small and intentional", () => {
    expect(exportedKeys(event)).toEqual([
      "NavigationUrlError",
      "comment",
      "navigate",
      "patch",
      "script",
      "signals"
    ])
    expect(exportedKeys(read)).toEqual(["SignalParseError", "SignalShapeError", "signals"])
    expect(exportedKeys(reply)).toEqual([
      "NavigationUrlError",
      "directHtml",
      "directScript",
      "directSignals",
      "done",
      "navigate",
      "page",
      "patch",
      "signals",
      "stream"
    ])
    expect(exportedKeys(sse)).toEqual([
      "SseFieldError",
      "comment",
      "executeScript",
      "patchElements",
      "patchSignals"
    ])
    expect(exportedKeys(debuggerModule)).toEqual([
      "DATASTAR_DEBUGGER_STATE_NAME",
      "DatastarDebugger",
      "datastarDebuggerDefaults"
    ])
  })
})
