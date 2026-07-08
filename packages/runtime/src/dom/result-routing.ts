import { genui0Language } from "../dialect/genui0-language.js"

/** Convert an action name into the default target for result state. */
export const defaultResultTarget = (action: string): string =>
  genui0Language.defaultResultTarget(action)

/** Keep model-authored result target names inside the v0 state-name subset. */
export const normalizeResultTarget = (target: string | undefined, action: string): string =>
  genui0Language.normalizeResultTarget(target, action)
