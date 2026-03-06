import { trimMessages } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';

import type { TokenStatus } from '../../types/agent.js';

/**
 * 判断字符是否为中日韩表意文字或全角标点
 */
function isCJK(char: string): boolean {
  const cp = char.codePointAt(0) ?? 0;
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK 统一汉字
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK 扩展 A
    (cp >= 0x20000 && cp <= 0x2a6df) || // CJK 扩展 B
    (cp >= 0x3000 && cp <= 0x303f) || // CJK 符号和标点
    (cp >= 0xff00 && cp <= 0xffef) // 全角字符
  );
}

/**
 * 快速估算单段文本的 token 数量
 * - 中文字符（含全角标点）：1 字 ≈ 1 token
 * - 其余字符（英文、数字、空格等）：4 字符 ≈ 1 token
 */
export function estimateTokenCount(text: string): number {
  let cjkCount = 0;
  let otherCount = 0;
  for (const char of text) {
    if (isCJK(char)) {
      cjkCount++;
    } else {
      otherCount++;
    }
  }
  return cjkCount + Math.ceil(otherCount / 4);
}

/**
 * 将 BaseMessage[] 转换为 token 计数（供 trimMessages 的 tokenCounter 使用）
 */
function countMessagesTokens(messages: BaseMessage[]): number {
  return messages.reduce((sum, msg) => {
    const content =
      typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content);
    return sum + estimateTokenCount(content);
  }, 0);
}

/**
 * 创建基于 trimMessages 的 token 裁剪器 Runnable
 */
export function createTrimmer({ maxTokens }: { maxTokens: number }) {
  return trimMessages({
    maxTokens,
    strategy: 'last',
    tokenCounter: countMessagesTokens,
    includeSystem: true,
    allowPartial: false,
    startOn: 'human',
  });
}

/**
 * 获取消息列表的 token 状态
 */
export function getTokenStatus(
  messages: BaseMessage[],
  limit: number,
  threshold = 0.8
): TokenStatus {
  const total = countMessagesTokens(messages);
  const percentage = total / limit;
  return {
    total,
    limit,
    percentage,
    exceeded: total > limit,
    nearThreshold: percentage >= threshold,
  };
}

/**
 * Token 预检：超限时自动裁剪历史，否则原样返回
 */
export async function runTokenPreflight(
  messages: BaseMessage[],
  maxTokens: number
): Promise<BaseMessage[]> {
  const status = getTokenStatus(messages, maxTokens);
  if (status.exceeded) {
    const trimmer = createTrimmer({ maxTokens });
    return trimmer.invoke(messages);
  }
  return messages;
}
