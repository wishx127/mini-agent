import type { UsageMetadata } from '@langchain/core/messages';

import { calculateCost, type LLMUsage } from '../../observability/index.js';

import type { CostRecord, CostSummary } from './types.js';

/**
 * CostTracker - 从 LLM 响应的 usageMetadata 读取并累计 token 消耗和成本
 * 需要在项目根目录创建 pricing.json 配置文件
 */
export class CostTracker {
  private records: CostRecord[] = [];

  constructor() {}

  record(usageMetadata: UsageMetadata | undefined, model?: string): void {
    if (!usageMetadata) return;

    const usage: LLMUsage = {
      inputTokens: usageMetadata.input_tokens ?? 0,
      outputTokens: usageMetadata.output_tokens ?? 0,
      totalTokens: usageMetadata.total_tokens ?? 0,
    };

    const costCalculation = model
      ? calculateCost(usage, model)
      : { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' };

    this.records.push({
      usage: {
        input_tokens: usageMetadata.input_tokens,
        output_tokens: usageMetadata.output_tokens,
        total_tokens: usageMetadata.total_tokens,
      },
      model,
      timestamp: Date.now(),
      cost: costCalculation.totalCost,
      inputCost: costCalculation.inputCost,
      outputCost: costCalculation.outputCost,
      currency: costCalculation.currency,
    });
  }

  getSummary(): CostSummary {
    if (this.records.length === 0) {
      return {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        totalInputCost: 0,
        totalOutputCost: 0,
        currency: 'USD',
        requestCount: 0,
      };
    }

    const firstCurrency = this.records[0].currency || 'USD';

    return this.records.reduce(
      (acc, r) => ({
        totalInputTokens: acc.totalInputTokens + r.usage.input_tokens,
        totalOutputTokens: acc.totalOutputTokens + r.usage.output_tokens,
        totalTokens: acc.totalTokens + r.usage.total_tokens,
        totalCost: acc.totalCost + (r.cost || 0),
        totalInputCost: acc.totalInputCost + (r.inputCost || 0),
        totalOutputCost: acc.totalOutputCost + (r.outputCost || 0),
        currency: r.currency || firstCurrency,
        requestCount: acc.requestCount + 1,
      }),
      {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        totalInputCost: 0,
        totalOutputCost: 0,
        currency: firstCurrency,
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
