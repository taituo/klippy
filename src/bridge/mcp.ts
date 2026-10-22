// Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0).
// Implements what tool-only servers need: initialize, ping, tools/list, tools/call.
import { createInterface } from 'node:readline';
import type { ToolDef } from '../shared/tools';

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export interface ToolResult {
  text: string;
  isError?: boolean;
}

export interface McpServerOptions {
  name: string;
  version: string;
  instructions?: string;
  tools: ToolDef[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
  log: (...args: unknown[]) => void;
}

type JsonRpcId = string | number;
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export function serveStdio(opts: McpServerOptions): Promise<void> {
  const out = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + '\n');
  const reply = (id: JsonRpcId, result: unknown) => out({ jsonrpc: '2.0', id, result });
  const fail = (id: JsonRpcId | null, code: number, message: string) => out({ jsonrpc: '2.0', id, error: { code, message } });

  const handle = async (req: JsonRpcRequest) => {
    const { id, method, params = {} } = req;
    const isNotification = id === undefined;
    switch (method) {
      case 'initialize': {
        const asked = String(params.protocolVersion ?? '');
        const protocolVersion = SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0];
        if (!isNotification)
          reply(id, {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: opts.name, version: opts.version },
            ...(opts.instructions ? { instructions: opts.instructions } : {}),
          });
        return;
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return;
      case 'ping':
        if (!isNotification) reply(id, {});
        return;
      case 'tools/list':
        if (!isNotification) reply(id, { tools: opts.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
        return;
      case 'tools/call': {
        if (isNotification) return;
        const name = String(params.name ?? '');
        const args = (params.arguments ?? {}) as Record<string, unknown>;
        if (!opts.tools.some((t) => t.name === name)) {
          fail(id, -32602, `Unknown tool: ${name}`);
          return;
        }
        try {
          const r = await opts.callTool(name, args);
          reply(id, { content: [{ type: 'text', text: r.text }], isError: !!r.isError });
        } catch (e) {
          reply(id, { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true });
        }
        return;
      }
      default:
        if (!isNotification) fail(id, -32601, `Method not found: ${method}`);
    }
  };

  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      let req: JsonRpcRequest;
      try {
        req = JSON.parse(line);
      } catch {
        fail(null, -32700, 'Parse error');
        return;
      }
      if (Array.isArray(req)) {
        fail(null, -32600, 'Batching is not supported');
        return;
      }
      handle(req).catch((e) => opts.log('mcp handler error', e));
    });
    rl.on('close', () => resolve());
  });
}
