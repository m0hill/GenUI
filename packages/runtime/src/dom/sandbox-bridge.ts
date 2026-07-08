import { protocolChannel } from "./protocol.js"

const escapeScriptJson = (value: string): string =>
  JSON.stringify(value).replaceAll("</script", "<\\/script")

/** Build the sandbox-side bridge script injected into a generated surface document. */
export const sandboxBridgeScript = (surfaceId: string): string => `
(() => {
  const channel = ${escapeScriptJson(protocolChannel)};
  const surfaceId = ${escapeScriptJson(surfaceId)};
  const invalid = Symbol("invalid");
  let nextCallId = 1;

  const post = (message) => parent.postMessage({ channel, surfaceId, ...message }, "*");
  const createCallId = () =>
    window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : "call-" + nextCallId++;

  const bareIdentifierPattern = /^_?[A-Za-z][A-Za-z0-9_]*$/;
  const capabilityNamePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/i;
  const signalPathPattern = /^\\$_?[A-Za-z][A-Za-z0-9_]*(?:\\._?[A-Za-z][A-Za-z0-9_]*)*$/;
  const numberLiteralPattern = /^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?$/;
  const stringLiteralPattern = /^(?:"[^"\\\\<>]*"|'[^'\\\\<>]*')$/;
  const targetPattern = /^_?[A-Za-z][A-Za-z0-9_]*$/;

  const splitTopLevel = (source, separator) => {
    const parts = [];
    let quote;
    let depth = 0;
    let start = 0;

    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (character === "\\\\") return undefined;

      if (quote !== undefined) {
        if (character === quote) quote = undefined;
        continue;
      }

      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }

      if (character === "(" || character === "[" || character === "{") {
        depth += 1;
        continue;
      }

      if (character === ")" || character === "]" || character === "}") {
        depth -= 1;
        if (depth < 0) return undefined;
        continue;
      }

      if (character === separator && depth === 0) {
        parts.push(source.slice(start, index).trim());
        start = index + 1;
      }
    }

    if (quote !== undefined || depth !== 0) return undefined;
    parts.push(source.slice(start).trim());
    return parts.every((part) => part.length > 0) ? parts : undefined;
  };

  const parseStringLiteral = (source) =>
    stringLiteralPattern.test(source.trim()) ? source.trim().slice(1, -1) : invalid;

  const parseObjectKey = (source) => {
    const key = source.trim();
    if (bareIdentifierPattern.test(key)) return key;
    const literal = parseStringLiteral(key);
    return literal !== invalid && bareIdentifierPattern.test(literal) ? literal : invalid;
  };

  const readElementValue = (element) => {
    const type = typeof element.type === "string" ? element.type.toLowerCase() : "";
    if (type === "checkbox") return Boolean(element.checked);
    if (type === "radio") return element.checked ? element.value : "";
    if ((type === "number" || type === "range") && element.value !== "") {
      const numberValue = Number(element.value);
      return Number.isFinite(numberValue) ? numberValue : element.value;
    }
    if ("selectedOptions" in element && element.multiple === true) {
      return Array.from(element.selectedOptions).map((option) => option.value);
    }
    if ("value" in element) return element.value;
    return element.textContent || "";
  };

  const parseScalarExpression = (source, readSignal) => {
    const value = source.trim();
    if (stringLiteralPattern.test(value)) return value.slice(1, -1);
    if (numberLiteralPattern.test(value)) return Number(value);
    if (value === "true") return true;
    if (value === "false") return false;
    if (value === "null") return null;
    if (signalPathPattern.test(value)) return readSignal(value);
    return invalid;
  };

  const parseObjectLiteral = (source, readSignal) => {
    const value = source.trim();
    if (!value.startsWith("{") || !value.endsWith("}")) return invalid;

    const body = value.slice(1, -1).trim();
    if (body.length === 0) return {};

    const entries = splitTopLevel(body, ",");
    if (entries === undefined) return invalid;

    const output = {};
    for (const entry of entries) {
      const keyValue = splitTopLevel(entry, ":");
      if (keyValue === undefined || keyValue.length !== 2) return invalid;

      const key = parseObjectKey(keyValue[0]);
      if (key === invalid) return invalid;

      const parsedValue = parseScalarExpression(keyValue[1], readSignal);
      if (parsedValue === invalid) return invalid;
      output[key] = parsedValue;
    }

    return output;
  };

  const readDataSignal = (name) => {
    for (const element of document.querySelectorAll("[data-signals]")) {
      const signals = parseObjectLiteral(element.getAttribute("data-signals") || "{}", () => "");
      if (signals !== invalid && Object.prototype.hasOwnProperty.call(signals, name)) {
        return signals[name];
      }
    }
    return "";
  };

  const readBoundSignal = (name, fullPath) => {
    let rootValue = invalid;
    for (const element of document.querySelectorAll("[data-bind]")) {
      const binding = element.getAttribute("data-bind") || "";
      const bindingPath = binding.startsWith("$") ? binding.slice(1) : binding;
      if (bindingPath === fullPath) return readElementValue(element);
      if (bindingPath.split(".")[0] === name && rootValue === invalid) rootValue = readElementValue(element);
    }
    return rootValue === invalid ? readDataSignal(name) : rootValue;
  };

  function readSignal(expression) {
    const fullPath = expression.slice(1);
    const [name, ...path] = fullPath.split(".");
    let value =
      window.__genuiResults && Object.prototype.hasOwnProperty.call(window.__genuiResults, name)
        ? window.__genuiResults[name]
        : readBoundSignal(name, fullPath);

    for (const property of path) {
      if (value === null || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, property)) {
        return "";
      }
      value = value[property];
    }

    return value;
  }

  const parseTargetOption = (source) => {
    const value = source.trim();
    if (!value.startsWith("{") || !value.endsWith("}")) return invalid;

    const body = value.slice(1, -1).trim();
    if (body.length === 0) return undefined;

    const entries = splitTopLevel(body, ",");
    if (entries === undefined || entries.length !== 1) return invalid;

    const keyValue = splitTopLevel(entries[0], ":");
    if (keyValue === undefined || keyValue.length !== 2) return invalid;

    const key = parseObjectKey(keyValue[0]);
    const target = parseStringLiteral(keyValue[1]);
    return key === "target" && target !== invalid && targetPattern.test(target)
      ? target
      : invalid;
  };

  const parseCapabilityExpression = (expression) => {
    const source = expression.trim();
    const prefix = "@capability(";
    if (!source.startsWith(prefix) || !source.endsWith(")")) return undefined;

    const args = splitTopLevel(source.slice(prefix.length, -1), ",");
    if (args === undefined || (args.length !== 2 && args.length !== 3)) return undefined;

    const capability = parseStringLiteral(args[0]);
    if (capability === invalid || !capabilityNamePattern.test(capability)) return undefined;

    const input = parseObjectLiteral(args[1], readSignal);
    if (input === invalid) return undefined;

    const target = args[2] === undefined ? undefined : parseTargetOption(args[2]);
    if (target === invalid) return undefined;

    return { callId: createCallId(), capability, input, target };
  };

  const postCapabilityCall = (expression) => {
    const call = parseCapabilityExpression(expression);
    if (call === undefined) return false;

    post({
      type: "capability",
      callId: call.callId,
      capability: call.capability,
      input: call.input,
      ...(call.target === undefined ? {} : { target: call.target }),
    });
    return true;
  };

  const closestWithAttribute = (target, attributeName) => {
    let element = target instanceof Element ? target : null;
    while (element !== null) {
      if (element.hasAttribute(attributeName)) return element;
      element = element.parentElement;
    }
    return null;
  };

  const reportHeight = () => {
    const root = document.documentElement;
    const body = document.body;
    post({ type: "resize", height: Math.max(root.scrollHeight, body ? body.scrollHeight : 0) });
  };

  addEventListener("load", reportHeight);
  if ("ResizeObserver" in window) new ResizeObserver(reportHeight).observe(document.body);

  document.addEventListener("click", (event) => {
    const action = closestWithAttribute(event.target, "data-on:click");
    const expression = action === null ? null : action.getAttribute("data-on:click");
    if (expression !== null && postCapabilityCall(expression)) {
      event.preventDefault();
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest("a[href]");
    if (link === null) return;
    event.preventDefault();
    post({ type: "link", href: link.href });
  });

  document.addEventListener("submit", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const form = target.closest("form");
    if (form === null || !form.hasAttribute("data-on:submit__prevent")) return;

    event.preventDefault();
    const expression = form.getAttribute("data-on:submit__prevent");
    if (expression !== null) postCapabilityCall(expression);
  });

  addEventListener("message", (event) => {
    const message = event.data;
    if (message?.channel !== channel || message?.surfaceId !== surfaceId) return;
    if (message.type !== "result") return;
    window.__genuiResults = window.__genuiResults || {};
    window.__genuiResults[message.target] = message.state;
  });
})();
`
