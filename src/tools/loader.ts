import { ToolRegistry } from './base.js';
import { getRegisteredBaseTools } from './registry.js';

// 导入所有插件（触发装饰器自动注册）
import './plugins/index.js';

/**
 * 工具加载器 - 自动加载所有 BaseTool
 */
export class ToolLoader {
  /**
   * 从配置加载工具到注册表
   *
   * @param registry - 工具注册表
   * @param toolConfigs - 各工具的详细配置
   * @param disabledTools - 需要禁用的工具名称列表
   */
  loadFromConfig(
    registry: ToolRegistry,
    toolConfigs: Record<string, Record<string, unknown> | undefined> = {},
    disabledTools: string[] = []
  ): void {
    for (const ToolClass of getRegisteredBaseTools()) {
      try {
        const tool = new ToolClass();

        // 检查是否被禁用
        if (disabledTools.includes(tool.name)) {
          console.log(`⏭️ [ToolLoader] 已跳过 (已禁用): ${tool.name}`);
          continue;
        }

        // 应用配置
        const config = toolConfigs[tool.name];
        if (config && 'enabled' in config) {
          tool.enabled = config.enabled as boolean;
        }

        registry.registerTool(tool);
        console.log(`📦 [ToolLoader] 加载工具: ${tool.name}`);
      } catch (error) {
        console.error(`❌ [ToolLoader] 加载失败: ${ToolClass.name}`, error);
      }
    }
  }

  /**
   * 加载所有已注册的插件（忽略禁用列表）
   */
  loadAll(registry: ToolRegistry): void {
    for (const ToolClass of getRegisteredBaseTools()) {
      try {
        const tool = new ToolClass();
        registry.registerTool(tool);
        console.log(`📦 [ToolLoader] 加载工具: ${tool.name}`);
      } catch (error) {
        console.error(`❌ [ToolLoader] 加载失败: ${ToolClass.name}`, error);
      }
    }
  }

  /**
   * 获取所有已注册的插件名称
   */
  getToolNames(): string[] {
    return getRegisteredBaseTools().map((ToolClass) => {
      try {
        const instance = new ToolClass();
        return instance.name;
      } catch {
        return ToolClass.name;
      }
    });
  }

  /**
   * 检查插件是否存在
   */
  hasTool(name: string): boolean {
    return getRegisteredBaseTools().some((ToolClass) => {
      try {
        const instance = new ToolClass();
        return instance.name === name;
      } catch {
        return ToolClass.name === name;
      }
    });
  }
}

// 导出单例
export const toolLoader = new ToolLoader();

// 所有工具通过 plugins/index.ts 统一导入，由 @registerTool() 装饰器自动注册