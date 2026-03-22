import type { ObservabilityClient } from './langfuse-client.js';
import type { PromptTemplate, LangfusePromptClient } from './types.js';

export const SYSTEM_PROMPTS: PromptTemplate[] = [
  {
    name: 'agent-system',
    content: `你是一个智能助手，使用工具来回答需要实时信息的问题。

重要规则：
1. 只回复与用户问题直接相关的内容
2. 尽力回答用户的问题，即使没有完整信息也要提供有帮助的回应
3. 如果确实无法回答，可以说明原因或提供替代建议，但不要简单说"我不清楚"
4. 不要伪造或编造任何信息
5. 绝对不要回复"任务完成"、"处理完成"等元信息
6. 保持回答简洁、直接、有帮助`,
    labels: ['system', 'agent'],
  },
  {
    name: 'planner-decision',
    content: `你是一个智能助手，可以决定是否使用工具来回答用户问题。

可用工具:
{{tool_descriptions}}

重要规则：
1. 如果用户的问题需要实时信息或外部数据，请使用合适的工具
2. 如果问题可以直接回答，请不要使用工具
3. 只回复与用户问题直接相关的内容
4. 不要回复"任务完成"、"处理完成"等元信息
5. 尽力回答用户的问题，即使没有完整信息也要提供有帮助的回应
6. 如果确实无法回答，可以说明原因或提供替代建议，但不要简单说"我不清楚"`,
    labels: ['planner', 'decision'],
  },
];

export class PromptManager {
  private client: ObservabilityClient;
  private registeredPrompts: Map<string, PromptTemplate> = new Map();
  private promptCache: Map<
    string,
    { content: string; version: string; timestamp: number }
  > = new Map();
  private cacheTTL: number = 5 * 60 * 1000;
  private defaultLabel: string | undefined;

  constructor(client: ObservabilityClient) {
    this.client = client;
    const envLabel = process.env.LANGFUSE_PROMPT_LABEL?.trim();
    this.defaultLabel = envLabel && envLabel.length > 0 ? envLabel : undefined;
    for (const template of SYSTEM_PROMPTS) {
      this.registeredPrompts.set(template.name, {
        ...template,
        version: 'local',
      });
    }
  }

  async registerPrompt(template: PromptTemplate): Promise<string | null> {
    if (!this.client.isEnabled()) {
      return null;
    }

    const langfuseClient = this.client.getClient();

    if (!langfuseClient) {
      return null;
    }

    const langfuse = langfuseClient as unknown as LangfusePromptClient;

    try {
      const prompt = await langfuse.createPrompt({
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

  async fetchPrompt(
    name: string,
    label?: string
  ): Promise<PromptTemplate | null> {
    if (!this.client.isEnabled()) {
      return this.registeredPrompts.get(name) ?? null;
    }

    const resolvedLabel = label ?? this.defaultLabel;
    const cacheKey = `${name}:${resolvedLabel ?? 'default'}`;
    const cached = this.promptCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return {
        name,
        content: cached.content,
        version: cached.version,
      };
    }

    const langfuseClient = this.client.getClient();

    if (!langfuseClient) {
      return this.registeredPrompts.get(name) ?? null;
    }

    const langfuse = langfuseClient as unknown as LangfusePromptClient;

    try {
      const langfusePrompt = resolvedLabel
        ? await langfuse.prompt.get(name, { label: resolvedLabel })
        : await langfuse.prompt.get(name, {});

      if (!langfusePrompt) {
        return this.registeredPrompts.get(name) ?? null;
      }

      const versionString = String(langfusePrompt.version);

      this.promptCache.set(cacheKey, {
        content: langfusePrompt.prompt,
        version: versionString,
        timestamp: Date.now(),
      });

      return {
        name,
        content: langfusePrompt.prompt,
        version: versionString,
      };
    } catch (error) {
      // 如果 label 不存在，尝试不带 label 获取默认版本
      if (resolvedLabel) {
        try {
          const fallbackKey = `${name}:default`;
          const fallbackCached = this.promptCache.get(fallbackKey);
          if (
            fallbackCached &&
            Date.now() - fallbackCached.timestamp < this.cacheTTL
          ) {
            return {
              name,
              content: fallbackCached.content,
              version: fallbackCached.version,
            };
          }

          const fallbackPrompt = await langfuse.prompt.get(name, {});
          if (fallbackPrompt) {
            const fallbackVersion = String(fallbackPrompt.version);
            this.promptCache.set(fallbackKey, {
              content: fallbackPrompt.prompt,
              version: fallbackVersion,
              timestamp: Date.now(),
            });
            return {
              name,
              content: fallbackPrompt.prompt,
              version: fallbackVersion,
            };
          }
        } catch {
          // 忽略 fallback 错误，继续降级到本地
        }
      }

      console.warn(
        `📊 [Prompt] 获取 Prompt 失败: ${name} (label: ${resolvedLabel ?? 'default'})`,
        error instanceof Error ? error.message : '未知错误'
      );
      return this.registeredPrompts.get(name) ?? null;
    }
  }

  async getCompiledPrompt(
    name: string,
    variables: Record<string, string> = {},
    label?: string
  ): Promise<{ content: string; version: string } | null> {
    const promptTemplate = await this.fetchPrompt(name, label);

    if (!promptTemplate) {
      return null;
    }

    const version = promptTemplate.version ?? 'unknown';
    let content = promptTemplate.content;

    for (const [key, value] of Object.entries(variables)) {
      content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }

    return {
      content,
      version,
    };
  }

  clearCache(): void {
    this.promptCache.clear();
  }

  setCacheTTL(ttl: number): void {
    this.cacheTTL = ttl;
  }
}
