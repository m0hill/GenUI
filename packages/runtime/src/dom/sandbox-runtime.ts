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
  parseObjectLiteral(source: string, readState: (expression: string) => unknown): unknown
  evaluateExpression(source: string, readState: (expression: string) => unknown): unknown
  parseCapabilityExpression(
    expression: string,
    readState: (expression: string) => unknown,
  ): SandboxRuntimeCapabilityAction | undefined
  defaultResultTarget(capability: string): string
}

export interface SandboxRuntimeGlobal {
  readonly document: Document
  readonly parent: Pick<Window, "postMessage">
  readonly Element: typeof Element
  readonly HTMLElement?: typeof HTMLElement
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
  type BoundElement = {
    readonly element: Element
    readonly path: readonly string[]
  }

  type Directive =
    | { readonly type: "text"; readonly element: Element; readonly expression: string }
    | {
        readonly type: "show"
        readonly element: Element
        readonly expression: string
        readonly visibleDisplay: string
      }
    | {
        readonly type: "class_toggle"
        readonly element: Element
        readonly className: string
        readonly expression: string
      }
    | {
        readonly type: "class_value"
        readonly element: Element
        readonly baseClassName: string
        readonly expression: string
      }
    | {
        readonly type: "style_property"
        readonly element: Element
        readonly property: string
        readonly expression: string
      }
    | { readonly type: "style_map"; readonly element: Element; readonly expression: string }
    | {
        readonly type: "attribute"
        readonly element: Element
        readonly attribute: string
        readonly expression: string
      }

  let nextCallId = 1
  let resizeObserver: ResizeObserver | undefined
  const state: Record<string, unknown> = {}
  const boundElements: BoundElement[] = []
  const directives: Directive[] = []

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

