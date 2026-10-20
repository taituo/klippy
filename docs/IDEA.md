# Klippy — design idea

A Clippy-style assistant that lives on every page you visit in your real Chrome.
You talk to it, it answers out loud, and it acts on the page with its own
visible cursor. The browser side is a thin "body" (eyes, hands, face, voice);
the "brain" is a pluggable agent harness with durable state that can run
locally or in the cloud.

Status: idea / pre-prototype.

---

## 1. What makes it different

The pieces already exist separately:

- **Novelty "Clippy on every page" extensions** — a character on the page, but
  no AI and no control.
- **Side-panel browser agents** (Gemini in Chrome auto browse, Claude in Chrome,
  Edge Copilot Mode, Comet) — real control, but they live in a side panel and
  are tied to one vendor's model and cloud.
- **Open-source agents** (Nanobrowser, browser-use, alibaba/page-agent,
  Vercel agent-browser) — good building blocks, no character, no durable brain.
- **Local voice agents** (VIRA, Agent Faces) — local voice and/or a face, but
  not living on your real browser pages.

Nobody combines: **a character on the page itself + a visible ghost cursor +
voice + your real Chrome session + a bring-your-own brain (local or cloud,
any model) with durable state.** That is Klippy.

---

## 2. Why Chrome (and not yet another browser)

- Everyone already has Chrome, with their logins, extensions and habits.
  Switching browsers is the biggest adoption cost an AI browser has.
- Standalone AI browsers are struggling: OpenAI announced on 10 July 2026 that
  **ChatGPT Atlas shuts down on 9 August 2026**, less than a year after launch,
  folding its features into a desktop "ChatGPT Work" app instead.
- Google is turning Chrome itself into the agent platform (Gemini side panel +
  auto browse), so the browser is not the moat. The *experience on the page*
  and *freedom of brain/model* are.
- Klippy = an extension + a small local runtime. Install in a minute, keep your
  browser.

---

## 3. Core principles

1. **Chrome is home.** The visible assistant lives in the user's real Chrome.
2. **Body and brain are separate.** The extension + local runtime is the body;
   the agent harness is the brain, connected over an open protocol.
3. **Local first, cloud optional.** Fully local mode (local STT/LLM/TTS) always
   works. Cloud adds sync, background work and scale.
4. **Eyes and hands are separate.** Reading the page and acting on it are
   different components, so backends can be swapped.
5. **Deterministic where possible.** The model never diffs pages or guesses
   whether an action worked; code tells it.
6. **Show, don't hide.** Everything the agent does is visible on the page.
7. **The user's mouse stays theirs.** The agent has its own fake cursor;
   input goes through CDP and never moves the OS cursor.
8. **Durable by default.** A task survives a crash, a closed laptop or a
   two-day wait for the user's approval.

---

## 4. Architecture

```
Chrome (user's real profile)
 ├─ Klippy extension (BODY, in-page)
 │   ├─ overlay (closed shadow root, pointer-events: none)
 │   │    cursor · highlights · notes · trail · worker tray · bubble
 │   └─ eyes bundle (page map + diff engine)
 └─ remote debugging on (chrome://inspect/#remote-debugging) ──┐
                                                               │ CDP
klippy-runtime — local process (BODY, on machine)              │
 ├─ hands: Playwright over CDP / agent-browser ────────────────┘
 ├─ voice: push-to-talk hotkey → STT · TTS
 ├─ local notes cache
 └─ Klippy Protocol (websocket / MCP) ───────────┐
                                                 │
BRAIN — agent harness with durable state          │
 ├─ local: harness + Restate / SQLite journal ◄───┤
 └─ cloud: Klippy Cloud (per-user durable agent) ◄┘
      ├─ model router: Ollama · Anthropic · OpenAI · OpenRouter · …
      ├─ durable task journal, approval gates, schedules
      ├─ memory + notes sync across devices
      └─ worker pool → headless browsers (Lightpanda / cloud Chrome)
```

