const target = document.getElementById("custom-event-target")

setInterval(() => {
  target?.dispatchEvent(
    new CustomEvent("myevent", {
      detail: JSON.stringify({
        eventTime: new Date().toLocaleTimeString()
      })
    })
  )
}, 1000)
