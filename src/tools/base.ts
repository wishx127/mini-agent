import { z } from 'zod';

import { CircuitBreaker } from './circuit-breaker.js';
import { ToolCategoryRegistry } from './category-registry.js';

/**
 * 工具分类常量（运行时可访问的值）
 */
export const ToolCategories = {
  INTERNAL: 'INTERNAL',
  EXTERNAL_API: 'EXTERNAL_API',
  FILE_SYSTEM: 'FILE_SYSTEM',
  VECTOR_SEARCH: 'VECTOR_SEARCH',
  SANDBOX: 'SANDBOX',
  UNCATEGORIZED: 'UNCATEGORIZED',
} as const;

/**
 * 工具分类类型（从常量中提取）
 */
export type ToolCategories =
  (typeof ToolCategories)[keyof typeof ToolCategories];

/**
 * 分类配置接口（预留权限控制扩展）
 */
export interface CategoryConfig {
  /**
   * 分类标识
   */
  category: ToolCategories;
  /**
   * 预留字段：访问此分类工具所需的角色权限
   */
  roles?: string[];
}

/**
 * 工具分类类型（支持单分类、多分类或详细配置）
 */
export type ToolCategory =
  | ToolCategories
  | ToolCategories[]
  | CategoryConfig
  | undefined;

/**
 * 重试配置接口
 */
export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/**
 * JSON Schema 参数定义
 */
