// Minimal MCP stdio client for tests.
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface CallResult {
  text: string;
  isError: boolean;
}

export class McpClient {
  private proc: ChildProcess;
  private nextId = 1;
  private pending = new Map<number, (msg: any) => void>();
  readonly stderr: string[] = [];

  constructor(command: string, args: string[], env: Record<string, string>) {
    this.proc = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    createInterface({ input: this.proc.stdout! }).on('line', (line) => {
      const msg = JSON.parse(line);
      const cb = this.pending.get(msg.id);
      if (cb) {
        this.pending.delete(msg.id);
        cb(msg);
      }
    });
    createInterface({ input: this.proc.stderr! }).on('line', (l) => this.stderr.push(l));
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
      this.proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async initialize(): Promise<any> {
    const r = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'klippy-test', version: '0' } });
    this.proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return r;
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<CallResult> {
    const r = await this.request('tools/call', { name, arguments: args });
    return { text: r.content.map((c: { text: string }) => c.text).join('\n'), isError: !!r.isError };
  }

  close(): void {
    this.proc.stdin!.end();
    this.proc.kill();
  }
}
