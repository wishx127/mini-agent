## ADDED Requirements

### Requirement: 文件模式匹配

Glob 工具 SHALL 能够根据 glob 模式查找匹配的文件。

#### Scenario: 匹配所有 TypeScript 文件

- **WHEN** 调用 Glob 工具并传入模式 "\*_/_.ts"
- **THEN** 返回项目中所有 .ts 文件的绝对路径列表

#### Scenario: 匹配特定目录下的文件

- **WHEN** 调用 Glob 工具并传入模式 "src/\*_/_.ts"
- **THEN** 返回 src 目录及其子目录下所有 .ts 文件的路径

#### Scenario: 限制搜索深度

- **WHEN** 调用 Glob 工具并传入 maxDepth 参数
- **THEN** 只返回在指定深度内的匹配文件

#### Scenario: 排除模式

- **WHEN** 调用 Glob 工具并传入 exclude 参数（如 ["node_modules/**", "*.test.ts"]）
- **THEN** 返回的列表中不包含被排除的文件

#### Scenario: 路径超出允许范围

- **WHEN** 调用 Glob 工具传入项目根目录外的路径作为 cwd
- **THEN** 抛出错误，提示 "Access denied: path outside project directory"

#### Scenario: 软链接目录处理

- **WHEN** glob 搜索遇到符号链接目录
- **THEN** 解析软链接获取真实路径
- **AND** 如果真实路径在项目根目录内，则继续搜索该目录
- **AND** 如果真实路径在项目根目录外，则跳过该目录

#### Scenario: 软链接文件包含在结果中

- **WHEN** glob 模式匹配到符号链接文件
- **THEN** 将符号链接文件路径包含在结果中
- **AND** 不验证软链接指向的目标路径（由读取工具验证）

### Requirement: 结果排序和限制

Glob 工具 SHOULD 支持对结果进行排序和限制数量。

#### Scenario: 按修改时间排序

- **WHEN** 调用 Glob 工具并设置 sortBy: "mtime" 和 order: "desc"
- **THEN** 返回按最近修改时间排序的文件列表

#### Scenario: 限制结果数量

- **WHEN** 调用 Glob 工具并传入 limit 参数
- **THEN** 返回不超过指定数量的文件路径
