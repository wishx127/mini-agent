import { z } from 'zod';

/**
 * LangChain 格式的工具定义
 */
export interface LangChainToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<
        string,
        {
          type: string;
          description: string;
          enum?: string[];
        }
      >;
      required: string[];
    };
  };
}

/**
 * 工具调用结果
 */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * 工具基类 - 所有工具都应该继承此类
 *
 * 提供特性：
 * - 基于 zod 的参数验证
 * - 自动生成 LangChain 格式的工具定义
 * - 支持启用/禁用状态
 */
export abstract class BaseTool {
  /**
   * 工具名称
   */
  abstract readonly name: string;

  /**
   * 工具描述
   */
  abstract readonly description: string;

  /**
   * 工具参数 schema（使用 zod 定义）
   */
  abstract readonly paramsSchema: z.ZodType<Record<string, unknown>>;

  /**
   * 是否启用
   */
  protected _enabled: boolean = true;

  /**
   * 获取工具是否启用
   */
  get enabled(): boolean {
    return this._enabled;
  }

  /**
   * 设置工具启用状态
   */
  set enabled(value: boolean) {
    this._enabled = value;
  }

  /**
   * 执行工具逻辑（子类必须实现）
   */
  abstract execute(params: Record<string, unknown>): Promise<string>;

  /**
   * 验证参数并执行
   */
  async run(params: Record<string, unknown>): Promise<string> {
    if (!this._enabled) {
      throw new Error(`Tool '${this.name}' is disabled`);
    }

    // 使用 zod 验证参数
    const validatedParams = this.paramsSchema.parse(params);
    return this.execute(validatedParams);
  }

  /**
   * 将工具转换为 LangChain 格式
   */
  toLangChainTool(): LangChainToolDefinition {
    const schema = this.paramsSchema;
    const properties: Record<
      string,
      { type: string; description: string; enum?: string[] }
    > = {};
    const required: string[] = [];

    // 从 zod schema 提取参数信息
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape;
      for (const [key, value] of Object.entries(shape)) {
        const schemaValue = value as z.ZodTypeAny;
        const { required: isRequired } = this.unwrapZodType(schemaValue);
        const paramInfo = this.zodTypeToLangChainProperty(schemaValue);
        properties[key] = paramInfo;
        if (isRequired) {
          required.push(key);
        }
      }
    }

    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: 'object',
          properties,
          required,
        },
      },
    };
  }

  /**
   * 展开 zod 类型，处理 ZodOptional 和 ZodDefault
   */
  private unwrapZodType(schema: z.ZodTypeAny): {
    schema: z.ZodTypeAny;
    required: boolean;
  } {
    let required = true;
    let current = schema;

    while (
      current instanceof z.ZodOptional ||
      current instanceof z.ZodDefault
    ) {
      if (current instanceof z.ZodOptional) {
        required = false;
        const def = current._def as unknown as { innerType?: z.ZodTypeAny };
        current = def.innerType ?? current;
      } else if (current instanceof z.ZodDefault) {
        const def = current._def as unknown as { innerType?: z.ZodTypeAny };
        current = def.innerType ?? current;
      }
    }

    return { schema: current, required };
  }

  /**
   * 将 zod 类型转换为 LangChain 属性
   */
  private zodTypeToLangChainProperty(schema: z.ZodTypeAny): {
    type: string;
    description: string;
    enum?: string[];
  } {
    const { schema: unwrapped } = this.unwrapZodType(schema);
    let type = 'string';
    let description = '';
    let enumValues: string[] | undefined;

    if (unwrapped instanceof z.ZodString) {
      type = 'string';
      description = this.extractDescription(unwrapped) || '字符串参数';
    } else if (unwrapped instanceof z.ZodNumber) {
      type = 'number';
      description = this.extractDescription(unwrapped) || '数字参数';
    } else if (unwrapped instanceof z.ZodBoolean) {
      type = 'boolean';
      description = this.extractDescription(unwrapped) || '布尔值参数';
    } else if (unwrapped instanceof z.ZodEnum) {
      type = 'string';
      enumValues = unwrapped.options as string[];
      description = this.extractDescription(unwrapped) || '枚举值参数';
    } else if (unwrapped instanceof z.ZodObject) {
      type = 'object';
      description = this.extractDescription(unwrapped) || '对象参数';
    }

    return { type, description, enum: enumValues };
  }

  /**
   * 从 zod schema 提取描述
   */
  private extractDescription(schema: z.ZodTypeAny): string {
    if ('description' in schema && typeof schema.description === 'string') {
      return schema.description;
    }
    if ('_def' in schema && 'description' in schema._def) {
      return (schema._def.description as string) || '';
    }
    return '';
  }
}

// zod 类型导出，方便工具使用
export { z };

/**
 * 工具注册表类 - 管理所有 BaseTool 工具
 */
export class ToolRegistry {
  private tools: Map<string, BaseTool> = new Map();

  /**
   * 注册 BaseTool 实例
   */
  registerTool(tool: BaseTool): void {
    if (!tool.name || !tool.description) {
      throw new Error('Tool must have name and description');
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * 批量注册 BaseTool
   */
  registerTools(tools: BaseTool[]): void {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  /**
   * 获取所有已注册的工具
   */
  getTools(): BaseTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 获取所有已启用的工具
   */
  getEnabledTools(): BaseTool[] {
    return this.getTools().filter((tool) => tool.enabled);
  }

  /**
   * 启用工具
   */
  enableTool(name: string): void {
    const tool = this.tools.get(name);
    if (tool) {
      tool.enabled = true;
    }
  }

  /**
   * 禁用工具
   */
  disableTool(name: string): void {
    const tool = this.tools.get(name);
    if (tool) {
      tool.enabled = false;
    }
  }

  /**
   * 按名称获取工具
   */
  getTool(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  /**
   * 执行工具
   */
  async executeTool(
    name: string,
    params: Record<string, unknown>
  ): Promise<string> {
    const tool = this.tools.get(name);

    if (!tool) {
      throw new Error(`Tool '${name}' not found`);
    }

    if (!tool.enabled) {
      throw new Error(`Tool '${name}' is disabled`);
    }

    try {
      return await tool.run(params);
    } catch (error) {
      throw new Error(
        `Tool '${name}' execution failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * 获取 LangChain 格式的工具定义（已启用）
   */
  getLangChainTools(): LangChainToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((tool) => tool.enabled)
      .map((tool) => tool.toLangChainTool());
  }

  /**
   * 清空所有工具
   */
  clear(): void {
    this.tools.clear();
  }
}
