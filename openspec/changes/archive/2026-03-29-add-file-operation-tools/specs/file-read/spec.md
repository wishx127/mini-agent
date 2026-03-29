## ADDED Requirements

### Requirement: 读取文件内容

Read 工具 SHALL 能够读取指定文件的文本内容，并返回带文件路径标识的格式化内容。

#### Scenario: 成功读取文件

- **WHEN** 调用 Read 工具并传入有效文件路径
- **THEN** 返回格式化内容，格式为：`[File: {file_path}]\n\n{file_content}`
- **AND** 文件路径使用原始传入的相对路径或绝对路径

#### Scenario: 读取指定行范围

- **WHEN** 调用 Read 工具并传入 offset 和 limit 参数
- **THEN** 返回格式化内容，格式为：`[File: {file_path}]\n\n{extracted_content}`
- **AND** 路径标识头始终在最前面，不受 offset/limit 影响

#### Scenario: 读取空文件

- **WHEN** 调用 Read 工具传入存在的空文件路径
- **THEN** 返回 `[File: {file_path}]\n\n`（只有路径标识，无内容）

#### Scenario: 文件不存在

- **WHEN** 调用 Read 工具传入不存在的文件路径
- **THEN** 抛出错误，提示 "File not found: <path>"

#### Scenario: 路径超出允许范围

- **WHEN** 调用 Read 工具传入项目根目录外的路径（如 ../../../etc/passwd）
- **THEN** 抛出错误，提示 "Access denied: path outside project directory"

#### Scenario: 文件过大

- **WHEN** 调用 Read 工具传入超过 1MB 的文件
- **THEN** 抛出错误，提示 "File too large: <path> (size: X MB, max: 1 MB)"

### Requirement: 文件路径验证

Read 工具 MUST 在执行前验证路径安全性。

#### Scenario: 解析并验证绝对路径

- **WHEN** 传入相对路径（如 ./src/index.ts 或 ../config.json）
- **THEN** 解析为绝对路径后检查是否在项目根目录内

#### Scenario: 软链接解析和验证

- **WHEN** 传入符号链接路径
- **THEN** 解析软链接获取真实路径
- **AND** 验证真实路径是否在项目根目录内

#### Scenario: 拒绝指向项目外部的软链接

- **WHEN** 传入指向项目目录外的符号链接路径（如 link -> /etc/passwd）
- **THEN** 解析软链接获取真实路径 /etc/passwd
- **AND** 验证真实路径在项目根目录外
- **AND** 抛出错误，提示 "Access denied: path outside project directory"
