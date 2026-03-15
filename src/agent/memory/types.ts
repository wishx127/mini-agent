/**
 * Token 使用量
 */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

/**
 * 成本记录（cost 固定为 0，成本计算暂不实现）
 */
export interface CostRecord {
  usage: TokenUsage;
  model?: string;
  timestamp: number;
  cost: number;
  inputCost?: number;
  outputCost?: number;
  currency?: string;
}

/**
 * 成本汇总（totalCost 固定为 0）
 */
export interface CostSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  totalInputCost: number;
  totalOutputCost: number;
  currency: string;
  requestCount: number;
}
