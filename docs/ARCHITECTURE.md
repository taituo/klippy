# Klippy architecture

Status: M0 implemented (Chrome extension + MCP bridge). This document describes what
exists now and where each planned piece plugs in.

```
 any agent (Claude Code, Codex, own harness, Ollama loop)
        │  MCP (stdio)
        ▼
 klippy-mcp ── single-file Node program, no runtime deps
        │  WebSocket on 127.0.0.1 only · token · chrome-extension:// origin only
        ▼
 Chrome extension (MV3) ────────────────────────────── the BODY
   service worker   tool router · GatePolicy · hands (chrome.debugger = CDP)
   content script   eyes (page map, diff, read_html) · overlay (closed shadow root)
```

The body never trusts the brain: every action goes through the body's `GatePolicy`
and, when needed, a confirmation the user answers on the page.

## Components

| Path | What it does |
|---|---|
| `src/eyes/` | Pure DOM code. Page map with stable ids, accessible names/roles, deterministic diff + settle, cleaned `read_html`, occlusion check, gate signals. Built twice: into the content script and as `dist/eyes.iife.js` for CDP injection (headless / VPS / workers). |
| `src/overlay/` | Closed shadow root host `<klippy-overlay>`, `pointer-events:none`. Layers: highlights (follow elements on scroll), ghost cursor (curved path, click ripple), character + speech bubble, confirm prompt (only trusted clicks count). |
| `src/shared/gate.ts` | `evaluateGate()`: deterministic rules. Model/classifier signals are monotonic — they can add a confirmation, never remove one. |
| `src/extension/background.ts` | Bridge client, tool router, one-action-at-a-time queue, change tracking around actions, navigation detection. |
| `src/extension/hands.ts` | `chrome.debugger` input: mouse path + click, `Input.insertText`, keys. Trusted events; the user's own mouse never moves. Detaches after 20 s idle. |
| `src/bridge/` | `klippy-mcp`: minimal MCP server (initialize, ping, tools/list, tools/call) + WebSocket server. |

## Tools (MCP)

`status`, `tabs`, `snapshot`, `read_html`, `point`, `highlight`, `clear_highlights`, `say`,
`click`, `type`, `press`, `scroll`, `navigate`.

Every acting tool returns:

```
clicked [4] button "Toggle save"
input: cdp

~ [3] button "Save"  +disabled
focus: [4] button "Toggle save"
```

