// WebSocket protocol between klippy-mcp (server, loopback only) and the extension (client).

export const PROTOCOL_VERSION = 1;
export const DEFAULT_BRIDGE_PORT = 17345;

export type ExtToBridge =
  | { type: 'hello'; token: string; protocol: number; version: string; extensionId: string }
  | { type: 'result'; id: number; ok: true; text: string }
  | { type: 'result'; id: number; ok: false; error: string }
  | { type: 'ping' };

export type BridgeToExt =
  | { type: 'welcome'; protocol: number; version: string }
  | { type: 'call'; id: number; tool: string; args: Record<string, unknown> }
  | { type: 'pong' };
