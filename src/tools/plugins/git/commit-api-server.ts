/**
 * CLI API 服务
 * 提供本地 HTTP API 供 IDE 扩展调用
 */

import http from 'http';

export interface CommitMessageRequest {
  message: string;
  files?: string[];
  all?: boolean;
}

export interface CommitMessageResponse {
  success: boolean;
  message?: string;
  error?: string;
}

interface PendingCommit {
  message: string;
  files?: string[];
  all?: boolean;
  timestamp: number;
}

const PENDING_COMMIT_KEY = 'pending_commit_message';
const DEFAULT_PORT = 7890;
const COMMIT_TIMEOUT_MS = 5 * 60 * 1000;

const pendingCommits = new Map<string, PendingCommit>();

export class CommitApiServer {
  private server: http.Server | null = null;
  private port: number;

  constructor(port: number = DEFAULT_PORT) {
    this.port = port;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        reject(new Error('Server already running'));
        return;
      }

      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (err) => {
        reject(err);
        this.server = null;
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  getPort(): number {
    return this.port;
  }

  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    const url = req.url?.trim();

    if (url === '/commit' || url === '/commit message') {
      this.handleCommitMessage(req, res);
    } else if (url === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', port: this.port }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  private handleCommitMessage(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    let body = '';

    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body) as CommitMessageRequest;

        if (!data.message || typeof data.message !== 'string') {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Invalid message' }));
          return;
        }

        const commitData: PendingCommit = {
          message: data.message,
          files: data.files,
          all: data.all,
          timestamp: Date.now(),
        };

        pendingCommits.set(PENDING_COMMIT_KEY, commitData);

        this.cleanupExpiredCommits();

        res.writeHead(200);
        res.end(
          JSON.stringify({
            success: true,
            message: 'Commit message received',
          })
        );
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
      }
    });
  }

  getPendingCommit(): PendingCommit | null {
    this.cleanupExpiredCommits();
    return pendingCommits.get(PENDING_COMMIT_KEY) || null;
  }

  clearPendingCommit(): void {
    pendingCommits.delete(PENDING_COMMIT_KEY);
  }

  private cleanupExpiredCommits(): void {
    const now = Date.now();
    for (const [key, value] of pendingCommits.entries()) {
      if (now - value.timestamp > COMMIT_TIMEOUT_MS) {
        pendingCommits.delete(key);
      }
    }
  }
}

export const commitApiServer = new CommitApiServer();

export function getPendingCommitMessage(): PendingCommit | null {
  return commitApiServer.getPendingCommit();
}

export function clearPendingCommitMessage(): void {
  commitApiServer.clearPendingCommit();
}
