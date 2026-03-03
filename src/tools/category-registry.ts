import { BaseTool, ToolCategories, ToolCategory } from './base.js';

/**
 * 分类注册表配置
 */
export interface CategoryRegistryConfig {
  /**
   * 默认分类（当工具未指定分类时使用）
   */
  defaultCategory: ToolCategories;
}

// 所有分类值列表
const ALL_CATEGORIES: ToolCategories[] = [
  'INTERNAL',
  'EXTERNAL_API',
  'FILE_SYSTEM',
  'VECTOR_SEARCH',
  'SANDBOX',
  'UNCATEGORIZED',
];

/**
 * 工具分类注册表 - 用于管理工具分类
 */
export class ToolCategoryRegistry {
  private categoryIndex: Map<ToolCategories, Set<string>> = new Map();
  private toolCategories: Map<string, readonly ToolCategories[]> = new Map();
  private readonly config: CategoryRegistryConfig;

  // 默认配置
  private static readonly DEFAULT_CONFIG: CategoryRegistryConfig = {
    defaultCategory: 'UNCATEGORIZED',
  };

  constructor(config?: Partial<CategoryRegistryConfig>) {
    this.config = {
      ...ToolCategoryRegistry.DEFAULT_CONFIG,
      ...config,
    };

    // 初始化所有分类索引
    this.initializeCategoryIndexes();
  }

  /**
   * 初始化所有分类索引
   */
  private initializeCategoryIndexes(): void {
    for (const category of ALL_CATEGORIES) {
      this.categoryIndex.set(category, new Set());
    }
  }

  /**
   * 注册工具到分类
   */
  registerTool(tool: BaseTool): void {
    const categories = this.resolveCategories(tool.category);
    this.toolCategories.set(tool.name, categories);

    // 将工具添加到各个分类索引
    for (const category of categories) {
      const index = this.categoryIndex.get(category);
      if (index) {
        index.add(tool.name);
      }
    }
  }

  /**
   * 移除工具的分类记录
   */
  unregisterTool(toolName: string): void {
    const categories = this.toolCategories.get(toolName);
    if (categories) {
      for (const category of categories) {
        const index = this.categoryIndex.get(category);
        if (index) {
          index.delete(toolName);
        }
      }
      this.toolCategories.delete(toolName);
    }
  }

  /**
   * 获取指定分类的所有工具名称
   */
  getToolNamesByCategory(category: ToolCategories): string[] {
    const index = this.categoryIndex.get(category);
    return index ? Array.from(index) : [];
  }

  /**
   * 获取指定分类的所有工具（支持多分类查询）
   */
  getToolsByCategory(
    tools: readonly BaseTool[],
    categories: ToolCategory
  ): BaseTool[] {
    const categorySet = this.toCategorySet(categories);
    const result: BaseTool[] = [];

    for (const tool of tools) {
      const toolCats = this.toolCategories.get(tool.name);
      if (toolCats) {
        // 检查工具是否属于任一指定分类
        for (const cat of toolCats) {
          if (categorySet.has(cat)) {
            result.push(tool);
            break;
          }
        }
      }
    }

    return result;
  }

  /**
   * 解析工具的分类（支持单分类、多分类、配置对象、未分类）
   */
  private resolveCategories(
    category?: ToolCategory
  ): readonly ToolCategories[] {
    if (category === undefined) {
      const result: readonly ToolCategories[] = [this.config.defaultCategory];
      return result;
    }

    // 处理 CategoryConfig 对象
    if (typeof category === 'object' && 'category' in category) {
      return [category.category];
    }

    if (Array.isArray(category)) {
      const result: readonly ToolCategories[] = category;
      return result;
    }

    const result: readonly ToolCategories[] = [category];
    return result;
  }

  /**
   * 将分类转换为 Set（支持单分类或多分类）
   */
  private toCategorySet(categories: ToolCategory): Set<ToolCategories> {
    if (categories === undefined) {
      return new Set([this.config.defaultCategory]);
    }

    // 处理 CategoryConfig 对象
    if (
      typeof categories === 'object' &&
      !Array.isArray(categories) &&
      'category' in categories
    ) {
      return new Set([categories.category]);
    }

    if (Array.isArray(categories)) {
      return new Set(categories);
    }
    return new Set([categories]);
  }

  /**
   * 获取工具的分类
   */
  getToolCategories(toolName: string): readonly ToolCategories[] {
    return this.toolCategories.get(toolName) ?? [this.config.defaultCategory];
  }

  /**
   * 获取所有分类
   */
  getAllCategories(): ToolCategories[] {
    return Array.from(this.categoryIndex.keys());
  }

  /**
   * 获取分类的工具数量
   */
  getCategoryToolCount(category: ToolCategories): number {
    const index = this.categoryIndex.get(category);
    return index ? index.size : 0;
  }

  /**
   * 检查工具是否属于指定分类
   */
  hasCategory(toolName: string, category: ToolCategories): boolean {
    const categories = this.toolCategories.get(toolName);
    return categories ? categories.includes(category) : false;
  }

  /**
   * 清空所有分类记录
   */
  clear(): void {
    this.toolCategories.clear();
    this.initializeCategoryIndexes();
  }

  /**
   * 重新构建索引（当工具大量变更后调用）
   */
  rebuildIndex(tools: BaseTool[]): void {
    this.clear();
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }
}
