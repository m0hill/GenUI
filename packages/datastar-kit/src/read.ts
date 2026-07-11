import type { SignalState } from "./types.js"

/**
 * Error thrown when a Datastar signal payload cannot be parsed as JSON.
 */
export class SignalParseError extends Error {
  /**
   * @param input The raw signal payload that failed to parse.
   * @param options Error options forwarded to the native `Error` constructor.
   */
  constructor(
    readonly input: string,
    options: { readonly cause?: unknown } = {}
  ) {
    super("Invalid Datastar signal JSON", options)
  }
}

/**
 * Error thrown when parsed Datastar signals are not a JSON object signal tree.
 */
export class SignalShapeError extends Error {
  /**
   * @param input Parsed JSON payload with an invalid signal-state shape.
   */
  constructor(readonly input: unknown) {
    super("Datastar signals must be a JSON object")
  }
}

/**
 * Keeps Datastar transport details private so callers work with parsed signal state.
 */
const rawSignals = async (request: Request): Promise<string> => {
  const method = request.method.toUpperCase()
  if (method === "GET" || method === "DELETE") {
    return new URL(request.url).searchParams.get("datastar") ?? "{}"
  }

  const body = await request.text()
  return body.length === 0 ? "{}" : body
}

/**
 * Datastar signal state is JSON parsed at this boundary, so only the protocol's top-level object
 * shape needs checking here. Application schemas own any domain validation after this point.
 */
const isSignalState = (value: unknown): value is SignalState =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Parses Datastar signals from a request.
 *
 * @param request Native request received by a Datastar action handler.
 * @returns Parsed Datastar signal state.
 * @throws {@link SignalParseError} When the Datastar signal payload is not valid JSON.
 * @throws {@link SignalShapeError} When the parsed payload is not a JSON object signal tree.
 */
export async function signals(request: Request): Promise<SignalState> {
  const raw = await rawSignals(request)
  let input: unknown
  try {
    input = JSON.parse(raw)
  } catch (cause) {
    throw new SignalParseError(raw, { cause })
  }

  if (!isSignalState(input)) {
    throw new SignalShapeError(input)
  }

  return input
}
