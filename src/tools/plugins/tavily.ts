import { TavilySearch } from '@langchain/tavily';
import { z } from 'zod';

import { BaseTool } from '../base.js';
import { registerTool } from '../registry.js';

/**
 * Tavily 搜索工具 - 基于 BaseTool 的 LangChain 标准实现
 */
@registerTool()
export class TavilySearchTool extends BaseTool {
  readonly name = 'tavily';

  readonly description =
    'Tavily 搜索工具，用于搜索互联网上的最新信息。适用于查找新闻、实时数据、最新事件等问题。';

  readonly paramsSchema = z.object({
    query: z.string().describe('搜索查询关键词'),
  });

  private tavily: TavilySearch;

  constructor() {
    super();
    this.tavily = new TavilySearch({
      maxResults: 5,
    });
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const { query } = params as { query: string };

    if (!query || query.trim().length === 0) {
      throw new Error('Search query cannot be empty');
    }

    // 检查 API 密钥是否配置
    if (!process.env.TAVILY_API_KEY) {
      throw new Error(
        'Tavily API key not configured. Please set TAVILY_API_KEY environment variable'
      );
    }

    try {
      const results = await this.tavily.invoke({ query }) as {
        results?: Array<{ title?: string; content?: string; url?: string }>;
      } | Array<{ title?: string; content?: string; url?: string }>;

      // 处理不同格式的返回结果
      const resultsArray: Array<{ title?: string; content?: string; url?: string }> =
        this.parseResults(results);

      if (!resultsArray || resultsArray.length === 0) {
        return '未找到相关搜索结果';
      }

      const formattedResults = resultsArray
        .map(
          (
            result: { title?: string; content?: string; url?: string },
            index: number
          ) =>
            `${index + 1}. **${result.title || '无标题'}**\n   ${result.content || '无内容'}\n   来源: ${result.url || '未知'}`
        )
        .join('\n\n');

      return `搜索结果:\n\n${formattedResults}`;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('API key')) {
          throw new Error(
            'Tavily API key not configured. Please set TAVILY_API_KEY environment variable'
          );
        }
        throw new Error(`Tavily search failed: ${error.message}`);
      }
      throw new Error('Tavily search failed: Unknown error');
    }
  }

  /**
   * 解析 Tavily 返回结果
   */
  private parseResults(
    results: unknown
  ): Array<{ title?: string; content?: string; url?: string }> {
    if (Array.isArray(results)) {
      return results as Array<{ title?: string; content?: string; url?: string }>;
    }

    if (results && typeof results === 'object' && 'results' in results) {
      const typedResults = results as { results: Array<{ title?: string; content?: string; url?: string }> };
      return typedResults.results;
    }

    return [];
  }
}