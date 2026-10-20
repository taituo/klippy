# Klippy

A Clippy-style AI assistant that lives on every page in your real Chrome.

- **Talk to it** — push-to-talk voice, answers out loud.
- **Watch it work** — its own ghost cursor walks to what it's about to click;
  your real mouse stays yours.
- **It shows you things** — highlights, pinned notes, a trail of what it did.
- **It knows what changed** — a deterministic page diff after every action,
  so even a small model knows whether its click did anything.
- **It can delegate** — background workers in headless browsers, visible as
  badges on the page.
- **Local first** — local speech, local models (Ollama), your own browser
  session. Cloud models optional.
- **Bring your own brain** — the browser side is a thin body (eyes, hands,
  face, voice) speaking an open protocol / MCP; the brain is any agent harness
  with durable state, local or cloud (Klippy Cloud as the hosted option).

Status: idea / pre-prototype. See **[docs/IDEA.md](docs/IDEA.md)** for the
full design.
