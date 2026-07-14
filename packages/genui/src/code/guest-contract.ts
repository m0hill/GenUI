export const genuiSubscriptionHandleDeclaration = `interface GenuiSubscriptionHandle {
  unsubscribe(): Promise<void>
  readonly done: Promise<
    | { readonly ok: true; readonly reason: "completed" | "unsubscribed" }
    | {
        readonly ok: false
        readonly error: { readonly code: string; readonly message: string }
      }
  >
}`

export const genuiGuestDeclarations = `
type GenuiJson = null | boolean | number | string | readonly GenuiJson[] | {
  readonly [key: string]: GenuiJson
}

interface GenuiHostContext {
  readonly theme?: "light" | "dark"
  readonly containerDimensions?: {
    readonly height?: number
    readonly maxHeight?: number
    readonly width?: number
    readonly maxWidth?: number
  }
  readonly locale?: string
  readonly timeZone?: string
  readonly platform?: string
}

${genuiSubscriptionHandleDeclaration}

interface Genui {
  readonly surfaceId: string
  readonly hostContext: GenuiHostContext
  readonly sendMessage?: (text: string) => Promise<void>
  readonly openLink?: (url: string) => Promise<void>
  readonly updateModelContext?: (params: {
    readonly content?: string
    readonly structuredContent?: Readonly<Record<string, GenuiJson>>
  }) => Promise<void>
  onHostContextChange(handler: (partial: GenuiHostContext) => void | Promise<void>): void
  snapshot(provider: (restored?: any) => GenuiJson | Promise<GenuiJson>): void
  teardown(handler: (context: { readonly reason?: string }) => void | Promise<void>): void
}

interface Window {
  readonly genui: Readonly<Genui>
}

declare const genui: Readonly<Genui>
`
