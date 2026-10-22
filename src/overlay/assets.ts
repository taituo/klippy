// Overlay styles and artwork. The character is an original design (a small round
// "spark" with an antenna), deliberately not based on any existing assistant character.

export const SPRITE_SVG = `
<svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
  <defs>
    <radialGradient id="kb" cx="38%" cy="32%" r="70%">
      <stop offset="0" stop-color="#b9a6ff"/>
      <stop offset="1" stop-color="#6a4cf0"/>
    </radialGradient>
  </defs>
  <line x1="32" y1="14" x2="38" y2="5" stroke="#6a4cf0" stroke-width="3" stroke-linecap="round"/>
  <circle class="ant" cx="39" cy="4" r="3.5" fill="#ffcf4a"/>
  <rect x="10" y="14" width="44" height="40" rx="20" fill="url(#kb)"/>
  <g class="eyes">
    <ellipse cx="25" cy="33" rx="4" ry="5.5" fill="#fff"/>
    <ellipse cx="39" cy="33" rx="4" ry="5.5" fill="#fff"/>
    <circle cx="26" cy="34" r="2.2" fill="#1d1640"/>
    <circle cx="40" cy="34" r="2.2" fill="#1d1640"/>
  </g>
  <path d="M27 44 q5 4 10 0" stroke="#1d1640" stroke-width="2" fill="none" stroke-linecap="round"/>
</svg>`;

export const CURSOR_SVG = `
<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
  <path d="M3 2 L3 19 L8 14.5 L11.5 22 L14.5 20.7 L11 13.3 L18 13.3 Z" fill="#6a4cf0" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
</svg>`;

export const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; }
.layer { position: fixed; inset: 0; pointer-events: none; }
.box {
  position: fixed; left: 0; top: 0; border: 2px solid #6a4cf0; border-radius: 8px;
  background: rgba(106, 76, 240, 0.10); box-shadow: 0 0 0 4px rgba(106, 76, 240, 0.15);
  transition: transform 60ms linear;
}
.label {
  position: absolute; left: -2px; top: -22px; padding: 2px 6px; border-radius: 6px 6px 6px 0;
  background: #6a4cf0; color: #fff; font: 600 11px/16px system-ui, sans-serif; white-space: nowrap;
}
.num {
  position: absolute; right: -9px; bottom: -9px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px;
  background: #6a4cf0; color: #fff; font: 700 11px/18px system-ui, sans-serif; text-align: center;
  box-shadow: 0 0 0 2px #fff;
}
.cursor { position: fixed; left: 0; top: 0; will-change: transform; filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
.cursor svg { display: block; }
.cursor .tag {
  position: absolute; left: 16px; top: 20px; padding: 1px 6px; border-radius: 6px; background: #6a4cf0; color: #fff;
  font: 600 10px/15px system-ui, sans-serif;
}
.ripple {
  position: fixed; left: -14px; top: -14px; width: 28px; height: 28px; border-radius: 50%;
  border: 2px solid #6a4cf0; animation: ripple 550ms ease-out forwards;
}
@keyframes ripple { from { opacity: .9; scale: .3; } to { opacity: 0; scale: 1.6; } }
.char { }
.character { position: fixed; right: 18px; bottom: 14px; width: 56px; height: 56px; filter: drop-shadow(0 4px 8px rgba(0,0,0,.25)); }
.character .eyes { animation: blink 5s infinite; transform-origin: 32px 33px; }
.character.thinking .ant { animation: pulse 900ms ease-in-out infinite; }
.character.working { animation: bob 700ms ease-in-out infinite; }
@keyframes blink { 0%, 96%, 100% { transform: scaleY(1); } 98% { transform: scaleY(0.1); } }
@keyframes pulse { 50% { fill: #ff8a3d; } }
@keyframes bob { 50% { translate: 0 -3px; } }
.bubble {
  position: fixed; right: 84px; bottom: 30px; max-width: min(360px, 70vw); padding: 10px 12px; border-radius: 14px 14px 4px 14px;
  background: #fff; color: #1d1640; font: 14px/1.4 system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.18);
  border: 1px solid rgba(106, 76, 240, .25);
}
.bubble[hidden], .cursor[hidden] { display: none; }
.bubble.confirm { pointer-events: auto; }
.bubble .q { margin-bottom: 8px; }
.bubble .row { display: flex; gap: 8px; justify-content: flex-end; }
.bubble button {
  all: unset; cursor: pointer; padding: 5px 12px; border-radius: 8px; font: 600 13px/18px system-ui, sans-serif;
}
.bubble .allow { background: #6a4cf0; color: #fff; }
.bubble .deny { background: #eeeaff; color: #3b2b8f; }
@media (prefers-color-scheme: dark) {
  .bubble { background: #221b45; color: #f1edff; border-color: rgba(185,166,255,.3); }
  .bubble .deny { background: #3b2f73; color: #f1edff; }
}
`;