export interface JSONSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  description?: string;
  enum?: unknown[];
  items?: JSONSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  additionalProperties?: boolean | JSONSchema;
  oneOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  allOf?: JSONSchema[];
  [key: string]: unknown;
}

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
   * 工具分类（可选）
   */
  readonly category?: ToolCategory;

  /**
   * 工具超时时间（毫秒，可选）
   */
  readonly timeout?: number;

  /**
   * 重试配置（可选）
   */
  readonly retryConfig?: RetryConfig;

  /**
   * JSON Schema 参数定义（可选，与 Zod 二选一）
   */
  readonly jsonSchema?: JSONSchema;

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

  /**
   * 验证参数（支持 Zod 和 JSON Schema）
   */
  validateParams(params: Record<string, unknown>): {
    valid: boolean;
    error?: string;
  } {
    // 优先使用 JSON Schema
    if (this.jsonSchema) {
      return this.validateWithJSONSchema(params);
    }

    // 使用 Zod 验证
    try {
      this.paramsSchema.parse(params);
      return { valid: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : '参数验证失败';
      return { valid: false, error: message };
    }
  }

  /**
   * 使用 JSON Schema 验证参数
   */
  private validateWithJSONSchema(params: Record<string, unknown>): {
    valid: boolean;
    error?: string;
  } {
    if (!this.jsonSchema) {
      return { valid: true };
    }

    const errors: string[] = [];

    // 验证必需参数
    if (this.jsonSchema.required) {
      for (const required of this.jsonSchema.required) {
        if (!(required in params) || params[required] === undefined) {
          errors.push(`缺少必需参数: ${required}`);
        }
      }
    }

    // 验证属性类型和约束
    if (this.jsonSchema.properties) {
      for (const [key, value] of Object.entries(params)) {
        const schema = this.jsonSchema.properties[key] as
          | JSONSchema
          | undefined;
        if (schema && typeof schema === 'object') {
          const validationError = this.validateValue(key, value, schema);
          if (validationError) {
            errors.push(validationError);
          }
        }
      }
    }

    if (errors.length > 0) {
      return { valid: false, error: errors.join('; ') };
    }

    return { valid: true };
  }

  /**
   * 验证单个值
   */
  private validateValue(
    key: string,
    value: unknown,
    schema: JSONSchema
  ): string | null {
    if (schema.type) {
      const actualType = typeof value;
      const expectedType = schema.type;

      if (expectedType === 'string' && actualType !== 'string') {
        return `参数 ${key} 必须是字符串`;
      }
      if (expectedType === 'number' && actualType !== 'number') {
        return `参数 ${key} 必须是数字`;
      }
      if (expectedType === 'boolean' && actualType !== 'boolean') {
        return `参数 ${key} 必须是布尔值`;
      }
      if (
        expectedType === 'object' &&
        (actualType !== 'object' || value === null)
      ) {
        return `参数 ${key} 必须是对象`;
      }
      if (expectedType === 'array' && !Array.isArray(value)) {
        return `参数 ${key} 必须是数组`;
      }
    }

    // 验证约束
    if (
      schema.minimum !== undefined &&
      typeof value === 'number' &&
      value < schema.minimum
    ) {
      return `参数 ${key} 必须大于等于 ${schema.minimum}`;
    }
    if (
      schema.maximum !== undefined &&
      typeof value === 'number' &&
      value > schema.maximum
    ) {
      return `参数 ${key} 必须小于等于 ${schema.maximum}`;
    }
    if (
      schema.minLength !== undefined &&
      typeof value === 'string' &&
      value.length < schema.minLength
    ) {
      return `参数 ${key} 长度必须大于等于 ${schema.minLength}`;
    }
    if (
      schema.maxLength !== undefined &&
      typeof value === 'string' &&
      value.length > schema.maxLength
    ) {
      return `参数 ${key} 长度必须小于等于 ${schema.maxLength}`;
    }
    if (schema.pattern !== undefined && typeof value === 'string') {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(value)) {
        return `参数 ${key} 格式不正确`;
      }
    }
    if (schema.enum !== undefined) {
      if (!schema.enum.includes(value)) {
        return `参数 ${key} 必须是允许的值之一: ${schema.enum.join(', ')}`;
      }
    }

    return null;
  }

  /**
   * 获取 OpenAI 格式的工具定义
   * 优先使用 JSON Schema，如果没有则从 Zod 转换
   */
  getToolDefinition(): LangChainToolDefinition {
    // 优先使用 JSON Schema
    if (this.jsonSchema) {
      return {
        type: 'function',
        function: {
          name: this.name,
          description: this.description,
          parameters: this
            .jsonSchema as LangChainToolDefinition['function']['parameters'],
        },
      };
    }

    // 回退到 Zod
    return this.toLangChainTool();
  }

  /**
   * 获取 Anthropic 格式的工具定义
   */
  getAnthropicToolDefinition(): {
    name: string;
    description: string;
    input_schema: JSONSchema;
  } {
    // 优先使用 JSON Schema
    const schema = this.jsonSchema || this.zodToJSONSchema(this.paramsSchema);

    return {
      name: this.name,
      description: this.description,
      input_schema: schema,
    };
  }

  /**
   * 将 Zod schema 转换为 JSON Schema
   */
  private zodToJSONSchema(
    schema: z.ZodType<Record<string, unknown>>
  ): JSONSchema {
    const result: JSONSchema = {
      type: 'object',
      properties: {},
    };

    if (schema instanceof z.ZodObject) {
      const shape = schema.shape;
      for (const [key, value] of Object.entries(shape)) {
        const schemaValue = value as z.ZodTypeAny;
        const { required } = this.unwrapZodType(schemaValue);
        const propSchema = this.zodTypeToJSONSchema(schemaValue);

        if (result.properties) {
          result.properties[key] = propSchema;
        }

        if (required) {
          result.required = result.required || [];
          result.required.push(key);
        }
      }
    }

    return result;
  }

  /**
   * 将 Zod 类型转换为 JSON Schema
   */
  private zodTypeToJSONSchema(schema: z.ZodTypeAny): JSONSchema {
    const { schema: unwrapped } = this.unwrapZodType(schema);
    const result: JSONSchema = {};

    if (unwrapped instanceof z.ZodString) {
      result.type = 'string';
      result.description = this.extractDescription(unwrapped) || '字符串参数';
    } else if (unwrapped instanceof z.ZodNumber) {
      result.type = 'number';
      result.description = this.extractDescription(unwrapped) || '数字参数';
    } else if (unwrapped instanceof z.ZodBoolean) {
      result.type = 'boolean';
      result.description = this.extractDescription(unwrapped) || '布尔值参数';
    } else if (unwrapped instanceof z.ZodEnum) {
      result.type = 'string';
      result.enum = unwrapped.options as unknown[];
      result.description = this.extractDescription(unwrapped) || '枚举值参数';
    } else if (unwrapped instanceof z.ZodObject) {
      result.type = 'object';
      result.properties = {};
      const shape = unwrapped.shape;
      for (const [key, value] of Object.entries(shape)) {
        const propSchema = this.zodTypeToJSONSchema(value as z.ZodTypeAny);
        if (result.properties) {
          result.properties[key] = propSchema;
        }
      }
    } else if (unwrapped instanceof z.ZodArray) {
      result.type = 'array';
      const itemSchema = (unwrapped as z.ZodArray<z.ZodTypeAny>).element;
      result.items = this.zodTypeToJSONSchema(itemSchema);
    }

    return result;
  }
}

