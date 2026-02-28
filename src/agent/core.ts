import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';

import { ModelConfig } from '../types/model-config.js';

/**
 * Agent核心类
 */
export class AgentCore {
  private llm: ChatOpenAI;
  private config: ModelConfig;

  constructor(config: ModelConfig) {
    this.config = config;
    this.llm = this.initializeLLM();
  }

  /**
   * 初始化LLM模型实例
   */
  private initializeLLM(): ChatOpenAI {
    return new ChatOpenAI({
      model: this.config.modelName,
      temperature: this.config.temperature ?? 0.7,
      maxTokens: this.config.maxTokens ?? 2048,
      configuration: {
        baseURL: this.config.baseUrl,
        ...(this.config.apiKey && { apiKey: this.config.apiKey }),
      },
    });
  }

  /**
   * 处理用户提示
   */
  async processPrompt(prompt: string): Promise<string> {
    try {
      if (!prompt || prompt.trim().length === 0) {
        throw new Error('输入不能为空');
      }

      const response = await this.callLLM(prompt.trim());
      return response;
    } catch (error) {
      console.error('处理提示时出错:', error);
      throw new Error(
        `处理请求失败: ${error instanceof Error ? error.message : '未知错误'}`
      );
    }
  }

  /**
   * 调用LLM模型
   */
  private async callLLM(prompt: string): Promise<string> {
    try {
      const message = new HumanMessage(prompt);
      const response = await this.llm.invoke([message]);

      if (response && typeof response.content === 'string') {
        return response.content;
      } else {
        throw new Error('模型响应格式不正确');
      }
    } catch (error) {
      if (error instanceof Error) {
        if (
          error.message.includes('network') ||
          error.message.includes('connection')
        ) {
          throw new Error('无法连接到模型服务，请检查网络连接和配置');
        } else if (
          error.message.includes('401') ||
          error.message.includes('unauthorized')
        ) {
          throw new Error('API认证失败，请检查API密钥配置');
        } else if (
          error.message.includes('404') ||
          error.message.includes('not found')
        ) {
          throw new Error('模型不存在或baseURL配置错误');
        } else if (
          error.message.includes('429') ||
          error.message.includes('rate limit')
        ) {
          throw new Error('请求频率超限，请稍后重试');
        }
      }
      throw new Error(
        `模型调用失败: ${error instanceof Error ? error.message : '未知错误'}`
      );
    }
  }

  /**
   * 格式化响应输出
   */
  formatResponse(response: string): string {
    // 简单的响应格式化，可以根据需要扩展
    return response.trim();
  }
}
