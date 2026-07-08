import { genui0Language } from "../dialect/genui0-language.js"

/** Convert a capability name into the default target for result state. */
export const defaultResultTarget = (capability: string): string =>
  genui0Language.defaultResultTarget(capability)

/** Keep model-authored result target names inside the v0 state-name subset. */
export const normalizeResultTarget = (target: string | undefined, capability: string): string =>
  genui0Language.normalizeResultTarget(target, capability)
