class ReverseComponent extends HTMLElement {
  static get observedAttributes() {
    return ["name"]
  }

  attributeChangedCallback(_name, _oldValue, newValue) {
    const value = [...newValue].reverse().join("")
    this.dispatchEvent(new CustomEvent("reverse", { detail: { value } }))
  }
}

customElements.define("reverse-component", ReverseComponent)
