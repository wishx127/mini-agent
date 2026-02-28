## Why

需要一个最小可用的AI Agent原型系统，用于快速验证基于LangChain的agent架构设计。当前缺乏一个简单的命令行交互agent来测试不同LLM模型的集成效果和基础功能。

## What Changes

- 创建基于Node.js + TypeScript + LangChain的最小agent实现
- 实现可配置的自定义模型baseURL支持
- 构建命令行交互界面
- 添加基础的agent核心功能（prompt处理、模型调用、响应生成）
- 配置开发和构建工具链

## Capabilities

### New Capabilities

- `agent-core`: 核心的agent功能，包括prompt处理、LLM调用和响应生成
- `model-config`: 模型配置管理，支持自定义baseURL和模型参数设置
- `cli-interface`: 命令行交互界面，提供用户输入和agent响应的交互能力

### Modified Capabilities

<!-- 无现有能力需要修改 -->

## Impact

- 新增项目依赖：langchain, typescript, node.js相关包
- 创建核心agent模块和CLI交互模块
- 添加TypeScript配置和构建脚本
- 更新项目结构和README文档
