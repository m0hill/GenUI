# @hono-ai/genui-runtime

Provider-independent generated UI runtime.

The v0 slice is intentionally small: app-defined capabilities go into a registry, the
registry creates sanitized surfaces under explicit grants, and every capability call is
enforced against that surface grant before application code runs.
