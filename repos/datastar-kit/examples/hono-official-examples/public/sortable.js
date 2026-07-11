import Sortable from "https://cdn.jsdelivr.net/npm/sortablejs/+esm"

const sortContainer = document.getElementById("sortContainer")

if (sortContainer !== null) {
  new Sortable(sortContainer, {
    animation: 150,
    ghostClass: "dragging",
    onEnd: (evt) => {
      if (evt.oldIndex === undefined || evt.newIndex === undefined) return

      sortContainer.dispatchEvent(
        new CustomEvent("reordered", {
          detail: {
            orderInfo: `Moved from position ${evt.oldIndex + 1} to ${evt.newIndex + 1}`
          }
        })
      )
    }
  })
}
