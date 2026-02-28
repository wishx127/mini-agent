## ADDED Requirements

### Requirement: Prettier 配置文件存在且对齐 Google 风格

项目根目录 SHALL 包含 `.prettierrc`（JSON 格式），配置值 SHALL 与 Google JavaScript Style Guide 对齐：`semi: true`、`singleQuote: true`、`printWidth: 80`、`tabWidth: 2`、`useTabs: false`、`trailingComma: "es5"`、`endOfLine: "lf"`。

#### Scenario: 配置文件存在

- **WHEN** 检查项目根目录
- **THEN** 存在 `.prettierrc` 文件，内容为有效 JSON

#### Scenario: 格式化结果符合 Google 风格

- **WHEN** 对含有双引号字符串、缺少分号的 TypeScript 文件运行 Prettier
- **THEN** 输出使用单引号、添加分号、2 空格缩进

---

### Requirement: Prettier 忽略文件存在

项目根目录 SHALL 包含 `.prettierignore`，排除 `dist/`、`node_modules/`、`coverage/`、`*.min.js`、`package-lock.json` 等不应被格式化的文件和目录。

#### Scenario: dist 目录不被格式化

- **WHEN** 运行 `npm run format`
- **THEN** `dist/` 目录下的文件不被 Prettier 修改

#### Scenario: node_modules 目录不被格式化

- **WHEN** 运行 `npm run format`
- **THEN** `node_modules/` 目录下的文件不被 Prettier 修改

---

### Requirement: 覆盖目标文件类型

Prettier 配置 SHALL 覆盖以下文件类型的格式化：`.ts`、`.tsx`、`.js`、`.jsx`、`.mjs`、`.cjs`、`.json`、`.md`、`.less`、`.css`。

#### Scenario: TypeScript 文件可被格式化

- **WHEN** 运行 `npm run format` 或 `npm run format:check`
- **THEN** `src/**/*.ts` 文件被 Prettier 处理

#### Scenario: JSON 文件可被格式化

- **WHEN** 运行 `npm run format`
- **THEN** `*.json` 文件（排除 `.prettierignore` 中的例外）被 Prettier 格式化

---

### Requirement: format:check 在 CI 场景下可用

`npm run format:check` SHALL 在格式不符合规则时以非零退出码退出，不修改任何文件，适用于 CI 环境校验。

#### Scenario: 格式不合规时返回非零退出码

- **WHEN** 存在未格式化的文件，运行 `npm run format:check`
- **THEN** 命令以退出码 1 退出，并列出不合规的文件名

#### Scenario: 格式合规时返回零退出码

- **WHEN** 所有文件已按 Prettier 规则格式化，运行 `npm run format:check`
- **THEN** 命令以退出码 0 退出，无任何输出
