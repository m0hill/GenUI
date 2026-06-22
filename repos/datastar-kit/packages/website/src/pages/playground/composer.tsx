import { js, state } from "datastar-kit"

export const composerState = state({ note: "" })

const COMPOSER_LIMIT = 140

export const ComposerDemo = () => (
  <div class="space-y-3">
    <textarea
      class="field min-h-24 resize-y"
      placeholder="Draft a release note"
      aria-label="Draft a release note"
      data-bind={composerState.refs.note}
    />
    <div class="flex items-center justify-between text-xs">
      <span
        class="font-mono text-fg-muted"
        data-text={js`(${COMPOSER_LIMIT} - ${composerState.refs.note}.length) + ' characters left'`}
        data-class={{
          "text-danger": js`${composerState.refs.note}.length > ${COMPOSER_LIMIT}`
        }}
      />
      <button
        type="button"
        class="btn-secondary px-3 py-1.5 text-xs"
        data-on:click={js`${composerState.refs.note} = ''`}
      >
        Clear
      </button>
    </div>
  </div>
)
