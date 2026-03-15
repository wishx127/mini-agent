import type { Langfuse } from 'langfuse';

import type { ObservabilityClient } from './langfuse-client.js';
import type { PromptTemplate } from './types.js';

export const SYSTEM_PROMPTS: PromptTemplate[] = [
  {
    name: 'agent-system',
    content: '你是一个智能助手，使用工具来回答需要实时信息的问题。',
    labels: ['system', 'agent'],
  },
  {
    name: 'planner-decision',
    content: `你是一个智能助手，可以决定是否使用工具来回答用户问题。

可用工具:
{{tool_descriptions}}

如果用户的问题需要实时信息或外部数据，请使用合适的工具。
如果问题可以直接回答，请不要使用工具。`,
    labels: ['planner', 'decision'],
  },
];

export class PromptManager {
  private client: ObservabilityClient;
  private registeredPrompts: Map<string, PromptTemplate> = new Map();

  constructor(client: ObservabilityClient) {
    this.client = client;
  }

  async registerPrompt(template: PromptTemplate): Promise<string | null> {
    if (!this.client.isEnabled()) {
      return null;
    }

    const langfuseClient = this.client.getClient() as Langfuse;

    try {
      const prompt = await langfuseClient.createPrompt({
        name: template.name,
        prompt: template.content,
        labels: template.labels,
        config: {
          model: 'default',
        },
      });

      const versionString = String(prompt.version);
      this.registeredPrompts.set(template.name, {
        ...template,
        version: versionString,
      });

      return versionString;
    } catch (error) {
      console.warn(
        `📊 [Prompt] 注册 Prompt 失败: ${template.name}`,
        error instanceof Error ? error.message : '未知错误'
      );
      return null;
    }
  }

  async registerSystemPrompts(): Promise<void> {
    if (!this.client.isEnabled()) {
      return;
    }

    for (const template of SYSTEM_PROMPTS) {
      await this.registerPrompt(template);
    }
  }

  getPrompt(name: string): PromptTemplate | undefined {
    return this.registeredPrompts.get(name);
  }

  getPromptVersion(name: string): string | undefined {
    return this.registeredPrompts.get(name)?.version;
  }

  hasPrompt(name: string): boolean {
    return this.registeredPrompts.has(name);
  }

  getAllPrompts(): PromptTemplate[] {
    return Array.from(this.registeredPrompts.values());
  }
}
