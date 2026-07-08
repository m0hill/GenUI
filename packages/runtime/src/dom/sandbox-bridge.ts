import { genui0SandboxLanguageScript } from "../dialect/genui0-language.js"
import { protocolChannel } from "./protocol.js"

const escapeScriptJson = (value: string): string =>
  JSON.stringify(value).replaceAll("</script", "<\\/script")

/** Build the sandbox-side bridge script injected into a generated surface document. */
export const sandboxBridgeScript = (surfaceId: string): string => `
(() => {
  const channel = ${escapeScriptJson(protocolChannel)};
  const surfaceId = ${escapeScriptJson(surfaceId)};
  let nextCallId = 1;

  const post = (message) => parent.postMessage({ channel, surfaceId, ...message }, "*");
  const createCallId = () =>
    window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : "call-" + nextCallId++;

  ${genui0SandboxLanguageScript()}

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

  const readDataSignal = (name) => {
    for (const element of document.querySelectorAll("[data-signals]")) {
      const signals = genui0ParseObjectLiteral(element.getAttribute("data-signals") || "{}", () => "");
      if (signals !== genui0Invalid && Object.prototype.hasOwnProperty.call(signals, name)) {
        return signals[name];
      }
    }
    return "";
  };

  const readBoundSignal = (name, fullPath) => {
    let rootValue = genui0Invalid;
    for (const element of document.querySelectorAll("[data-bind]")) {
      const binding = element.getAttribute("data-bind") || "";
      const bindingPath = binding.startsWith("$") ? binding.slice(1) : binding;
      if (bindingPath === fullPath) return readElementValue(element);
      if (bindingPath.split(".")[0] === name && rootValue === genui0Invalid) rootValue = readElementValue(element);
    }
    return rootValue === genui0Invalid ? readDataSignal(name) : rootValue;
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

  const postCapabilityCall = (expression) => {
    const action = parseGenui0CapabilityExpression(expression, readSignal);
    const call = action === undefined ? undefined : { callId: createCallId(), ...action };
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
