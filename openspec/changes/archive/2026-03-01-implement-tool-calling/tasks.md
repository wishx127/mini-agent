## 1. 准备工作

- [x] 1.1 安装 @langchain/tavily 依赖
- [x] 1.2 创建 src/tools/ 目录结构

## 2. 配置系统扩展

- [x] 2.1 扩展 src/types/model-config.ts - 添加 ToolsConfig 接口
- [x] 2.2 扩展 src/config/model-config.ts - 添加工具配置加载逻辑
- [x] 2.3 在 ModelConfig 接口中添加工具配置字段

## 3. 工具系统实现

- [x] 3.1 创建 src/tools/base.ts - 定义工具基类和 Tool 接口
- [x] 3.2 创建 src/tools/registry.ts - 实现工具注册中心
- [x] 3.3 创建 src/tools/tavily.ts - 实现 Tavily 搜索工具
- [x] 3.4 创建 src/tools/index.ts - 导出所有工具和注册中心

## 4. Agent 核心修改

- [x] 4.1 修改 src/agent/core.ts - 注入工具注册中心
- [x] 4.2 实现工具调用中间件逻辑
- [x] 4.3 实现 LLM 判断 + 规则兜底的工具选择机制
- [x] 4.4 添加最大工具调用次数限制（防止无限循环）

## 5. 配置和文档

- [x] 5.1 创建 .env.example 文件，添加工具相关环境变量示例
- [x] 5.2 验证工具调用功能正常工作