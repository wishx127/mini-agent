import { BaseTool } from './base.js';

/**
 * 工具注册表 - 用于存储所有注册的 BaseTool 类
 * 单独抽取避免循环依赖问题
 */
const baseToolClasses: Array<new () => BaseTool> = [];

/**
 * 装饰器：自动注册 BaseTool 工具
 *
 * 使用方式：
 * ```ts
 * @registerTool()
 * class MyTool extends BaseTool {
 *   readonly name = 'my-tool';
 *   readonly description = '我的工具';
 *   readonly paramsSchema = z.object({...});
 *   async execute(params) { ... }
 * }
 * ```
 */
export function registerTool() {
  return function <T extends new () => BaseTool>(constructor: T): T {
    baseToolClasses.push(constructor);
    return constructor;
  };
}

/**
 * 手动注册 BaseTool 类
 */
export function registerBaseTool(toolClass: new () => BaseTool): void {
  if (!baseToolClasses.includes(toolClass)) {
    baseToolClasses.push(toolClass);
  }
}

/**
 * 获取所有已注册的 BaseTool 类
 */
export function getRegisteredBaseTools(): Array<new () => BaseTool> {
  return [...baseToolClasses];
}