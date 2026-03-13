import type {
  LongTermMemoryConfig,
  MemorySearchResult,
  MemoryType,
} from '../../types/memory.js';
import { DEFAULT_LONG_TERM_MEMORY_CONFIG } from '../../types/memory.js';

import { VectorDatabaseClient } from './vector-database-client.js';

/**
 * LongTermMemoryReader - 仅负责检索与格式化（不做提取与存储）
 */
export class LongTermMemoryReader {
  private dbClient: VectorDatabaseClient;
  private config: LongTermMemoryConfig;

  constructor(
    dbClient: VectorDatabaseClient,
    config?: Partial<LongTermMemoryConfig>
  ) {
    this.dbClient = dbClient;
    this.config = { ...DEFAULT_LONG_TERM_MEMORY_CONFIG, ...config };
  }

  async initialize(): Promise<boolean> {
    return this.dbClient.initialize();
  }

  shutdown(): void {
    this.dbClient.disconnect();
  }

  async search(query: string, topK?: number): Promise<MemorySearchResult[]> {
    if (!this.config.enabled || !this.dbClient.isAvailable()) {
      return [];
    }

    const k = topK || this.config.topK;
    const embedding = await this.dbClient.generateEmbedding(query);
    if (!embedding) {
      return [];
    }

    const results = await this.dbClient.searchSimilar(embedding, k);
    if (results.length > 0) {
      for (const result of results) {
        await this.dbClient.updateAccessRecord(result.memory.id);
      }
    }
    return results;
  }

  formatMemoriesForPrompt(results: MemorySearchResult[]): string {
    if (results.length === 0) {
      return '';
    }

    const lines = ['以下是可能与当前对话相关的历史记忆：'];
    for (let i = 0; i < results.length; i++) {
      const { memory, similarity } = results[i];
      const typeLabel = this.getTypeLabel(memory.type);
      lines.push(
        `${i + 1}. [${typeLabel}] ${memory.content} (相关度: ${(similarity * 100).toFixed(0)}%)`
      );
    }

    return lines.join('\\n');
  }

  private getTypeLabel(type: MemoryType): string {
    const labels: Record<MemoryType, string> = {
      user_preference: '用户偏好',
      fact: '事实',
      experience: '经验',
      task: '任务',
      context: '上下文',
    };
    return labels[type] || type;
  }
}
