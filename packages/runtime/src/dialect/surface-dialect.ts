import type { CapabilityDescriptor, Dialect } from "../types.js"

export interface SurfaceDialectDataAttributeInput {
  readonly name: string
  readonly value: string | undefined
  readonly grantedCapabilities: ReadonlySet<string>
  readonly insideRepeatedTemplate: boolean
  readonly elementStartsRepeatedTemplate: boolean
}

export interface SurfaceDialectAllowedDataAttribute {
  readonly name: string
  readonly value: string
}

export interface SurfaceDialectSanitizer {
  allowDataAttribute(
    input: SurfaceDialectDataAttributeInput,
  ): SurfaceDialectAllowedDataAttribute | undefined
  startsRepeatedTemplate(attributeName: string): boolean
  forbiddenInRepeatedTemplate(attributeName: string): boolean
}

export interface SurfaceDialectAttributeNames {
  readonly state: string
  readonly bind: string
  readonly onClick: string
  readonly onSubmit: string
  readonly each: string
  readonly as: string
}

export interface SurfaceRuntimeDirective {
  readonly element: Element
  readonly expression: string
}

export interface SurfaceDialectApplyDirectiveContext {
  isTruthy(value: unknown): boolean
  shouldRemoveDynamicValue(value: unknown): boolean
  textValue(value: unknown): string
}

export interface SurfaceDialectRuntime<Directive extends SurfaceRuntimeDirective> {
  readonly attributeNames: SurfaceDialectAttributeNames
  directiveFromAttribute(input: {
    readonly element: Element
    readonly attribute: Attr
  }): Directive | undefined
  applyDirective(
    directive: Directive,
    value: unknown,
    context: SurfaceDialectApplyDirectiveContext,
  ): void
}

export interface SurfaceDialect<Directive extends SurfaceRuntimeDirective> {
  readonly id: Dialect
  readonly sanitizer: SurfaceDialectSanitizer
  readonly runtime: SurfaceDialectRuntime<Directive>
  instructions(capabilities: readonly CapabilityDescriptor[]): string
}
