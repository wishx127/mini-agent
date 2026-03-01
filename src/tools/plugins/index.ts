/**
 * 插件统一入口
 * 导入此文件会自动触发所有工具的 @registerTool() 装饰器注册
 *
 * 添加新工具只需：
 * 1. 在 plugins/ 目录下创建新工具文件
 * 2. 使用 @registerTool() 装饰器
 * 3. 在下方添加导出语句
 */

// 导出所有工具（触发装饰器注册）
export { TavilySearchTool } from './tavily.js';
