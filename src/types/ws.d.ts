// Minimal typings for the parts of `ws` the bridge uses (keeps @types/ws optional).
declare module 'ws' {
  import { EventEmitter } from 'node:events';

  export class WebSocket extends EventEmitter {
    send(data: string): void;
    close(code?: number, reason?: string): void;
    on(event: 'message', listener: (data: Buffer | string) => void): this;
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  export interface ServerOptions {
    host?: string;
    port?: number;
    maxPayload?: number;
    verifyClient?: (info: { origin?: string; secure: boolean; req: unknown }) => boolean;
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options: ServerOptions);
    close(): void;
    on(event: 'connection', listener: (socket: WebSocket) => void): this;
    on(event: 'listening', listener: () => void): this;
    on(event: 'error', listener: (err: NodeJS.ErrnoException) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }
}