  const hasOwn = (value: object, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(value, key)

  const statePath = (expression: string): readonly string[] => {
    const source = expression.startsWith("$") ? expression.slice(1) : expression
    return source.split(".").filter((part) => part.length > 0)
  }

  const readPath = (path: readonly string[]): unknown => {
    const [name, ...rest] = path
    if (name === undefined) return ""

    let value: unknown = hasOwn(state, name) ? state[name] : ""
    for (const property of rest) {
      if (!isRecord(value) || !hasOwn(value, property)) return ""
      value = value[property]
    }
    return value
  }

  const writePath = (path: readonly string[], value: unknown): void => {
    const [name, ...rest] = path
    if (name === undefined) return

    if (rest.length === 0) {
      state[name] = value
      return
    }

    let cursor: Record<string, unknown>
    const current = state[name]
    if (isRecord(current)) {
      cursor = current
    } else {
      cursor = {}
      state[name] = cursor
    }

    for (const property of rest.slice(0, -1)) {
      const child = cursor[property]
      if (isRecord(child)) {
        cursor = child
        continue
      }

      const next: Record<string, unknown> = {}
      cursor[property] = next
      cursor = next
    }

    const last = rest.at(-1)
    if (last !== undefined) cursor[last] = value
  }

  const readState = (expression: string): unknown => readPath(statePath(expression))

  const evaluate = (expression: string): unknown =>
    language.evaluateExpression(expression, readState)

  const isTruthy = (value: unknown): boolean =>
    value !== language.invalid &&
    value !== false &&
    value !== null &&
    value !== undefined &&
    value !== "" &&
    value !== 0

  const textValue = (value: unknown): string => {
    if (value === language.invalid || value === null || value === undefined) return ""
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    return JSON.stringify(value)
  }

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

  const writeElementValue = (element: Element, value: unknown): void => {
    if (global.HTMLInputElement !== undefined && element instanceof global.HTMLInputElement) {
      const type = element.type.toLowerCase()
      if (type === "checkbox") {
        element.checked = Boolean(value)
        return
      }
      element.value = textValue(value)
      return
    }

    if (global.HTMLSelectElement !== undefined && element instanceof global.HTMLSelectElement) {
      const values = Array.isArray(value) ? value.map(textValue) : [textValue(value)]
      for (const option of element.options) option.selected = values.includes(option.value)
      return
    }

    if (global.HTMLTextAreaElement !== undefined && element instanceof global.HTMLTextAreaElement) {
      element.value = textValue(value)
      return
    }
  }

  const hasAuthoredFormValue = (element: Element): boolean => {
    if (global.HTMLInputElement !== undefined && element instanceof global.HTMLInputElement) {
      const type = element.type.toLowerCase()
      return type === "checkbox" || type === "radio"
        ? element.hasAttribute("checked")
        : element.hasAttribute("value")
    }

    if (global.HTMLTextAreaElement !== undefined && element instanceof global.HTMLTextAreaElement) {
      return element.textContent !== null && element.textContent.length > 0
    }

    if (global.HTMLSelectElement !== undefined && element instanceof global.HTMLSelectElement) {
      return Array.from(element.options).some((option) => option.hasAttribute("selected"))
    }

    return false
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

  const isBoundElement = (target: EventTarget | null): target is Element =>
    target instanceof global.Element && target.hasAttribute("data-genui-bind")

  const safeDynamicAttribute = (attribute: string): boolean => {
    const name = attribute.toLowerCase()
    if (name.startsWith("on")) return false
    if (name.startsWith("aria-")) return true
    return ["role", "title", "disabled", "checked", "value"].includes(name)
  }

  const safeDynamicStyleProperty = (property: string): boolean => {
    const name = property.toLowerCase()
    return (
      name.startsWith("--") ||
      [
        "color",
        "background-color",
        "border-color",
        "opacity",
        "display",
        "visibility",
        "font-weight",
        "text-decoration",
      ].includes(name)
    )
  }

  const elementStyle = (element: Element): CSSStyleDeclaration | undefined => {
    // SAFETY: the sandbox runtime only receives browser DOM elements. Some test DOM
    // implementations do not type their Element as HTMLElement, but still expose style.
    return (element as unknown as { readonly style?: CSSStyleDeclaration }).style
  }

  const applyAttributeValue = (element: Element, attribute: string, value: unknown): void => {
    if (!safeDynamicAttribute(attribute)) return

    if (value === language.invalid || value === false || value === null || value === undefined) {
      element.removeAttribute(attribute)
      return
    }

    element.setAttribute(attribute, value === true ? "" : textValue(value))
  }

  const applyStyleValue = (element: Element, property: string, value: unknown): void => {
    const style = elementStyle(element)
    if (style === undefined || !safeDynamicStyleProperty(property)) return

    if (value === language.invalid || value === false || value === null || value === undefined) {
      style.removeProperty(property)
      return
    }

    style.setProperty(property, textValue(value))
  }

  const refreshDirectives = (): void => {
    for (const directive of directives) {
      const value = evaluate(directive.expression)

      if (directive.type === "text") {
        directive.element.textContent = textValue(value)
        continue
      }

      if (directive.type === "show") {
        const style = elementStyle(directive.element)
        if (style !== undefined) style.display = isTruthy(value) ? directive.visibleDisplay : "none"
        continue
      }

      if (directive.type === "class_toggle") {
        directive.element.classList.toggle(directive.className, isTruthy(value))
        continue
      }

      if (directive.type === "class_value") {
        const dynamicClass = typeof value === "string" ? value.trim() : ""
        directive.element.className =
          dynamicClass.length === 0
            ? directive.baseClassName
            : [directive.baseClassName, dynamicClass].filter((item) => item.length > 0).join(" ")
        continue
      }

      if (directive.type === "style_property") {
        applyStyleValue(directive.element, directive.property, value)
        continue
      }

      if (directive.type === "style_map") {
        if (isRecord(value)) {
          for (const [property, propertyValue] of Object.entries(value)) {
            applyStyleValue(directive.element, property, propertyValue)
          }
        }
        continue
      }

      applyAttributeValue(directive.element, directive.attribute, value)
    }
  }

  const reportHeight = (): void => {
    const root = global.document.documentElement
    const body = global.document.body
    post({ type: "resize", height: Math.max(root.scrollHeight, body?.scrollHeight ?? 0) })
  }

  const refresh = (): void => {
    refreshDirectives()
    reportHeight()
  }

  const resultTargetFor = (action: SandboxRuntimeCapabilityAction): string =>
    action.target ?? language.defaultResultTarget(action.capability)

  const setResultState = (target: string, state: unknown): void => {
    global.__genuiResults = global.__genuiResults ?? {}
    global.__genuiResults[target] = state
    writePath([target], state)
  }

  const postCapabilityCall = (expression: string): boolean => {
    const action = language.parseCapabilityExpression(expression, readState)
    if (action === undefined) return false

    setResultState(resultTargetFor(action), { status: "pending" })
    refresh()
    post({
      type: "capability",
      callId: createCallId(),
      capability: action.capability,
      input: action.input,
      ...(action.target === undefined ? {} : { target: action.target }),
    })
    return true
  }

  const handleClick = (event: MouseEvent): void => {
    const action = closestWithAttribute(event.target, "data-genui-on-click")
    const expression = action?.getAttribute("data-genui-on-click") ?? null
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
    if (form === null || !form.hasAttribute("data-genui-on-submit-prevent")) return

    event.preventDefault()
    const expression = form.getAttribute("data-genui-on-submit-prevent")
    if (expression !== null) postCapabilityCall(expression)
  }

  const handleBoundInput = (event: Event): void => {
    const target = event.target
    if (!isBoundElement(target)) return

    writePath(statePath(target.getAttribute("data-genui-bind") ?? ""), readElementValue(target))
    refresh()
  }

  const handleResultMessage = (event: MessageEvent<unknown>): void => {
    const message = event.data
    if (!isRecord(message)) return
    if (message.channel !== config.channel || message.surfaceId !== config.surfaceId) return
    if (message.type !== "result" || typeof message.target !== "string") return

    setResultState(message.target, message.state)
    refresh()
  }

  const installInitialState = (): void => {
    for (const element of global.document.querySelectorAll("[data-genui-state]")) {
      const parsed = language.parseObjectLiteral(
        element.getAttribute("data-genui-state") ?? "{}",
        readState,
      )
      if (!isRecord(parsed)) continue
      for (const [name, value] of Object.entries(parsed)) state[name] = value
    }
  }

  const installBindings = (): void => {
    for (const element of global.document.querySelectorAll("[data-genui-bind]")) {
      const path = statePath(element.getAttribute("data-genui-bind") ?? "")
      if (path.length === 0) continue

      boundElements.push({ element, path })
      if (hasAuthoredFormValue(element) || readPath(path) === "") {
        writePath(path, readElementValue(element))
      } else {
        writeElementValue(element, readPath(path))
      }
    }
  }

  const installDirective = (element: Element, attribute: Attr): void => {
    const { name, value } = attribute
    if (name === "data-genui-text") {
      directives.push({ type: "text", element, expression: value })
      return
    }

    if (name === "data-genui-show") {
      const visibleDisplay = elementStyle(element)?.display ?? ""
      directives.push({ type: "show", element, expression: value, visibleDisplay })
      return
    }

    if (name === "data-genui-class") {
      directives.push({
        type: "class_value",
        element,
        baseClassName: element.className,
        expression: value,
      })
      return
    }

    if (name.startsWith("data-genui-class-")) {
      directives.push({
        type: "class_toggle",
        element,
        className: name.slice("data-genui-class-".length),
        expression: value,
      })
      return
    }

    if (name === "data-genui-style") {
      directives.push({ type: "style_map", element, expression: value })
      return
    }

    if (name.startsWith("data-genui-style-")) {
      directives.push({
        type: "style_property",
        element,
        property: name.slice("data-genui-style-".length),
        expression: value,
      })
      return
    }

    if (name.startsWith("data-genui-attr-")) {
      directives.push({
        type: "attribute",
        element,
        attribute: name.slice("data-genui-attr-".length),
        expression: value,
      })
    }
  }

  const installDirectives = (): void => {
    for (const element of global.document.querySelectorAll("*")) {
      for (const attribute of element.attributes) installDirective(element, attribute)
    }
  }

  installInitialState()
  installBindings()
  installDirectives()
  refreshDirectives()

  global.addEventListener("load", reportHeight)
  global.document.addEventListener("click", handleClick)
  global.document.addEventListener("submit", handleSubmit)
  global.document.addEventListener("input", handleBoundInput)
  global.document.addEventListener("change", handleBoundInput)
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
      global.document.removeEventListener("input", handleBoundInput)
      global.document.removeEventListener("change", handleBoundInput)
      global.removeEventListener("message", handleResultMessage)
    },
  }
}
