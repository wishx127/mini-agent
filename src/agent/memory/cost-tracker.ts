import type { UsageMetadata } from '@langchain/core/messages';

import type { CostRecord, CostSummary } from './types.js';

/**
 * CostTracker - 从 LLM 响应的 usageMetadata 读取并累计 token 消耗
 * 成本单价换算暂不实现，totalCost 固定为 0
 */
export class CostTracker {
  private records: CostRecord[] = [];

  constructor() {}

  record(usageMetadata: UsageMetadata | undefined, model?: string): void {
    if (!usageMetadata) return;
    this.records.push({
      usage: {
        input_tokens: usageMetadata.input_tokens,
        output_tokens: usageMetadata.output_tokens,
        total_tokens: usageMetadata.total_tokens,
      },
      model,
      timestamp: Date.now(),
      cost: 0,
    });
  }

  getSummary(): CostSummary {
    if (this.records.length === 0) {
      return {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        requestCount: 0,
      };
    }
    return this.records.reduce(
      (acc, r) => ({
        totalInputTokens: acc.totalInputTokens + r.usage.input_tokens,
        totalOutputTokens: acc.totalOutputTokens + r.usage.output_tokens,
        totalTokens: acc.totalTokens + r.usage.total_tokens,
        totalCost: 0,
        requestCount: acc.requestCount + 1,
      }),
      {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        requestCount: 0,
      }
    );
  }

  getRecords(): CostRecord[] {
    return [...this.records];
  }

  getRecentRecords(n: number): CostRecord[] {
    if (n <= 0) return [];
    return this.records.slice(-n);
  }

  reset(): void {
    this.records = [];
  }
}
