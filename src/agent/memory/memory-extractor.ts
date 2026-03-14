import { ChatOpenAI } from '@langchain/openai';

import type {
  MemoryExtractionResult,
  ExtractedMemory,
  MemoryType,
} from '../../types/memory.js';

/**
 * 提取器配置
 */
export interface MemoryExtractorConfig {
  /** 置信度阈值 */
  confidenceThreshold: number;
  /** 单次最大提取数量 */
  maxExtractionsPerTurn: number;
  /** 提取 prompt 模板 */
  extractionPrompt?: string;
}

const DEFAULT_EXTRACTOR_CONFIG: MemoryExtractorConfig = {
  confidenceThreshold: 0.7,
  maxExtractionsPerTurn: 3,
};

/**
 * MemoryExtractor - LLM 驱动的记忆提取器
 *
 * 职责：
 * - 从对话中提取潜在的记忆
 * - 结构化输出
 * - 置信度过滤
 * - 内容标准化
 */
export class MemoryExtractor {
  private llm: ChatOpenAI;
  private config: MemoryExtractorConfig;

  constructor(llm: ChatOpenAI, config?: Partial<MemoryExtractorConfig>) {
    this.llm = llm;
    this.config = { ...DEFAULT_EXTRACTOR_CONFIG, ...config };
  }

  /**
   * 从对话中提取记忆
   */
  async extract(
    userMessage: string,
    aiResponse: string
  ): Promise<MemoryExtractionResult> {
    try {
      // 构建提取 prompt
      const prompt = this.buildExtractionPrompt(userMessage, aiResponse);

      // 调用 LLM 进行提取
      const response = await this.llm.invoke(prompt);

      // 解析响应
      const content =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);

      const parsed = this.parseExtractionResult(content);

      if (!parsed) {
        return {
          memories: [],
          success: false,
          error: '无法解析提取结果',
        };
      }

      // 过滤和标准化
      const filtered = this.filterAndNormalize(parsed.memories);

      return {
        memories: filtered,
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      console.error('❌ [MemoryExtractor] 提取失败:', errorMessage);
      return {
        memories: [],
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 构建提取 prompt
   */
  private buildExtractionPrompt(
    userMessage: string,
    aiResponse: string
  ): string {
    const basePrompt =
      this.config.extractionPrompt ||
      `你是一个记忆提取专家。你的任务是从对话中提取值得长期记住的信息。

提取规则：
1. 只提取重要的、可能在未来有用的信息
2. 忽略临时性的问候、闲聊
3. 关注用户偏好、重要事实、关键经验
4. 记忆内容使用第三人称标准化描述（如"用户喜欢 TypeScript"而非"我喜欢 TypeScript"）
5. 为每条记忆给出置信度（0-1），只有置信度 >= 0.7 的记忆才会被保存
6. 最多提取 3 条最重要的记忆

记忆类型说明：
- user_preference: 用户的偏好和倾向
- fact: 客观事实信息
- experience: 用户分享的经验或经历
- task: 任务相关信息
- context: 有用的上下文信息

请以 JSON 格式输出，格式如下：
{
  "memories": [
    {
      "type": "user_preference",
      "content": "用户偏好 TypeScript 胜过 JavaScript",
      "confidence": 0.9,
      "reasoning": "用户明确表达了对 TypeScript 的偏好"
    }
  ]
}`;

    return `${basePrompt}

---

用户消息：
${userMessage}

AI 回复：
${aiResponse}

---

请提取值得记住的信息（JSON 格式）：`;
  }

  /**
   * 解析提取结果
   */
  private parseExtractionResult(
    content: string
  ): { memories: ExtractedMemory[] } | null {
    try {
      // 尝试直接解析
      const parsed = JSON.parse(content) as { memories: ExtractedMemory[] };
      if (parsed.memories && Array.isArray(parsed.memories)) {
        return parsed;
      }
    } catch {
      // 尝试提取 JSON 块
      const jsonMatch = content.match(/\{[\s\S]*"memories"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as {
            memories: ExtractedMemory[];
          };
          if (parsed.memories && Array.isArray(parsed.memories)) {
            return parsed;
          }
        } catch {
          // 继续尝试其他方法
        }
      }
    }
    return null;
  }

  /**
   * 过滤和标准化记忆
   */
  private filterAndNormalize(memories: ExtractedMemory[]): ExtractedMemory[] {
    return memories
      .filter((m) => this.validateMemory(m))
      .filter((m) => m.confidence >= this.config.confidenceThreshold)
      .map((m) => this.normalizeMemory(m))
      .slice(0, this.config.maxExtractionsPerTurn);
  }

  /**
   * 验证记忆格式
   */
  private validateMemory(memory: ExtractedMemory): boolean {
    const validTypes: MemoryType[] = [
      'user_preference',
      'fact',
      'experience',
      'task',
      'context',
    ];

    return (
      validTypes.includes(memory.type) &&
      typeof memory.content === 'string' &&
      memory.content.length > 0 &&
      typeof memory.confidence === 'number' &&
      memory.confidence >= 0 &&
      memory.confidence <= 1
    );
  }

  /**
   * 标准化记忆内容
   */
  private normalizeMemory(memory: ExtractedMemory): ExtractedMemory {
    let content = memory.content.trim();
    const originalContent = content;

    // 转换第一称为第三称（支持中英文）
    content = content
      .replace(/我喜欢/g, '用户喜欢')
      .replace(/我想要/g, '用户想要')
      .replace(/我需要/g, '用户需要')
      .replace(/我使用/g, '用户使用')
      .replace(/我是/g, '用户是')
      .replace(/我有/g, '用户有')
      .replace(/我会/g, '用户会')
      .replace(/我的/g, '用户的')
      .replace(/I like/gi, 'User likes')
      .replace(/I want/gi, 'User wants')
      .replace(/I need/gi, 'User needs')
      .replace(/I use/gi, 'User uses')
      .replace(/I am/gi, 'User is')
      .replace(/I have/gi, 'User has')
      .replace(/I will/gi, 'User will')
      .replace(/my /gi, "user's ");

    // 确保以大写字母开头（英文）
    if (content.length > 0 && content[0] === content[0].toLowerCase()) {
      content = content[0].toUpperCase() + content.slice(1);
    }

    if (originalContent !== content) {
      console.log(`🔄 [MemoryExtractor] 第一人称转换完成`);
    }

    return {
      ...memory,
      content,
    };
  }
}
