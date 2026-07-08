export interface SandboxRuntimeConfig {
  readonly channel: string
  readonly surfaceId: string
}

export interface SandboxRuntimeCapabilityAction {
  readonly capability: string
  readonly input: unknown
  readonly target?: string
}

export interface SandboxRuntimeLanguage {
  readonly invalid: unknown
  parseObjectLiteral(source: string, readSignal: (expression: string) => unknown): unknown
  parseCapabilityExpression(
    expression: string,
    readSignal: (expression: string) => unknown,
  ): SandboxRuntimeCapabilityAction | undefined
}

export interface SandboxRuntimeGlobal {
  readonly document: Document
  readonly parent: Pick<Window, "postMessage">
  readonly Element: typeof Element
  readonly HTMLAnchorElement?: typeof HTMLAnchorElement
  readonly HTMLInputElement?: typeof HTMLInputElement
  readonly HTMLSelectElement?: typeof HTMLSelectElement
  readonly HTMLTextAreaElement?: typeof HTMLTextAreaElement
  readonly ResizeObserver?: typeof ResizeObserver
  readonly crypto?: Pick<Crypto, "randomUUID">
  addEventListener: Window["addEventListener"]
  removeEventListener: Window["removeEventListener"]
  __genuiResults?: Record<string, unknown>
}

export interface SandboxRuntimeInstance {
  dispose(): void
}

/** Install the sandbox-side generated UI runtime into a browser global. */
export const installSandboxRuntime = (
  config: SandboxRuntimeConfig,
  language: SandboxRuntimeLanguage,
  global: SandboxRuntimeGlobal,
): SandboxRuntimeInstance => {
  let nextCallId = 1
  let resizeObserver: ResizeObserver | undefined

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null

  const hasOwn = (value: object, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(value, key)

  const post = (message: Record<string, unknown>): void => {
    global.parent.postMessage(
      { channel: config.channel, surfaceId: config.surfaceId, ...message },
      "*",
    )
  }

  const createCallId = (): string =>
    global.crypto !== undefined && typeof global.crypto.randomUUID === "function"
      ? global.crypto.randomUUID()
      : `call-${nextCallId++}`

  const readElementValue = (element: Element): unknown => {
    if (global.HTMLInputElement !== undefined && element instanceof global.HTMLInputElement) {
      const type = element.type.toLowerCase()
      if (type === "checkbox") return element.checked
      if (type === "radio") return element.checked ? element.value : ""
      if ((type === "number" || type === "range") && element.value !== "") {
        const numberValue = Number(element.value)
        return Number.isFinite(numberValue) ? numberValue : element.value
      }
      return element.value
    }

    if (global.HTMLSelectElement !== undefined && element instanceof global.HTMLSelectElement) {
      if (element.multiple) return Array.from(element.selectedOptions).map((option) => option.value)
      return element.value
    }

    if (global.HTMLTextAreaElement !== undefined && element instanceof global.HTMLTextAreaElement) {
      return element.value
    }

    return element.textContent ?? ""
  }

  const readDataSignal = (name: string): unknown => {
    for (const element of global.document.querySelectorAll("[data-signals]")) {
      const signals = language.parseObjectLiteral(
        element.getAttribute("data-signals") ?? "{}",
        () => "",
      )
      if (signals !== language.invalid && isRecord(signals) && hasOwn(signals, name)) {
        return signals[name]
      }
    }
    return ""
  }

  const readBoundSignal = (name: string, fullPath: string): unknown => {
    let rootValue: unknown = language.invalid
    for (const element of global.document.querySelectorAll("[data-bind]")) {
      const binding = element.getAttribute("data-bind") ?? ""
      const bindingPath = binding.startsWith("$") ? binding.slice(1) : binding
      if (bindingPath === fullPath) return readElementValue(element)
      if (bindingPath.split(".")[0] === name && rootValue === language.invalid) {
        rootValue = readElementValue(element)
      }
    }
    return rootValue === language.invalid ? readDataSignal(name) : rootValue
  }

  const readSignal = (expression: string): unknown => {
    const fullPath = expression.slice(1)
    const [name, ...path] = fullPath.split(".")
    if (name === undefined || name.length === 0) return ""

    let value: unknown =
      global.__genuiResults !== undefined && hasOwn(global.__genuiResults, name)
        ? global.__genuiResults[name]
        : readBoundSignal(name, fullPath)

    for (const property of path) {
      if (!isRecord(value) || !hasOwn(value, property)) return ""
      value = value[property]
    }

    return value
  }

  const postCapabilityCall = (expression: string): boolean => {
    const action = language.parseCapabilityExpression(expression, readSignal)
    if (action === undefined) return false

    post({
      type: "capability",
      callId: createCallId(),
      capability: action.capability,
      input: action.input,
      ...(action.target === undefined ? {} : { target: action.target }),
    })
    return true
  }

  const closestWithAttribute = (
    target: EventTarget | null,
    attributeName: string,
  ): Element | null => {
    let element = target instanceof global.Element ? target : null
    while (element !== null) {
      if (element.hasAttribute(attributeName)) return element
      element = element.parentElement
    }
    return null
  }

  const reportHeight = (): void => {
    const root = global.document.documentElement
    const body = global.document.body
    post({ type: "resize", height: Math.max(root.scrollHeight, body?.scrollHeight ?? 0) })
  }

  const handleClick = (event: MouseEvent): void => {
    const action = closestWithAttribute(event.target, "data-on:click")
    const expression = action?.getAttribute("data-on:click") ?? null
    if (expression !== null && postCapabilityCall(expression)) {
      event.preventDefault()
      return
    }

    const target = event.target
    if (!(target instanceof global.Element)) return

    const link = target.closest("a[href]")
    if (link === null) return

    const href =
      global.HTMLAnchorElement !== undefined && link instanceof global.HTMLAnchorElement
        ? link.href
        : link.getAttribute("href")
    if (href === null) return

    event.preventDefault()
    post({ type: "link", href })
  }

  const handleSubmit = (event: SubmitEvent): void => {
    const target = event.target
    if (!(target instanceof global.Element)) return

    const form = target.closest("form")
    if (form === null || !form.hasAttribute("data-on:submit__prevent")) return

    event.preventDefault()
    const expression = form.getAttribute("data-on:submit__prevent")
    if (expression !== null) postCapabilityCall(expression)
  }

  const handleResultMessage = (event: MessageEvent<unknown>): void => {
    const message = event.data
    if (!isRecord(message)) return
    if (message.channel !== config.channel || message.surfaceId !== config.surfaceId) return
    if (message.type !== "result" || typeof message.target !== "string") return

    global.__genuiResults = global.__genuiResults ?? {}
    global.__genuiResults[message.target] = message.state
  }

  global.addEventListener("load", reportHeight)
  global.document.addEventListener("click", handleClick)
  global.document.addEventListener("submit", handleSubmit)
  global.addEventListener("message", handleResultMessage)

  if (global.ResizeObserver !== undefined && global.document.body !== null) {
    resizeObserver = new global.ResizeObserver(reportHeight)
    resizeObserver.observe(global.document.body)
  }

  return {
    dispose() {
      resizeObserver?.disconnect()
      global.removeEventListener("load", reportHeight)
      global.document.removeEventListener("click", handleClick)
      global.document.removeEventListener("submit", handleSubmit)
      global.removeEventListener("message", handleResultMessage)
    },
  }
}
