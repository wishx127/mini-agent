# Proposal: Tool Layer Enhancement

## Why

当前工具调用层缺少熔断器(Circuit Breaker)保护机制和工具分类体系，无法满足生产环境对高可用性和复杂工具管理的要求。随着工具数量增长，缺乏分类机制导致工具查找和管理困难，外部API不稳定时缺乏熔断保护会影响整体系统稳定性。

## What Changes

1. **新增熔断器组件** - 为工具执行层添加熔断器模式，支持快速失败、状态切换和自动恢复
2. **新增工具分类体系** - 支持按类型（内部工具、外部API、文件系统、向量检索、代码执行沙箱）分类管理工具
3. **扩展 BaseTool 接口** - 添加 category、timeout、retryConfig 等可选配置属性
4. **增强 ToolRegistry** - 支持按分类查询工具、熔断器状态管理
5. **标准化参数定义** - 支持 JSONSchema 格式的参数定义，保持与 OpenAI/ Anthropic 工具调用格式兼容

## Capabilities

### New Capabilities

- `circuit-breaker`: 熔断器组件实现，提供工具级别的熔断保护
- `tool-categories`: 工具分类体系，支持多维度分类和按分类查询
- `json-schema-parameters`: JSONSchema 参数定义支持

### Modified Capabilities

- `tool-interface`: 扩展 BaseTool 接口，添加 category、timeout、retryConfig 属性

## Impact

- **代码影响**: `src/tools/base.ts`, `src/tools/registry.ts`, 新增 `src/tools/circuit-breaker.ts`, `src/tools/categories.ts`
- **配置影响**: 工具配置新增 category、circuitBreaker 等字段
- **依赖影响**: 引入 json-schema-to-typescript 或 zod-to-json-schema 进行类型转换