// zod 类型导出，方便工具使用
export { z };

/**
 * 工具注册表类 - 管理所有 BaseTool 工具
 */
export class ToolRegistry {
  private tools: Map<string, BaseTool> = new Map();
  private circuitBreakers: Map<
    string,
    import('./circuit-breaker.js').CircuitBreaker
  > = new Map();
  private categoryRegistry: import('./category-registry.js').ToolCategoryRegistry;
  private categoryCache: Map<string, BaseTool[]> = new Map();
  private cacheValid: boolean = false;

  constructor() {
    this.categoryRegistry = new ToolCategoryRegistry();
  }

  /**
   * 注册 BaseTool 实例
   */
  registerTool(tool: BaseTool): void {
    if (!tool.name || !tool.description) {
      throw new Error('Tool must have name and description');
    }
    this.tools.set(tool.name, tool);
    this.categoryRegistry.registerTool(tool);
    this.invalidateCache();
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
   * 使用 getToolDefinition() 支持 JSON Schema 和 Zod 双格式
   */
  getLangChainTools(): LangChainToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((tool) => tool.enabled)
      .map((tool) => tool.getToolDefinition());
  }

  /**
   * 清空所有工具
   */
  clear(): void {
    this.tools.clear();
    this.circuitBreakers.clear();
    this.categoryRegistry.clear();
    this.categoryCache.clear();
    this.cacheValid = false;
  }

  /**
   * 获取工具的熔断器（如果不存在则创建）
   */
  getToolBreaker(
    name: string,
    config?: Partial<import('./circuit-breaker.js').CircuitBreakerConfig>
  ): import('./circuit-breaker.js').CircuitBreaker {
    const existing = this.circuitBreakers.get(name);
    if (existing) {
      return existing;
    }

    const breaker = new CircuitBreaker(name, config);
    this.circuitBreakers.set(name, breaker);
    return breaker;
  }

  /**
   * 获取指定分类的工具
   */
  getToolsByCategory(category: ToolCategories | ToolCategories[]): BaseTool[] {
    // 使用缓存
    const cacheKey = Array.isArray(category)
      ? category.sort().join(',')
      : category;

    if (!this.cacheValid) {
      this.rebuildCategoryCache();
    }

    return this.categoryCache.get(cacheKey) || [];
  }

  /**
   * 使分类缓存失效
   */
  private invalidateCache(): void {
    this.cacheValid = false;
  }

  /**
   * 重建分类缓存
   */
  private rebuildCategoryCache(): void {
    this.categoryCache.clear();

    const allCategories: ToolCategories[] = [
      'INTERNAL',
      'EXTERNAL_API',
      'FILE_SYSTEM',
      'VECTOR_SEARCH',
      'SANDBOX',
      'UNCATEGORIZED',
    ];
    for (const category of allCategories) {
      const tools = this.categoryRegistry.getToolsByCategory(
        this.getTools(),
        category
      );
      const cacheKey = category;
      this.categoryCache.set(cacheKey, tools);
    }

    this.cacheValid = true;
  }

  /**
   * 重置工具的熔断器
   */
  resetToolBreaker(name: string): void {
    const breaker = this.circuitBreakers.get(name);
    if (breaker) {
      breaker.reset();
    }
  }

  /**
   * 获取所有熔断器
   */
  getAllBreakers(): Map<string, import('./circuit-breaker.js').CircuitBreaker> {
    return new Map(this.circuitBreakers);
  }

  /**
   * 获取工具分类注册表
   */
  getCategoryRegistry(): import('./category-registry.js').ToolCategoryRegistry {
    return this.categoryRegistry;
  }
}
