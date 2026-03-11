import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface MemoryJobPayload {
  userMessage: string;
  aiResponse: string;
  sessionId?: string;
}

export interface MemoryJobRecord extends MemoryJobPayload {
  id: string;
  createdAt: string;
  attempts?: number;
  nextAttemptAt?: string;
}

export interface MemoryJob extends MemoryJobRecord {
  path: string;
}

export class MemoryJobQueue {
  private queueDir: string;
  private failedDir: string;

  constructor(queueDir?: string) {
    const baseDir =
      queueDir || path.join(process.cwd(), '.mini-agent', 'memory-queue');
    this.queueDir = baseDir;
    this.failedDir = path.join(baseDir, 'failed');
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.queueDir, { recursive: true });
    await fs.mkdir(this.failedDir, { recursive: true });
  }

  async enqueue(payload: MemoryJobPayload): Promise<string> {
    await this.initialize();
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const fileName = `${Date.now()}-${id}.json`;
    const filePath = path.join(this.queueDir, fileName);
    const data: MemoryJobRecord = { id, createdAt, attempts: 0, ...payload };
    await fs.writeFile(filePath, JSON.stringify(data), 'utf8');
    return id;
  }

  async take(limit: number): Promise<MemoryJob[]> {
    await this.initialize();
    const files = await this.listQueueFiles();
    const jobs: MemoryJob[] = [];
    const now = Date.now();

    for (const filePath of files) {
      if (jobs.length >= limit) {
        break;
      }
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as MemoryJobRecord;
        if (parsed.nextAttemptAt) {
          const nextAttemptMs = new Date(parsed.nextAttemptAt).getTime();
          if (Number.isFinite(nextAttemptMs) && nextAttemptMs > now) {
            continue;
          }
        }
        jobs.push({ ...parsed, path: filePath });
      } catch (error) {
        await this.moveToFailed(filePath, undefined, error);
      }
    }

    return jobs;
  }

  async ack(job: MemoryJob): Promise<void> {
    await fs.unlink(job.path).catch(() => undefined);
  }

  async retryOrFail(
    job: MemoryJob,
    error: unknown,
    maxAttempts: number,
    backoffMs: number
  ): Promise<void> {
    const attempts = (job.attempts ?? 0) + 1;
    if (attempts >= maxAttempts) {
      await this.moveToFailed(job.path, job, error);
      return;
    }

    const nextAttemptAt = new Date(
      Date.now() + backoffMs * attempts
    ).toISOString();
    const updated: MemoryJobRecord = {
      id: job.id,
      createdAt: job.createdAt,
      userMessage: job.userMessage,
      aiResponse: job.aiResponse,
      sessionId: job.sessionId,
      attempts,
      nextAttemptAt,
    };
    await fs.writeFile(job.path, JSON.stringify(updated), 'utf8');
  }

  private async listQueueFiles(): Promise<string[]> {
    const entries = await fs.readdir(this.queueDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(this.queueDir, entry.name))
      .sort();
  }

  private async moveToFailed(
    filePath: string,
    job: MemoryJobRecord | undefined,
    error: unknown
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const failedAt = new Date().toISOString();
    const raw = job
      ? JSON.stringify({ ...job, failedAt, error: errorMessage })
      : JSON.stringify({ failedAt, error: errorMessage, rawPath: filePath });
    const baseName = path.basename(filePath).replace(/\.json$/, '');
    const failedPath = path.join(this.failedDir, `${baseName}.failed.json`);

    await fs.writeFile(failedPath, raw, 'utf8').catch(() => undefined);
    await fs.unlink(filePath).catch(() => undefined);
  }
}
