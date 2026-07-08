import {
  genui0AttributeNames,
  genui0Runtime,
  type Genui0RuntimeDirective,
} from "../dialect/genui0.js"
import { genui0Language } from "../dialect/genui0-language.js"
import { pendingResultState } from "./result-state.js"

export interface SandboxRuntimeConfig {
  readonly channel: string
  readonly surfaceId: string
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
  global: SandboxRuntimeGlobal,
): SandboxRuntimeInstance => {
  type RenderMode = "static" | "template"
  type RefreshOptions = {
    readonly skipBoundElement?: Element
  }

  type RowState = Record<string, unknown>

  type StateScope = Readonly<Record<string, unknown>> & {
    readonly row?: RowState
  }

  type ScopedPath = {
    readonly path: readonly string[]
    readonly scope: StateScope
  }

  type Directive = Genui0RuntimeDirective & {
    readonly scope: StateScope
  }

  type EachInstance = {
    readonly nodes: readonly Node[]
  }

  type EachRenderState = {
    readonly template: readonly Node[]
    readonly instances: Map<string, EachInstance>
    readonly rowStates: Map<string, RowState>
  }

  type EachBlock = {
    readonly element: Element
    readonly expression: string
    readonly itemName: string
    readonly keyExpression: string | undefined
    readonly scope: StateScope
    readonly template: readonly Node[]
    readonly instances: Map<string, EachInstance>
    readonly rowStates: Map<string, RowState>
    directives: Directive[]
  }

  type LoadAction = {
    readonly expression: string
    readonly scope: StateScope
  }

  type OwnPropertyRead =
    | { readonly found: false }
    | { readonly found: true; readonly value: unknown }
  type ActionInvocation = NonNullable<ReturnType<typeof genui0Language.parseCapabilityExpression>>

  let nextCallId = 1
  let resizeObserver: ResizeObserver | undefined
  const state: Record<string, unknown> = {}
  const directives: Directive[] = []
  const eachBlocks: EachBlock[] = []
  const loadActions: LoadAction[] = []
  const boundElements = new Map<Element, ScopedPath>()
  const elementScopes = new WeakMap<Element, StateScope>()
  const initializedRowStateElements = new WeakSet<Element>()
  const inlineEachStates = new WeakMap<Element, EachRenderState>()
  const baseClassNames = new WeakMap<Element, string>()
  const visibleDisplays = new WeakMap<Element, string>()
  const styleMapProperties = new WeakMap<Element, readonly string[]>()
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

    let value: unknown
    if (name === "row") {
      value = isRecord(scope.row) ? scope.row : ""
    } else {
      value = hasOwn(scope, name) ? scope[name] : hasOwn(state, name) ? state[name] : ""
    }
    for (const property of rest) {
      const next = readOwnProperty(value, property)
      if (!next.found) return ""
      value = next.value
    }
    return value
  }

  const writePath = (
    path: readonly string[],
    value: unknown,
    scope: StateScope = emptyScope,
  ): void => {
    const [name, ...rest] = path
    if (name === undefined) return

    const target = name === "row" ? scope.row : state
    if (!isRecord(target)) return
    const targetPath = name === "row" ? rest : path
    const [targetName, ...targetRest] = targetPath
    if (targetName === undefined) return

    if (targetRest.length === 0) {
      target[targetName] = value
      return
    }

    let cursor: Record<string, unknown>
    const current = target[targetName]
    if (isRecord(current)) {
      cursor = current
    } else {
      cursor = {}
      target[targetName] = cursor
    }

    for (const property of targetRest.slice(0, -1)) {
      const child = cursor[property]
      if (isRecord(child)) {
        cursor = child
        continue
      }

      const next: Record<string, unknown> = {}
      cursor[property] = next
      cursor = next
    }

    const last = targetRest.at(-1)
    if (last !== undefined) cursor[last] = value
  }

  const readStateFromScope =
    (scope: StateScope = emptyScope) =>
    (expression: string): unknown =>
      readPath(statePath(expression), scope)

  const evaluate = (expression: string, scope: StateScope = emptyScope): unknown =>
    genui0Language.evaluateExpression(expression, readStateFromScope(scope))

  const isTruthy = (value: unknown): boolean =>
    value !== genui0Language.invalid &&
    value !== false &&
    value !== null &&
    value !== undefined &&
    value !== "" &&
    value !== 0

  const shouldRemoveDynamicValue = (value: unknown): boolean =>
    value === genui0Language.invalid || value === false || value === null || value === undefined

  const textValue = (value: unknown): string => {
    if (value === genui0Language.invalid || value === null || value === undefined) return ""
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    return JSON.stringify(value)
  }

  const updateStyleMapProperties = (
    element: Element,
    properties: readonly string[],
  ): readonly string[] => {
    const previous = styleMapProperties.get(element) ?? []
    if (properties.length === 0) {
      styleMapProperties.delete(element)
    } else {
      styleMapProperties.set(element, properties)
    }
    return previous
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
      if (type === "radio") {
        element.checked = element.value === textValue(value)
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
    target instanceof global.Element && target.hasAttribute(genui0AttributeNames.bind)

  const currentDirectives = (): readonly Directive[] => [
    ...directives,
    ...eachBlocks.flatMap((block) => block.directives),
  ]

  const syncBoundElements = (skipElement: Element | undefined): void => {
    for (const [element, binding] of boundElements) {
      if (!element.isConnected) {
        boundElements.delete(element)
        continue
      }

      if (element === skipElement) continue
      writeElementValue(element, readPath(binding.path, binding.scope))
    }
  }

  const refreshDirectives = (): void => {
    for (const directive of currentDirectives()) {
      const value = evaluate(directive.expression, directive.scope)
      genui0Runtime.applyDirective(directive, value, {
        isTruthy,
        shouldRemoveDynamicValue,
        textValue,
        updateStyleMapProperties,
      })
    }
  }

  const reportHeight = (): void => {
    const root = global.document.documentElement
    const body = global.document.body
    post({ type: "resize", height: Math.max(root.scrollHeight, body?.scrollHeight ?? 0) })
  }

  const refresh = (options: RefreshOptions = {}): void => {
    renderEachBlocks()
    syncBoundElements(options.skipBoundElement)
    refreshDirectives()
    reportHeight()
  }

  const resultTargetFor = (action: ActionInvocation): string =>
    action.target ?? genui0Language.defaultResultTarget(action.capability)

  const setResultState = (target: string, state: unknown): void => {
    global.__genuiResults = global.__genuiResults ?? {}
    global.__genuiResults[target] = state
    writePath([target], state)
  }

  const postActionCall = (expression: string, scope: StateScope): boolean => {
    const action = genui0Language.parseCapabilityExpression(expression, readStateFromScope(scope))
    if (action === undefined) return false

    const target = resultTargetFor(action)
    setResultState(target, pendingResultState(readPath([target])))
    refresh()
    post({
      type: "capability",
      callId: createCallId(),
      action: action.capability,
      input: action.input,
      ...(action.target === undefined ? {} : { target: action.target }),
    })
    return true
  }

  const runLocalAction = (expression: string, scope: StateScope): boolean => {
    const action = genui0Language.parseSetExpression(expression, readStateFromScope(scope))
    if (action === undefined) return false

    writePath(action.path, action.value, scope)
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
    runLocalAction(expression, scope) || postActionCall(expression, scope)

  const runLoadActions = (): void => {
    for (const action of loadActions) runAuthoredAction(action.expression, action.scope)
  }

  const handleClick = (event: MouseEvent): void => {
    const action = closestWithAttribute(event.target, genui0AttributeNames.onClick)
    const expression = action?.getAttribute(genui0AttributeNames.onClick) ?? null
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
    if (form === null || !form.hasAttribute(genui0AttributeNames.onSubmit)) return

    event.preventDefault()
    const expression = form.getAttribute(genui0AttributeNames.onSubmit)
    if (expression !== null) runAuthoredAction(expression, scopeForElement(form))
  }

  const handleAuthoredChange = (event: Event): void => {
    const action = closestWithAttribute(event.target, genui0AttributeNames.onChange)
    const expression = action?.getAttribute(genui0AttributeNames.onChange) ?? null
    if (action !== null && expression !== null)
      runAuthoredAction(expression, scopeForElement(action))
  }

  const handleBoundInput = (event: Event): void => {
    const target = event.target
    if (!isBoundElement(target)) return

    const binding = boundElements.get(target)
    if (binding === undefined) return

    writePath(binding.path, readElementValue(target), binding.scope)
    refresh({ skipBoundElement: target })
  }

  const handleChange = (event: Event): void => {
    handleBoundInput(event)
    handleAuthoredChange(event)
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
    for (const element of global.document.querySelectorAll(`[${genui0AttributeNames.state}]`)) {
      const parsed = genui0Language.parseObjectLiteral(
        element.getAttribute(genui0AttributeNames.state) ?? "{}",
        readStateFromScope(emptyScope),
      )
      if (!isRecord(parsed)) continue
      for (const [name, value] of Object.entries(parsed)) state[name] = value
    }
  }

  const hasRowScope = (scope: StateScope): boolean => isRecord(scope.row)

  const isRowPath = (path: readonly string[]): boolean => path[0] === "row" && path.length > 1

  const installBinding = (element: Element, scope: StateScope, mode: RenderMode): void => {
    const binding = element.getAttribute(genui0AttributeNames.bind)
    if (binding === null) return

    const path = statePath(binding)
    if (path.length === 0) return
    if (mode === "template" && (!isRowPath(path) || !hasRowScope(scope))) return

    boundElements.set(element, { path, scope })

    if (hasAuthoredFormValue(element) || readPath(path, scope) === "") {
      writePath(path, readElementValue(element), scope)
    } else {
      writeElementValue(element, readPath(path, scope))
    }
  }

  const installRowState = (element: Element, scope: StateScope, mode: RenderMode): void => {
    const row = scope.row
    if (mode !== "template" || !isRecord(row) || initializedRowStateElements.has(element)) {
      return
    }

    const expression = element.getAttribute(genui0AttributeNames.rowState)
    if (expression === null) return

    const parsed = genui0Language.parseObjectLiteral(expression, readStateFromScope(scope))
    if (!isRecord(parsed)) return

    for (const [name, value] of Object.entries(parsed)) row[name] = value
    initializedRowStateElements.add(element)
  }

  const installLoadAction = (element: Element, scope: StateScope, mode: RenderMode): void => {
    if (mode !== "static") return

    const expression = element.getAttribute(genui0AttributeNames.onLoad)
    if (expression === null) return

    loadActions.push({ expression, scope })
  }

  const installDirective = (
    element: Element,
    attribute: Attr,
    scope: StateScope,
    targetDirectives: Directive[],
  ): void => {
    const directive = genui0Runtime.directiveFromAttribute({ element, attribute })
    if (directive === undefined) return

    if (directive.type === "class_value" && !baseClassNames.has(element)) {
      baseClassNames.set(element, directive.baseClassName ?? "")
    }
    if (directive.type === "show" && !visibleDisplays.has(element)) {
      visibleDisplays.set(element, directive.visibleDisplay ?? "")
    }

    targetDirectives.push({
      ...directive,
      ...(directive.type === "class_value"
        ? { baseClassName: baseClassNames.get(element) ?? "" }
        : {}),
      ...(directive.type === "show" ? { visibleDisplay: visibleDisplays.get(element) ?? "" } : {}),
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
    installRowState(element, scope, mode)

    for (const attribute of element.attributes) {
      installDirective(element, attribute, scope, targetDirectives)
    }

    installBinding(element, scope, mode)
    installLoadAction(element, scope, mode)

    if (element.hasAttribute(genui0AttributeNames.each)) {
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
    const expression = element.getAttribute(genui0AttributeNames.each)
    if (expression === null) return

    const itemName = element.getAttribute(genui0AttributeNames.as) ?? "item"
    const keyExpression = element.getAttribute(genui0AttributeNames.key) ?? undefined
    const template = Array.from(element.childNodes).map((node) => node.cloneNode(true))
    element.replaceChildren()
    eachBlocks.push({
      element,
      expression,
      itemName,
      keyExpression,
      scope,
      template,
      instances: new Map(),
      rowStates: new Map(),
      directives: [],
    })
  }

  const cloneTemplate = (template: readonly Node[]): readonly Node[] =>
    template.map((templateNode) => templateNode.cloneNode(true))

  const renderInstanceNodes = (
    nodes: readonly Node[],
    scope: StateScope,
    targetDirectives: Directive[],
  ): void => {
    for (const node of nodes) {
      if (node instanceof global.Element)
        renderElementTree(node, scope, targetDirectives, "template")
    }
  }

  const reconcileChildNodes = (element: Element, orderedNodes: readonly Node[]): void => {
    let anchor = element.firstChild
    for (const node of orderedNodes) {
      if (node === anchor) {
        anchor = anchor.nextSibling
        continue
      }

      element.insertBefore(node, anchor)
    }

    const retained = new Set(orderedNodes)
    for (const child of Array.from(element.childNodes)) {
      if (!retained.has(child)) element.removeChild(child)
    }
  }

  const renderUnkeyedEachTemplate = (
    element: Element,
    itemName: string,
    template: readonly Node[],
    items: readonly unknown[],
    parentScope: StateScope,
    targetDirectives: Directive[],
  ): void => {
    element.replaceChildren()

    for (const item of items) {
      const itemScope: StateScope = { ...parentScope, [itemName]: item }
      for (const clone of cloneTemplate(template)) {
        element.append(clone)
        renderInstanceNodes([clone], itemScope, targetDirectives)
      }
    }
  }

  const keyForItem = (
    expression: string,
    scope: StateScope,
    usedKeys: Set<string>,
  ): string | undefined => {
    const key = textValue(evaluate(expression, scope))
    if (key.length === 0 || usedKeys.has(key)) return undefined
    usedKeys.add(key)
    return key
  }

  const renderKeyedEachTemplate = (
    element: Element,
    itemName: string,
    keyExpression: string,
    renderState: EachRenderState,
    items: readonly unknown[],
    parentScope: StateScope,
    targetDirectives: Directive[],
  ): boolean => {
    const usedKeys = new Set<string>()
    const rows: { readonly key: string; readonly scope: StateScope }[] = []

    for (const item of items) {
      const scope: StateScope = { ...parentScope, [itemName]: item }
      const key = keyForItem(keyExpression, scope, usedKeys)
      if (key === undefined) return false
      rows.push({ key, scope })
    }

    const nextInstances = new Map<string, EachInstance>()
    const nextRowStates = new Map<string, RowState>()
    const orderedNodes: Node[] = []
    for (const row of rows) {
      const existing = renderState.instances.get(row.key)
      const instance = existing ?? { nodes: cloneTemplate(renderState.template) }
      const rowState = renderState.rowStates.get(row.key) ?? {}
      renderInstanceNodes(instance.nodes, { ...row.scope, row: rowState }, targetDirectives)
      nextInstances.set(row.key, instance)
      nextRowStates.set(row.key, rowState)
      orderedNodes.push(...instance.nodes)
    }

    reconcileChildNodes(element, orderedNodes)
    renderState.instances.clear()
    for (const [key, instance] of nextInstances) renderState.instances.set(key, instance)
    renderState.rowStates.clear()
    for (const [key, rowState] of nextRowStates) renderState.rowStates.set(key, rowState)
    return true
  }

  const renderEachTemplate = (
    element: Element,
    expression: string,
    itemName: string,
    keyExpression: string | undefined,
    renderState: EachRenderState,
    parentScope: StateScope,
    targetDirectives: Directive[],
  ): void => {
    const items = evaluate(expression, parentScope)
    if (!Array.isArray(items)) {
      renderState.instances.clear()
      element.replaceChildren()
      return
    }

    if (
      keyExpression !== undefined &&
      renderKeyedEachTemplate(
        element,
        itemName,
        keyExpression,
        renderState,
        items,
        parentScope,
        targetDirectives,
      )
    ) {
      return
    }

    renderState.instances.clear()
    renderState.rowStates.clear()
    renderUnkeyedEachTemplate(
      element,
      itemName,
      renderState.template,
      items,
      parentScope,
      targetDirectives,
    )
  }

  function renderEachElement(
    element: Element,
    scope: StateScope,
    targetDirectives: Directive[],
  ): void {
    const expression = element.getAttribute(genui0AttributeNames.each)
    if (expression === null) return

    const itemName = element.getAttribute(genui0AttributeNames.as) ?? "item"
    const keyExpression = element.getAttribute(genui0AttributeNames.key) ?? undefined
    const renderState =
      inlineEachStates.get(element) ??
      ({
        template: Array.from(element.childNodes).map((node) => node.cloneNode(true)),
        instances: new Map(),
        rowStates: new Map(),
      } satisfies EachRenderState)
    inlineEachStates.set(element, renderState)
    renderEachTemplate(
      element,
      expression,
      itemName,
      keyExpression,
      renderState,
      scope,
      targetDirectives,
    )
  }

  const renderEachBlocks = (): void => {
    for (const block of eachBlocks) {
      block.directives = []
      renderEachTemplate(
        block.element,
        block.expression,
        block.itemName,
        block.keyExpression,
        { template: block.template, instances: block.instances, rowStates: block.rowStates },
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
  global.document.addEventListener("change", handleChange)
  global.addEventListener("message", handleResultMessage)

  if (global.ResizeObserver !== undefined && global.document.body !== null) {
    resizeObserver = new global.ResizeObserver(reportHeight)
    resizeObserver.observe(global.document.body)
  }

  runLoadActions()

  return {
    dispose() {
      resizeObserver?.disconnect()
      global.removeEventListener("load", reportHeight)
      global.document.removeEventListener("click", handleClick)
      global.document.removeEventListener("submit", handleSubmit)
      global.document.removeEventListener("input", handleBoundInput)
      global.document.removeEventListener("change", handleChange)
      global.removeEventListener("message", handleResultMessage)
    },
  }
}
