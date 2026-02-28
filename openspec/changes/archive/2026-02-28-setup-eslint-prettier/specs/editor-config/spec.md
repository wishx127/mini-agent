## ADDED Requirements

### Requirement: .editorconfig 文件存在且配置正确

项目根目录 SHALL 包含 `.editorconfig` 文件，配置 SHALL 覆盖所有文件类型的基础行为：

- `indent_style = space`（空格缩进）
- `indent_size = 2`（2 空格）
- `end_of_line = lf`（Unix 换行符）
- `charset = utf-8`（UTF-8 编码）
- `trim_trailing_whitespace = true`（去除行尾空格）
- `insert_final_newline = true`（文件末尾空行）

Markdown 文件 SHALL 单独配置 `trim_trailing_whitespace = false`（Markdown 中行尾空格有语义含义）。

#### Scenario: .editorconfig 文件存在

- **WHEN** 检查项目根目录
- **THEN** 存在 `.editorconfig` 文件，包含 `root = true` 声明

#### Scenario: 编辑器读取缩进配置

- **WHEN** 支持 EditorConfig 的编辑器（如 VS Code + EditorConfig 插件）打开项目中的 `.ts` 文件
- **THEN** 编辑器自动使用 2 空格缩进、LF 换行符

#### Scenario: Markdown 文件行尾空格不被裁剪

- **WHEN** `.editorconfig` 配置被支持 EditorConfig 的工具读取
- **THEN** `*.md` 文件的 `trim_trailing_whitespace` 配置为 `false`
