import { action, attribute } from "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"

const report = (message) => {
  const output = document.getElementById("custom-plugin-output")
  if (output) output.textContent = message
  alert(message)
}

action({
  name: "alert",
  apply(_ctx, value) {
    report(value)
  }
})

attribute({
  name: "alert",
  requirement: {
    key: "denied",
    value: "must"
  },
  returnsValue: true,
  apply({ el, rx }) {
    const callback = () => report(rx())
    el.addEventListener("click", callback)
    return () => el.removeEventListener("click", callback)
  }
})
