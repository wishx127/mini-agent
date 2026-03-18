/**
 * 成本计算模块
 * 根据模型定价计算 LLM 调用成本
 *
 * 配置方式：在项目根目录创建 pricing.json 文件
 *
 * JSON 文件格式：
 * {
 *   "pricing": {
 *     "gpt-4o": { "inputCostPer1k": 0.0025, "outputCostPer1k": 0.01, "currency": "USD" },
 *     "claude-3-5-sonnet": { "inputCostPer1k": 0.003, "outputCostPer1k": 0.015, "currency": "USD" }
 *   },
 *   "defaultPricing": { "inputCostPer1k": 0.001, "outputCostPer1k": 0.002, "currency": "USD" }
 * }
 */
import fs from 'fs';
import path from 'path';

import type {
  ModelPricing,
  ModelPricingConfig,
  CostCalculation,
  LLMUsage,
} from './types.js';

let userPricingConfig: ModelPricingConfig | null = null;

let pricingKeysSorted: string[] = [];

const DEFAULT_PRICING: ModelPricing = {
  inputCostPer1k: 0.005,
  outputCostPer1k: 0.01,
  currency: 'USD',
};

function loadPricingConfig(): void {
  const configPath = 'pricing.json';

  const resolvedPath = path.isAbsolute(configPath)
    ? configPath
    : path.resolve(process.cwd(), configPath);

  if (!fs.existsSync(resolvedPath)) {
    return;
  }

  const fileContent = fs.readFileSync(resolvedPath, 'utf-8');

  let config: unknown;
  try {
    config = JSON.parse(fileContent);
  } catch {
    return;
  }

  if (typeof config !== 'object' || config === null) {
    return;
  }

  const parsedConfig = config as Record<string, unknown>;

  if (!parsedConfig.pricing || typeof parsedConfig.pricing !== 'object') {
    return;
  }

  const pricingObj = parsedConfig.pricing as Record<string, unknown>;
  const pricingValues = Object.values(pricingObj);
  for (const pricing of pricingValues) {
    if (typeof pricing !== 'object' || pricing === null) {
      return;
    }

    const p = pricing as Record<string, unknown>;
    if (
      typeof p.inputCostPer1k !== 'number' ||
      typeof p.outputCostPer1k !== 'number' ||
      typeof p.currency !== 'string'
    ) {
      return;
    }
  }

  const finalConfig: ModelPricingConfig = {
    pricing: pricingObj as unknown as Record<string, ModelPricing>,
  };

  if (parsedConfig.defaultPricing) {
    const dp = parsedConfig.defaultPricing;
    if (typeof dp === 'object' && dp !== null) {
      const defaultPricing = dp as Record<string, unknown>;
      if (
        typeof defaultPricing.inputCostPer1k === 'number' &&
        typeof defaultPricing.outputCostPer1k === 'number' &&
        typeof defaultPricing.currency === 'string'
      ) {
        finalConfig.defaultPricing = defaultPricing as unknown as ModelPricing;
      }
    }
  }

  userPricingConfig = finalConfig;
  pricingKeysSorted = Object.keys(finalConfig.pricing).sort(
    (a, b) => b.length - a.length
  );
}

loadPricingConfig();

export function hasPricingConfig(): boolean {
  return userPricingConfig !== null;
}

export function getPricingConfig(): ModelPricingConfig | null {
  return userPricingConfig;
}

export function calculateCost(
  usage: LLMUsage,
  modelName: string
): CostCalculation {
  const pricing = getModelPricing(modelName);

  const inputCost = (usage.inputTokens / 1000) * pricing.inputCostPer1k;
  const outputCost = (usage.outputTokens / 1000) * pricing.outputCostPer1k;
  const totalCost = inputCost + outputCost;

  return {
    inputCost: Math.round(inputCost * 1000000) / 1000000,
    outputCost: Math.round(outputCost * 1000000) / 1000000,
    totalCost: Math.round(totalCost * 1000000) / 1000000,
    currency: pricing.currency,
  };
}

export function getModelPricing(modelName: string): ModelPricing {
  const normalizedName = modelName.toLowerCase();

  if (!userPricingConfig) {
    return DEFAULT_PRICING;
  }

  for (const key of pricingKeysSorted) {
    if (normalizedName.includes(key.toLowerCase())) {
      return userPricingConfig.pricing[key];
    }
  }

  return userPricingConfig.defaultPricing || DEFAULT_PRICING;
}

export function formatCost(cost: CostCalculation): string {
  const currencySymbol = cost.currency === 'CNY' ? '¥' : '$';
  return `${currencySymbol}${cost.totalCost.toFixed(6)}`;
}
