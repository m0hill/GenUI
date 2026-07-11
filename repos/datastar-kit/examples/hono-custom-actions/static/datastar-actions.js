import {
  action,
  attribute,
  effect,
  mergePaths
} from "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"

const setSignal = (path, value) => {
  if (typeof path !== "string" || path.length === 0) return
  mergePaths([[path, value]])
}

action({
  name: "setSignal",
  apply(_ctx, path, value) {
    setSignal(path, value)
  }
})

action({
  name: "syncDialog",
  apply({ el }, open) {
    if (!(el instanceof HTMLDialogElement)) return

    if (open && !el.open) {
      el.showModal()
      return
    }

    if (!open && el.open) {
      el.close()
    }
  }
})

action({
  name: "closeDialogOnBackdrop",
  apply({ el, evt }, signalPath = "modalOpen") {
    if (evt?.target === el) {
      setSignal(signalPath, false)
    }
  }
})

attribute({
  name: "focus-when",
  requirement: { key: "denied", value: "must" },
  returnsValue: true,
  apply({ el, rx }) {
    const stop = effect(() => {
      if (!rx()) return

      queueMicrotask(() => {
        if (document.contains(el) && typeof el.focus === "function") {
          el.focus({ preventScroll: true })
        }
      })
    })

    return stop
  }
})