- `input: cdp` = trusted input; `input: synthetic (untrusted; …)` = fallback (CDP blocked by
  policy, chrome:// page, another debugger attached).
- `no visible change` = the action did nothing visible. The model should try something else.
- A real navigation returns `url: A → B` and asks for a new snapshot.

## Page map

```
url: https://shop.test/
title: Shop
focused: [12]

[1] heading(1) "Shop"
[2] link "Second page" → /page2.html
[5] textbox "Your name" value="Ada"
[9] textbox "Password" value="••••" password
[14] button "Far down button" (offscreen)
```

- Ids live in a `WeakMap`/`WeakRef` registry: stable while the node lives.
- Included: interactive elements, headings, live regions (dialog, alert, status…),
  text blocks. Skipped: `display:none`, `visibility:hidden`, `aria-hidden`, `hidden`, `inert`,
  the overlay. Open shadow roots are walked; iframes are not (yet).
- Passwords are never revealed, in the map or in `read_html`.

## Diff

`beginChange()` takes a full map (cap 3000) → action → `settle()` (no DOM mutations for
300 ms, max 3 s) → second map → `diffMaps()`:

- same id → field changes (`name`, `value`, `href`, `role`, `+state`/`-state`)
- removed + added with the same fingerprint (`role|name|tag#ordinal`) → treated as a
  re-render: reported as a change `(was [old id])`, not as add/remove
- URL, title and focus changes
- output capped at 40 lines

## GatePolicy (M0 rules)

| Rule | Category |
|---|---|
| typing into password / `cc-*` / `one-time-code` fields | credentials / payment / 2fa |
| submitting a form with a password / payment field / file | credentials / payment / send |
| submitting a POST form | submit |
| pressing Enter in a textarea / contenteditable (chat boxes often send on Enter) | send |
| GET (search) forms | allowed |
| clicking something named buy, pay, checkout, place order, subscribe, send, post, publish, delete, remove, transfer… (EN) or osta, maksa, tilaa, lähetä, julkaise, poista, siirrä… (FI stems) | purchase / send / delete / transfer |
| `<a download>` | download |
| navigation to anything but http(s) | blocked |

Planned (from the research): per-task origin scope, taint tracking (data read on origin A
must not be written to origin B without confirmation), classifier signals as a stricter
second opinion, audit log.

## Security model

- The bridge listens on `127.0.0.1` only, requires a token (timing-safe compare) and a
  `chrome-extension://` origin — web pages that try `ws://127.0.0.1:17345` are refused.
  `KLIPPY_EXTENSION_IDS` pins allowed extension ids.
- Token: `KLIPPY_TOKEN`, `--token`, or generated at `~/.config/klippy/token` (mode 600).
- Confirm buttons live in a closed shadow root and ignore untrusted events, so page
  scripts cannot approve actions. A denial is final for that call.
- `chrome.debugger` instead of a remote-debugging port: nothing else on the machine can
  drive the user's logged-in browser through Klippy.
- Page content is data, never instructions (stated in the MCP server instructions).

## Planned modes

| Mode | Eyes | Hands | Face | Status |
|---|---|---|---|---|
| **Chrome extension** | content script | `chrome.debugger` | overlay + (later) voice | **M0 done** |
| Local runtime + Playwright | `eyes.iife.js` via CDP | Playwright `connectOverCDP` | overlay injected | planned |
| VPS headless Chrome | `eyes.iife.js` via CDP | Playwright | voice + screenshots with overlay + live view (CDP screencast) | planned |
| Workers | `eyes.iife.js` | Lightpanda (read-only tasks) / headless Chrome | worker badges | planned |
| Klippy Cloud | same | Cloudflare Browser Run / Kernel | — | later |

The eyes bundle is plain DOM code on purpose: the same diff and page map work in every mode.

### Pure-browser extras (planned)

- **BYOK:** keys in `chrome.storage.local`, calls from the service worker to Anthropic /
  OpenAI / OpenRouter / Gemini, or Ollama on localhost (may need `OLLAMA_ORIGINS`).
- **WebGPU/WASM in an offscreen document:** WebLLM (small models for short commands),
  Whisper via transformers.js (Finnish works), Piper via sherpa-onnx WASM (Finnish voice
  `fi_FI-harri`; Kokoro has no Finnish).
- **Native messaging** instead of WebSocket for production: no open port at all.
- **Remote relay:** extension opens an outbound WebSocket to a relay (e.g. a Cloudflare
  Durable Object) that exposes a remote MCP endpoint → control from a phone.

### Classifier layer (planned, M1–M2)

System One decision models (Jev-compatible API: Cloudflare Clef / Clef-flash, Perplexity
Decider, Microsoft Decision-1…) as a fast signal layer **inside the body**:

- page state (login wall, captcha, error, cookie banner, paywall, payment form, confirmation)
- voice intent routing (simple intents directly, big LLM only for `other`)
- success check on top of the deterministic diff (empty diff = `no_effect` without a model)
- action–goal critic that sees only action metadata, never raw page text

Rules decide gates; classifiers can only make them stricter. Pin model versions/hashes,
log every decision, and build a FI/EN eval set before any model touches a gate.

### Driver abstraction (planned)

```ts
interface BodyDriver {
  attach(): Promise<void>;
  act(input: Input): Promise<void>;     // click / type / key
  screenshot(): Promise<Uint8Array>;
  capabilities(): { trustedInput: boolean; screenshots: boolean };
}
// ChromeDebuggerDriver (now) · PlaywrightCdpDriver · BidiDriver (Firefox) · SyntheticDomDriver (fallback)
```

## Browser tiers

| Tier | Browsers |
|---|---|
| 1 | Chrome, Edge (watch enterprise policies that block `chrome.debugger`), Brave |
| 2 | Comet, Dia, Opera/Neon, Vivaldi (test), Firefox via WebDriver BiDi |
| 3 | Safari (`safaridriver --mcp` for dev only) |
| workers | Lightpanda 1.0 (text-only reads), headless Chrome, cloud browsers |

## Known limitations (M0)

- Top frame only; iframes and closed shadow roots are invisible.
- Clickable `div`s without role, tabindex or `onclick` attribute are not detected.
- Chrome shows "Klippy started debugging this browser" while attached (auto-detach after 20 s idle).
- Gate word lists are heuristics (EN + FI) and will have false positives, e.g. "Remove filter".
- Not yet tested with browser zoom ≠ 100 % or on high-DPI multi-monitor setups.
- `@types/chrome` is not used yet (APIs are typed as `any` in three files).
