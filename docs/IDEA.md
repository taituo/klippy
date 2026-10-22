# Klippy — design idea

A Clippy-style assistant that lives on every page you visit in your real Chrome.
You talk to it, it answers out loud, and it acts on the page with its own
visible cursor. The browser side is a thin "body" (eyes, hands, face, voice);
the "brain" is a pluggable agent harness with durable state that can run
locally or in the cloud.

Status: M0 implemented — see [ARCHITECTURE.md](ARCHITECTURE.md) for what exists today.

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
  extension (content-script mic means per-site permission prompts). In the
  pure-extension mode the mic lives in an offscreen document.
- **STT, Finnish**: Whisper large-v3 or the Finnish-NLP fine-tune (whisper.cpp /
  MLX). Whisper is clearly more accurate in Finnish than Parakeet v3.
- **STT, English**: Parakeet-TDT-0.6B-v3 (MLX) — much faster, slightly better WER.
- **TTS, Finnish**: Piper `fi_FI-harri` (check the voice's license); VoxCPM2 for
  quality if it is fast enough live. **Kokoro has no Finnish** — English only.
- **TTS, English**: Kokoro.
- Barge-in: pressing the hotkey while Klippy speaks stops TTS (trivial with PTT).
- Expected end-to-end latency locally ~1.5–3 s (estimate, to be measured).
- Fast intent routing with a classifier (see ARCHITECTURE.md) so simple commands
  (`scroll`, `back`, `click 12`, `stop`, `confirm`) skip the big LLM.
- Cloud mode can optionally use a realtime voice model.

---

## 13. Local models

- Ollama / MLX as the default local backend (OpenAI-compatible API), any
  OpenAI-compatible endpoint or BYOK cloud model works.
- Text page map instead of screenshots — small models handle text much better.
- Candidates on an M5 Pro class Mac: Qwen3.6-35B-A3B (fast MoE), Qwen3.8-27B,
  Gemma 4 27B. No reliable public browser-agent benchmark for local models
  exists yet → build our own 20–50 task eval (with vs. without the diff).
- Realistic expectations: short 1–5 step commands on known pages work locally;
  long open-ended chores need a cloud model. Hybrid by default.

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

Revised after the October 2026 research: the page map, diff, MCP and safety gates
are the core value, so they come before voice.

| Phase | Content | Status |
|---|---|---|
| **M0** | Extension, closed-shadow overlay (ghost cursor, highlights, bubble, simple sprite), page map, deterministic diff, `read_html`, `chrome.debugger` hands + synthetic fallback, deterministic GatePolicy with on-page confirmation, `klippy-mcp` bridge, tests | **done** |
| M1 | Eval set (20–50 tasks, FI/EN, local vs cloud, diff vs no diff), `ClassifierLayer` (Clef-flash local) for page state + success check, audit log, iframes | next |
| M2 | Per-task origin scope + taint tracking, native messaging, BYOK in the extension, WebMCP tools behind the same gates, `BodyDriver` abstraction + Playwright driver | |
| M3 | Voice (PTT; Whisper/Parakeet; Piper/Kokoro) + local durable loop (SQLite journal, approvals, schedules) | |
| M4 | Anchored notes (W3C selectors), trail, Cards, Tasks | |
| M5 | VPS headless mode (voice + screenshots + live view/take-over), cookie-less workers (headless Chrome; Lightpanda for read-only), worker badges | |
| M6 | Klippy Cloud (Cloudflare Agents + Browser Run + Clef), Teams pilot | only if M2–M4 get users |
| M7 | Full character animation and persona | |

---

## 16. Open questions

- Bridge language: M0 bridge is TypeScript (single file, no deps). Port to Rust
  later (native messaging host + MCP) or keep TS?
- agent-browser: not used in M0 (own page map + `chrome.debugger`); keep it as a
  dev/worker tool and as a benchmark for the eyes.
- Page map format: own ids for now; compare token cost with agent-browser's `@eN`.
- iframes (M1) and closed shadow roots (not reachable from a content script).
- Multi-tab: does the character follow you across tabs?
- Can the cloud brain drive the real Chrome when the runtime is offline? (No —
  then it only runs cloud workers and queues the rest.)
- Finnish + English voice from the start? (Plan: yes — Whisper/Piper for FI.)
- Name/character design (M0 has a simple original sprite).
- License (open core: MIT/Apache-2.0 for the body? something else?).

---

## 17. Research notes (October 2026)

Two deep-research passes (in the conversation that started this repo) changed a few
assumptions:

- **Extension, not a browser.** OpenAI shut down ChatGPT Atlas on 9 Aug 2026
  (folded into ChatGPT Work + a Chrome extension); Microsoft retired Edge Copilot
  Mode in May 2026; Comet and Opera Neon became free. The fight is inside Chrome
  (Gemini auto browse, Claude in Chrome).
- **Closest open-source neighbour: alibaba/page-agent** (MIT, in-page agent,
  text DOM, overlay, BYO LLM, MCP). Nobody combines an on-page character + ghost
  cursor + local voice + BYO brain.
- **Remote debugging:** Chrome 136+ blocks `--remote-debugging-port` on the
  default profile; Chrome 144+ has a per-session toggle at
  `chrome://inspect/#remote-debugging`. Klippy uses `chrome.debugger` instead and
  never asks users to open port 9222. Edge 154+ policies can block
  `chrome.debugger.attach()` → synthetic fallback (implemented, labelled untrusted).
- **Security:** BioShocking (LayerX, June 2026) tricked six agentic browsers into
  leaking credentials; prompt injection detectors either over-flag or miss new
  attacks. Hence: deterministic gates in the body, classifiers only as a stricter
  second opinion, origin scope + taint tracking next.
- **Classifiers:** System One decision models (Jev; Cloudflare Clef / Clef-flash,
  open weights; Perplexity Decider; Microsoft Decision-1) share one API format →
  one client. Good for page state, intent routing and success checks; not for
  deciding gates alone (Jev was broken by prompt injection in every configuration
  in Check Point's test).
- **Browsers:** Chromium family is tier 1; Firefox via WebDriver BiDi tier 2;
  Safari tier 3 (`safaridriver --mcp`, isolated sessions). Lightpanda 1.0 is a good
  read-only worker (no rendering → no screenshots). Cloudflare Kitesurf for
  stateless cloud reads.
- **Agent traffic:** Cloudflare blocks the "Agent" category on ad-supported sites
  by default since 15 Sep 2026. Extension mode acts as the user in their own
  browser; VPS/cloud modes must identify themselves (Web Bot Auth) and hand
  CAPTCHAs to the user.
- **Business:** agentic browsing is becoming a free add-on; standalone "AI browser
  for $20/mo" is weakening. Most defensible: an open, model-neutral body + MCP;
  paid value later in sync, schedules, Teams (shared page notes, Cards, audit).

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