### 4.1 Eyes — page map + diff engine

A **plain JS bundle**, not extension-only code, so it can be injected:

- by the extension content script (real Chrome), or
- over CDP (Lightpanda / headless workers, which can't run extensions).

Responsibilities:

- **Page map**: compact indexed text view of the page — role, accessible name,
  value, state, id per interactive/meaningful element. Ids are kept in a
  `WeakMap<Element, id>` so they stay stable while the node lives.
- **Read HTML on demand**: `read_html(id, max_chars)` returns cleaned
  `outerHTML` of one subtree (scripts, styles, SVG paths, base64 stripped).
  Overview first, zoom in only when needed.
- **Diff engine** (section 6).
- **Element boxes**: scroll element into view, return its viewport rect for
  the cursor and for the hands.
- Skips the Klippy overlay host entirely.

### 4.2 Hands — swappable backends

| Backend | Used for |
|---|---|
| Playwright over CDP to real Chrome | main agent's actions; full API (boxes, `mouse.move` with steps, trusted input) |
| Vercel agent-browser attached via `connect <port>` | fastest prototype path; a11y snapshots with `@eN` refs, `get html`, `get box` |
| Playwright MCP `--extension` | alternative attach mode; tool calls only, no direct API |
| Lightpanda / headless Chrome (local) | local background workers |
| Cloud headless browsers | cloud workers that run while the laptop sleeps |

CDP input events are trusted (`isTrusted`), which some sites require;
`el.click()` from an extension isn't.

### 4.3 Overlay layers

All in one closed shadow root at the top of the page, `pointer-events: none`
(except interactive bits like the bubble's buttons). Each layer toggles
independently; one hotkey hides everything.

| Layer | Shows |
|---|---|
| **Cursor** | what the agent is *doing* — one ghost pointer, curved ease-in/out path, click ripple |
| **Highlights** | what the agent is *showing you* — labelled boxes, spotlight dimming; track elements on scroll/resize |
| **Notes** | persistent pinned annotations (section 8) |
| **Trail** | numbered breadcrumbs of recent actions |
| **Worker tray** | subagent badges with status, click to watch / take over |
| **Bubble** | speech, questions, confirm prompts |

Action sequence for a click:

1. Eyes: scroll target into view, return its box.
2. Overlay: animate cursor to the box, ack "arrived".
3. Hands: `mouse.move` along the same path (so hover states react), then click.
4. Eyes: wait for settle, return the diff.

### 4.4 The character

An **original** character (not the Clippy sprites — Microsoft's IP). It sits
in a corner, walks to where the cursor goes, reacts to state (listening,
thinking, working, confused). Lip-sync can borrow from Agent Faces
(wawa-lipsync driven by TTS audio).

---

## 5. Klippy Protocol and tools

The body exposes its abilities over one protocol, so **any harness can be the
brain**: our own, a local Ollama loop, Claude Code / Agent SDK, Hermes, a
LangGraph app, or Klippy Cloud. Two transports:

- **WebSocket JSON-RPC** — low latency, streaming (cursor animation acks,
  voice events, diffs).
- **MCP server** — so existing agent harnesses can drive Klippy as a tool set
  with zero glue code.

Tools:

| Tool | Does |
|---|---|
| `snapshot()` | compact indexed page map |
| `read_html(id, max_chars)` | cleaned HTML of one subtree |
| `point(id)` | move the ghost cursor (no action) |
| `highlight(ids, label, style)` / `clear_highlights()` | show things to the user |
| `note(id, text, kind)` | pin a note |
| `click(id)`, `type(id, text)`, `select(id, value)`, `scroll(dir)` | act — each returns the diff |
| `navigate(url)`, `tabs()`, `switch_tab(n)`, `close_tabs(query)` | navigation, natural-language tab management |
| `write_into(id, instruction)` | inline writing help in any text field |
| `ask(question)` / `confirm(action)` | talk to the user via bubble + voice |
| `spawn_worker(task, urls?)` / `worker_status()` / `takeover(worker)` | subagents |

Events the body pushes to the brain: `user_said`, `page_changed` (with diff
and cause), `user_took_over`, `confirm_answered`, `tab_switched`.

---

## 6. Deterministic "what changed"

After every action the eyes compute the change; the model never compares
snapshots itself.

1. Start a `MutationObserver` when the action begins.
2. Settle: no mutations for ~300 ms, plus a capped network-idle wait.
3. Diff before/after page maps by stable id. Re-rendered nodes are matched by
   fingerprint (role + accessible name + tree position).
4. Filter noise: own overlay, class/style churn that doesn't change visibility
   (`checkVisibility()`), ticking clocks, ad iframes.
5. Also report URL, title, focus, new dialogs/toasts.

Output example:

```
url: unchanged
+ [41] dialog "Confirm delete"
~ [12] button "Save"  disabled: false → true
- [7]  text "No results"
+ 3 items under [20] list "Results"
```

- **Empty diff = "your action did nothing"** → model retries or changes
  strategy instead of assuming success.
- Diffs are tagged by cause (agent action vs. user's real mouse), so the agent
  can notice "user just opened the menu".
- Deterministic → testable with fixture pages in Playwright.

---

## 7. Subagents (workers)

- **One boss, many workers.** Only the main agent touches the real Chrome and
  owns the cursor. No two agents fighting over one tab.
- Workers get their own headless browser (local Lightpanda / headless Chrome,
  or a cloud browser), a narrow task, a small context, and return a structured
  result (findings, source URLs, snippets).
- **Shadow workspace** (idea from Fellou): a worker may also run in a separate,
  minimised Chrome window when it needs real rendering or a login, so the user
  keeps browsing undisturbed in the main window.
- **No cookies by default** → workers can't buy/post as the user. A logged-in
  context is handed over only explicitly.
- **Dashboard + take over** (idea from Comet's background assistant): the worker
  tray shows every worker's progress; the user can open one, watch it, and take
  over (e.g. send the email themselves). Notification when done.
- Results land on the real page as notes and highlights.
- Local budget: 2–4 parallel workers on one Mac; workers use a smaller/faster
  model than the main agent; set `OLLAMA_NUM_PARALLEL` accordingly.

---

## 8. Overlay notes

- **Anchored to content, not coordinates**: text quote + prefix/suffix, role +
  accessible name, CSS path fallback (Hypothesis-style anchoring). Re-attaches
  after layout changes and on later visits.
- **Kinds**: agent notes ("this auto-renews monthly"), user notes by voice
  ("note: ask about this later"), worker results. Each looks different.
- **Persist per URL**; locally in the runtime, synced via the brain in cloud mode.
- Notes go into the snapshot the model sees → they double as memory ("last
  time here you were comparing these two").

---

## 9. Ideas borrowed from other agentic browsers

| From | Idea | In Klippy |
|---|---|---|
| **Comet** (Perplexity) | background assistant: a team of assistants, central dashboard, take over a task, notify when done | worker tray + `takeover(worker)` + notifications |
| **Comet** | voice mode as a first-class way to browse | push-to-talk is the primary input |
| **Comet** | Spaces for separate projects; vertical tools (shopping, travel) | Tasks/workspaces (below); Cards for verticals |
| **Opera Neon** | **Cards**: reusable, chainable prompts ("pull details" → "comparison table"), community-made | **Cards** = saved skills, chainable, shareable; voice-invokable ("Klippy, compare card") |
| **Opera Neon** | **Tasks**: workspaces grouping tabs + chats with their own AI context | **Tasks**: a tab group + its own agent context + notes; durable in the harness |
| **Fellou** | shadow workspace: heavy work in a separate background window | shadow-window workers (section 7) |
| **Atlas** (RIP) | inline writing help in any form field | `write_into(id, instruction)`; character hops to the field |
| **Atlas** | natural-language tab commands ("close all the shopping tabs") | `close_tabs(query)`, `tabs()` |
| **Atlas** | browser memory with clear controls and transparency | notes + memory are visible on the page, editable, deletable |
| **Dia** | AI skills + personal work memory linking apps, tabs and tasks | Cards + memory in the durable brain |
| **Gemini auto browse** | pause before purchases / social posts | `confirm()` gates, durable approval waits |

---

## 10. The brain: durable agent harness

The brain is **not just an OpenAI-compatible endpoint**. It is a harness that
keeps state durably:

- **Durable execution**: every agent step (model call, tool call, result) is
  journaled. A crash, restart or closed laptop resumes from the last step; LLM
  outputs and completed tool calls are replayed, not re-run.
- **Approval gates** pause a task for minutes or days at no compute cost — a
  natural fit for `confirm()`.
- **Schedules**: "check this page every morning", "tell me when the price drops".
- **Memory**: notes, Cards, Tasks, preferences.
- **Model router**: per role (main agent, workers, summariser) pick a model —
  local Ollama, Anthropic, OpenAI, OpenRouter, anything compatible.

Implementation options:

| Mode | Option | Why |
|---|---|---|
| Local | own loop + SQLite journal | zero dependencies, good enough for M1–M3 |
| Local | **Restate** | journal-and-replay like Temporal, but a single self-contained binary; exactly-once writes |
| Cloud | **Cloudflare Agents** | per-agent Durable Object with persistent state, WebSockets to clients, scheduling, Browser Rendering for workers, MCP exposure, human-in-the-loop patterns |
| Cloud | **Temporal** | most mature, heavy to operate (server + workers); large LLM payloads need offloading |
| Cloud | **Inngest** | fastest for TypeScript (`step.run()`, `waitForEvent` for approvals); per-step pricing grows with retries |
| External | Claude Code / Agent SDK, Hermes, LangGraph, … | drive Klippy through its MCP server |

Cloudflare Agents is the most natural cloud fit: **one durable agent instance
per user**, a WebSocket straight to the extension/runtime, scheduled tasks, and
cloud headless browsers for workers — all in one place.

---

## 11. SaaS idea

**Open core: the body is open source, the brain can be hosted.**

| Tier | What you get |
|---|---|
| **Free / local** | extension + runtime, local models (Ollama), local voice, local notes and workers. Fully offline possible. |
| **BYO brain** | connect any harness over MCP / Klippy Protocol (Claude Code, Hermes, own agent). Free. |
| **Klippy Cloud** | hosted durable brain: tasks survive anything, schedules, cloud workers that run while your laptop sleeps, notes/memory/Cards synced across devices, model router with your own keys or included credits |
| **Teams** | shared notes on pages ("this field is wrong in our CRM"), shared Cards, org policies (site allowlists, which models), audit trail of agent actions |

Differentiation vs Gemini in Chrome / Claude in Chrome / Comet:

- on-page character + visible ghost cursor instead of a side panel,
- local-first, works fully offline,
- any model, any harness — not locked to one vendor,
- open protocol, open-source body,
- deterministic diffs and visible trails make it easier to trust and debug.

Risks: Google can ship something similar inside Chrome; Chrome Web Store
policies on broad permissions; prompt-injection liability; local model quality
for long tasks.

---

## 12. Voice

- **Push-to-talk global hotkey in the runtime**, not mic capture in the
  extension (content-script mic means per-site permission prompts).
- **STT**: whisper.cpp with Metal (handles Finnish too). In-browser Whisper is
  an alternative.
- **TTS**: Kokoro or Piper for low-latency replies; VoxCPM2 if it's fast enough
  live.
- Barge-in: pressing the hotkey while Klippy speaks stops TTS.
- Cloud mode can optionally use a realtime voice model.

---

## 13. Local models

- Ollama as the default local backend (OpenAI-compatible API on localhost).
- Text page map instead of screenshots — small models handle text much better.
- Realistic expectations: short commands ("open my GitHub notifications",
  "fill this with X") work well locally; long multi-site chores fail more
  often. Design around short voice commands + confirmation; route long tasks
  to a stronger model when allowed.
- Starting point to test: `qwen3-vl:8b` (recommended in current browser-use +
  Ollama guides); larger models if memory allows.

---

## 14. Safety

- **Prompt injection**: every page can talk to the agent. Page content is
  data, never instructions. Keep page text clearly delimited in the prompt.
  (Researchers have already tricked several AI browsers into leaking
  credentials.)
- **Confirm before** submit, buy, post, delete, send — via bubble + voice;
  durable approval gates.
- **Site scoping**: allowlist/denylist; banking etc. off by default.
- **Remote debugging** on the main profile lets any local process drive the
  logged-in browser — enable only while Klippy runs; the runtime should check
  and warn.
- Workers run cookie-less by default.
- Visible trail + audit log of every agent action.

---

## 15. Roadmap

**M0 — skeleton**
- MV3 extension with overlay shadow root, cursor + highlight layers
- runtime with websocket to extension
- hands via agent-browser attached to real Chrome

**M1 — talk to it**
- push-to-talk → whisper.cpp → Ollama → Piper/Kokoro
- tools: `snapshot`, `point`, `highlight`, `click`, `type`

**M2 — eyes done right**
- own page map + `read_html`
- deterministic diff engine + fixture tests
- switch hands to Playwright over CDP for full control

**M3 — protocol + local brain**
- Klippy Protocol (WebSocket JSON-RPC) + MCP server
- local durable loop with SQLite journal, `confirm()` gates

**M4 — notes, trail, Cards, Tasks**
- anchored notes, trail layer
- Cards (saved chainable skills), Tasks (workspaces with own context)

**M5 — workers**
- local worker pool (Lightpanda / headless Chrome / shadow window)
- worker tray, take over, results as notes/highlights

**M6 — Klippy Cloud**
- per-user durable agent (Cloudflare Agents or Restate/Temporal)
- schedules, cloud workers, sync

**M7 — the character**
- original character art, states, lip-sync

---

## 16. Open questions

- Runtime language: TypeScript (same as extension + Playwright) vs Rust?
- Keep agent-browser long-term or only for the prototype?
- Page map format: share agent-browser's `@eN` a11y snapshot format or own ids?
- iframes and shadow DOM in the page map and diff.
- Multi-tab: does the character follow you across tabs?
- Can the cloud brain drive the real Chrome when the runtime is offline? (No —
  then it only runs cloud workers and queues the rest.)
- Finnish + English voice from the start?
- Name/character design.

---

## Prior art / references

- capJavert/clippy — Clippy on every page (no AI)
- felixrieseberg/clippy — local LLM desktop app with 90s UI
- Microsoft Copilot Mode in Edge + Mico (Clippy easter egg)
- Gemini in Chrome auto browse; Claude in Chrome
- Perplexity Comet — sidecar assistant, background assistant, voice mode
- Opera Neon — Cards, Tasks, Neon Do
- Fellou — shadow workspace, Deep Action
- ChatGPT Atlas — shut down 9 Aug 2026, folded into ChatGPT Work
- Dia (The Browser Company, Atlassian) — skills, work memory
- nanobrowser/nanobrowser — open-source agent extension, own API keys / Ollama
- alibaba/page-agent — in-page JS agent, text DOM, MCP server
- vercel-labs/agent-browser — Rust CLI, a11y snapshots, `@eN` refs, CDP attach
- Playwright MCP Bridge extension / `--cdp-endpoint=chrome`
- lightpanda-io/browser — headless browser in Zig, CDP-compatible
- Agent Faces — talking face, local Whisper + Kokoro
- VIRA — local voice agent with Playwright tools
- Durable execution: Restate, Temporal, Inngest, Cloudflare Agents
