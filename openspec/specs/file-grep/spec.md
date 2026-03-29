## Purpose

提供文件内容搜索能力，支持使用正则表达式在项目目录内的文件中搜索匹配内容。

## Requirements

### Requirement: 文件内容搜索

Grep 工具 SHALL 能够使用正则表达式搜索文件内容。

#### Scenario: 搜索匹配行

- **WHEN** 调用 Grep 工具并传入 pattern 和 path
- **THEN** 返回所有匹配行的内容及其行号

#### Scenario: 多文件搜索

- **WHEN** 调用 Grep 工具并传入 pattern 和 glob 模式
- **THEN** 返回所有匹配文件及其匹配行

#### Scenario: 显示上下文行

- **WHEN** 调用 Grep 工具并传入 contextLines 参数
- **THEN** 返回匹配行及其前后指定数量的上下文行

#### Scenario: 正则表达式无效

- **WHEN** 调用 Grep 工具并传入无效的正则表达式
- **THEN** 抛出错误，提示 "Invalid regex pattern: <error message>"

#### Scenario: 路径超出允许范围

- **WHEN** 调用 Grep 工具传入项目根目录外的路径
- **THEN** 抛出错误，提示 "Access denied: path outside project directory"

#### Scenario: 软链接文件搜索

- **WHEN** 搜索过程中遇到符号链接文件
- **THEN** 解析软链接获取真实路径
- **AND** 如果真实路径在项目根目录内，则搜索该文件
- **AND** 如果真实路径在项目根目录外，则跳过该文件

#### Scenario: 软链接目录递归搜索

- **WHEN** 使用 glob 模式递归搜索时遇到符号链接目录
- **THEN** 解析软链接获取真实路径
- **AND** 如果真实路径在项目根目录内，则递归搜索该目录
- **AND** 如果真实路径在项目根目录外，则跳过该目录

### Requirement: 搜索选项

Grep 工具 SHOULD 支持多种搜索选项。

#### Scenario: 忽略大小写

- **WHEN** 调用 Grep 工具并设置 caseInsensitive: true
- **THEN** 不区分大小写匹配模式

#### Scenario: 多行模式

- **WHEN** 调用 Grep 工具并设置 multiline: true
- **THEN** 允许 . 匹配换行符，支持跨行匹配

#### Scenario: 限制搜索文件数量

- **WHEN** 调用 Grep 工具并传入 maxFiles 参数
- **THEN** 最多搜索指定数量的文件
