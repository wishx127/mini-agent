import { InMemoryChatMessageHistory } from '@langchain/core/chat_history';
import type { BaseChatMessageHistory } from '@langchain/core/chat_history';

/**
 * SessionStore - 管理每个 sessionId 的 InMemoryChatMessageHistory 实例
 */
export class SessionStore {
  private store = new Map<string, InMemoryChatMessageHistory>();

  getOrCreate(sessionId: string): BaseChatMessageHistory {
    if (!this.store.has(sessionId)) {
      this.store.set(sessionId, new InMemoryChatMessageHistory());
    }
    return this.store.get(sessionId)!;
  }

  async clear(sessionId: string): Promise<void> {
    const history = this.store.get(sessionId);
    if (history) {
      await history.clear();
    }
  }

  delete(sessionId: string): void {
    this.store.delete(sessionId);
  }

  getAllSessionIds(): string[] {
    return Array.from(this.store.keys());
  }
}
