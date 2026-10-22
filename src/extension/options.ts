// Options page: bridge port + token, live connection status.
import { DEFAULT_BRIDGE_PORT } from '../shared/bridge-protocol';

declare const chrome: any;

const port = document.getElementById('port') as HTMLInputElement;
const token = document.getElementById('token') as HTMLInputElement;
const status = document.getElementById('status') as HTMLDivElement;

async function load() {
  const s = await chrome.storage.local.get(['bridgePort', 'bridgeToken', 'bridgeStatus']);
  port.value = String(s.bridgePort ?? DEFAULT_BRIDGE_PORT);
  token.value = s.bridgeToken ?? '';
  status.textContent = `Status: ${s.bridgeStatus ?? 'unknown'}`;
}

document.getElementById('save')!.addEventListener('click', async () => {
  const p = Number(port.value) || DEFAULT_BRIDGE_PORT;
  await chrome.storage.local.set({ bridgePort: p, bridgeToken: token.value.trim() });
  status.textContent = 'Status: connecting…';
});

chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, area: string) => {
  if (area === 'local' && changes.bridgeStatus) status.textContent = `Status: ${String(changes.bridgeStatus.newValue)}`;
});

load();
