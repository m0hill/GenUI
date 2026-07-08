import type { SurfaceDialectRuntime, SurfaceRuntimeDirective } from "../dialect/surface-dialect.js"

export interface SandboxRuntimeConfig {
  readonly channel: string
  readonly surfaceId: string
}

export interface SandboxRuntimeCapabilityAction {
  readonly capability: string
  readonly input: unknown
  readonly target?: string
}

export interface SandboxRuntimeSetAction {
  readonly path: readonly string[]
  readonly value: unknown
}

export interface SandboxRuntimeLanguage {
  readonly invalid: unknown
  parseObjectLiteral(source: string, readState: (expression: string) => unknown): unknown
  evaluateExpression(source: string, readState: (expression: string) => unknown): unknown
  parseCapabilityExpression(
    expression: string,
    readState: (expression: string) => unknown,
  ): SandboxRuntimeCapabilityAction | undefined
  parseSetExpression(
    expression: string,
    readState: (expression: string) => unknown,
  ): SandboxRuntimeSetAction | undefined
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
  dialect: SurfaceDialectRuntime<SurfaceRuntimeDirective>,
  global: SandboxRuntimeGlobal,
): SandboxRuntimeInstance => {
  type StateScope = Readonly<Record<string, unknown>>
  type RenderMode = "static" | "template"

  type Directive = SurfaceRuntimeDirective & {
    readonly scope: StateScope
  }

  type EachBlock = {
    readonly element: Element
    readonly expression: string
    readonly itemName: string
    readonly scope: StateScope
    readonly template: readonly Node[]
    directives: Directive[]
  }

  type OwnPropertyRead =
    | { readonly found: false }
    | { readonly found: true; readonly value: unknown }

  let nextCallId = 1
  let resizeObserver: ResizeObserver | undefined
  const state: Record<string, unknown> = {}
  const directives: Directive[] = []
  const eachBlocks: EachBlock[] = []
  const elementScopes = new WeakMap<Element, StateScope>()
  const emptyScope: StateScope = {}

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

  const hasOwn = (value: object, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(value, key)

  const readOwnProperty = (value: unknown, key: string): OwnPropertyRead => {
    if (typeof value !== "object" || value === null) return { found: false }

    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && "value" in descriptor
      ? { found: true, value: descriptor.value }
      : { found: false }
  }

  const statePath = (expression: string): readonly string[] => {
    const source = expression.startsWith("$") ? expression.slice(1) : expression
    return source.split(".").filter((part) => part.length > 0)
  }

  const readPath = (path: readonly string[], scope: StateScope = emptyScope): unknown => {
    const [name, ...rest] = path
    if (name === undefined) return ""

    let value: unknown = hasOwn(scope, name) ? scope[name] : hasOwn(state, name) ? state[name] : ""
    for (const property of rest) {
      const next = readOwnProperty(value, property)
      if (!next.found) return ""
      value = next.value
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

  const readStateFromScope =
    (scope: StateScope = emptyScope) =>
    (expression: string): unknown =>
      readPath(statePath(expression), scope)

  const evaluate = (expression: string, scope: StateScope = emptyScope): unknown =>
    language.evaluateExpression(expression, readStateFromScope(scope))

  const isTruthy = (value: unknown): boolean =>
    value !== language.invalid &&
    value !== false &&
    value !== null &&
    value !== undefined &&
    value !== "" &&
    value !== 0

  const shouldRemoveDynamicValue = (value: unknown): boolean =>
    value === language.invalid || value === false || value === null || value === undefined

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
    target instanceof global.Element && target.hasAttribute(dialect.attributeNames.bind)

  const currentDirectives = (): readonly Directive[] => [
    ...directives,
    ...eachBlocks.flatMap((block) => block.directives),
  ]

  const refreshDirectives = (): void => {
    for (const directive of currentDirectives()) {
      const value = evaluate(directive.expression, directive.scope)
      dialect.applyDirective(directive, value, {
        isTruthy,
        shouldRemoveDynamicValue,
        textValue,
      })
    }
  }

  const reportHeight = (): void => {
    const root = global.document.documentElement
    const body = global.document.body
    post({ type: "resize", height: Math.max(root.scrollHeight, body?.scrollHeight ?? 0) })
  }

  const refresh = (): void => {
    renderEachBlocks()
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

  const pendingResultState = (target: string): Record<string, unknown> => {
    const previous = readPath([target])
    return isRecord(previous) && hasOwn(previous, "value")
      ? { status: "pending", value: previous.value }
      : { status: "pending" }
  }

  const postCapabilityCall = (expression: string, scope: StateScope): boolean => {
    const action = language.parseCapabilityExpression(expression, readStateFromScope(scope))
    if (action === undefined) return false

    const target = resultTargetFor(action)
    setResultState(target, pendingResultState(target))
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

  const runLocalAction = (expression: string, scope: StateScope): boolean => {
    const action = language.parseSetExpression(expression, readStateFromScope(scope))
    if (action === undefined) return false

    writePath(action.path, action.value)
    refresh()
    return true
  }

  const scopeForElement = (element: Element): StateScope => {
    let current: Element | null = element
    while (current !== null) {
      const scope = elementScopes.get(current)
      if (scope !== undefined) return scope
      current = current.parentElement
    }
    return emptyScope
  }

  const runAuthoredAction = (expression: string, scope: StateScope): boolean =>
    runLocalAction(expression, scope) || postCapabilityCall(expression, scope)

  const handleClick = (event: MouseEvent): void => {
    const action = closestWithAttribute(event.target, dialect.attributeNames.onClick)
    const expression = action?.getAttribute(dialect.attributeNames.onClick) ?? null
    if (
      action !== null &&
      expression !== null &&
      runAuthoredAction(expression, scopeForElement(action))
    ) {
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
    if (form === null || !form.hasAttribute(dialect.attributeNames.onSubmit)) return

    event.preventDefault()
    const expression = form.getAttribute(dialect.attributeNames.onSubmit)
    if (expression !== null) runAuthoredAction(expression, scopeForElement(form))
  }

  const handleBoundInput = (event: Event): void => {
    const target = event.target
    if (!isBoundElement(target)) return

    writePath(
      statePath(target.getAttribute(dialect.attributeNames.bind) ?? ""),
      readElementValue(target),
    )
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
    for (const element of global.document.querySelectorAll(`[${dialect.attributeNames.state}]`)) {
      const parsed = language.parseObjectLiteral(
        element.getAttribute(dialect.attributeNames.state) ?? "{}",
        readStateFromScope(emptyScope),
      )
      if (!isRecord(parsed)) continue
      for (const [name, value] of Object.entries(parsed)) state[name] = value
    }
  }

  const installStaticBinding = (element: Element): void => {
    const binding = element.getAttribute(dialect.attributeNames.bind)
    if (binding === null) return

    const path = statePath(binding)
    if (path.length === 0) return

    if (hasAuthoredFormValue(element) || readPath(path) === "") {
      writePath(path, readElementValue(element))
    } else {
      writeElementValue(element, readPath(path))
    }
  }

  const installDirective = (
    element: Element,
    attribute: Attr,
    scope: StateScope,
    targetDirectives: Directive[],
  ): void => {
    const directive = dialect.directiveFromAttribute({ element, attribute })
    if (directive === undefined) return

    targetDirectives.push({
      ...directive,
      scope,
    })
  }

  const renderElementTree = (
    element: Element,
    scope: StateScope,
    targetDirectives: Directive[],
    mode: RenderMode,
  ): void => {
    elementScopes.set(element, scope)
    for (const attribute of element.attributes) {
      installDirective(element, attribute, scope, targetDirectives)
    }

    if (mode === "static") installStaticBinding(element)

    if (element.hasAttribute(dialect.attributeNames.each)) {
      if (mode === "static") {
        installEachBlock(element, scope)
      } else {
        renderEachElement(element, scope, targetDirectives)
      }
      return
    }

    for (const child of element.children) renderElementTree(child, scope, targetDirectives, mode)
  }

  const installEachBlock = (element: Element, scope: StateScope): void => {
    const expression = element.getAttribute(dialect.attributeNames.each)
    if (expression === null) return

    const itemName = element.getAttribute(dialect.attributeNames.as) ?? "item"
    const template = Array.from(element.childNodes).map((node) => node.cloneNode(true))
    element.replaceChildren()
    eachBlocks.push({ element, expression, itemName, scope, template, directives: [] })
  }

  const renderEachTemplate = (
    element: Element,
    expression: string,
    itemName: string,
    template: readonly Node[],
    parentScope: StateScope,
    targetDirectives: Directive[],
  ): void => {
    element.replaceChildren()

    const items = evaluate(expression, parentScope)
    if (!Array.isArray(items)) return

    for (const item of items) {
      const itemScope: StateScope = { ...parentScope, [itemName]: item }
      for (const templateNode of template) {
        const clone = templateNode.cloneNode(true)
        element.append(clone)
        if (clone instanceof global.Element) {
          renderElementTree(clone, itemScope, targetDirectives, "template")
        }
      }
    }
  }

  function renderEachElement(
    element: Element,
    scope: StateScope,
    targetDirectives: Directive[],
  ): void {
    const expression = element.getAttribute(dialect.attributeNames.each)
    if (expression === null) return

    const itemName = element.getAttribute(dialect.attributeNames.as) ?? "item"
    const template = Array.from(element.childNodes).map((node) => node.cloneNode(true))
    renderEachTemplate(element, expression, itemName, template, scope, targetDirectives)
  }

  const renderEachBlocks = (): void => {
    for (const block of eachBlocks) {
      block.directives = []
      renderEachTemplate(
        block.element,
        block.expression,
        block.itemName,
        block.template,
        block.scope,
        block.directives,
      )
    }
  }

  installInitialState()
  if (global.document.body !== null)
    renderElementTree(global.document.body, emptyScope, directives, "static")
  renderEachBlocks()
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
