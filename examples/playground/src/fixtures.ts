export const ordersDashboardFixture = `
<section class="orders-app" aria-labelledby="orders-title">
  <style>
    .orders-app { color: #1d2939; font: 14px/1.5 system-ui, sans-serif; }
    .orders-app h2 { margin: 0 0 12px; }
    .orders-app form { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .orders-app input, .orders-app select, .orders-app button { font: inherit; padding: 7px 9px; }
    .orders-app button { cursor: pointer; }
    .orders-app table { border-collapse: collapse; width: 100%; }
    .orders-app th, .orders-app td { border-bottom: 1px solid #d0d5dd; padding: 9px; text-align: left; }
    .orders-app output { color: #b42318; display: block; min-height: 1.5em; }
    .orders-app #orders-live { color: #344054; }
  </style>
  <h2 id="orders-title">Orders dashboard</h2>
  <form id="orders-search">
    <input id="orders-query" aria-label="Search orders" placeholder="Customer or order ID">
    <select id="orders-status" aria-label="Filter status">
      <option value="">All statuses</option>
      <option value="pending">Pending</option>
      <option value="processing">Processing</option>
      <option value="shipped">Shipped</option>
    </select>
    <button>Search</button>
  </form>
  <output id="orders-error" role="alert"></output>
  <output id="orders-live" aria-live="polite"></output>
  <table>
    <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th></th></tr></thead>
    <tbody id="orders-rows"></tbody>
  </table>
  <script type="module">
    const form = document.querySelector("#orders-search")
    const rows = document.querySelector("#orders-rows")
    const error = document.querySelector("#orders-error")
    const live = document.querySelector("#orders-live")
    const statuses = ["pending", "processing", "shipped"]

    const cell = (text) => {
      const element = document.createElement("td")
      element.textContent = text
      return element
    }

    const refresh = async () => {
      error.textContent = ""
      const input = { query: document.querySelector("#orders-query").value }
      const status = document.querySelector("#orders-status").value
      if (status) input.status = status

      try {
        const result = await genui.call("orders.search", input)
        const nextRows = result.orders.map((order) => {
          const row = document.createElement("tr")
          row.dataset.orderId = order.id
          row.append(cell(order.id), cell(order.customer), cell("$" + order.total.toFixed(2)))

          const statusCell = document.createElement("td")
          const select = document.createElement("select")
          select.dataset.status = ""
          select.setAttribute("aria-label", "Status for " + order.id)
          for (const statusName of statuses) {
            const option = document.createElement("option")
            option.value = statusName
            option.textContent = statusName
            option.selected = statusName === order.status
            select.append(option)
          }
          statusCell.append(select)

          const actionCell = document.createElement("td")
          const update = document.createElement("button")
          update.type = "button"
          update.dataset.update = order.id
          update.textContent = "Update"
          update.onclick = async () => {
            try {
              await genui.call("orders.update_status", { id: order.id, status: select.value })
              await refresh()
            } catch (cause) {
              error.textContent = cause.message
            }
          }
          actionCell.append(update)
          row.append(statusCell, actionCell)
          return row
        })
        rows.replaceChildren(...nextRows)
      } catch (cause) {
        error.textContent = cause.message
      }
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault()
      void refresh()
    })
    void refresh()

    void genui.subscribe("orders.changes", {}, async (event) => {
      await Promise.resolve()
      const count = Number(live.dataset.count ?? "0") + 1
      live.dataset.count = String(count)
      live.textContent = "Live event " + count + ": " + event.type
    }).then((stream) => {
      stream.done.then((result) => {
        live.dataset.done = result.ok ? result.reason : result.error.code
      })
    }).catch((cause) => {
      error.textContent = cause.message
    })
  </script>
</section>
`.trim()

export const guestErrorFixture = `
<section>
  <h2>Guest error fixture</h2>
  <p>The host event log should receive the thrown error.</p>
  <button id="throw-error">Throw guest error</button>
  <script type="module">
    document.querySelector("#throw-error").onclick = () => {
      throw new Error("Fixture guest failure")
    }
  </script>
</section>
`.trim()
