## ADDED Requirements

### Requirement: ESLint Flat Config 文件存在且有效

项目根目录 SHALL 包含 `eslint.config.ts`，采用 ESLint v9 Flat Config 格式（不使用旧式 `.eslintrc.*`）。配置 SHALL 通过 `import` 语法引入所有插件，导出一个配置数组。

#### Scenario: 配置文件格式正确

- **WHEN** 在项目根目录运行 `npx eslint --print-config src/index.ts`
- **THEN** 命令成功输出有效的 JSON 配置，无任何报错

#### Scenario: 不存在旧式配置文件

- **WHEN** 检查项目根目录
- **THEN** 不存在 `.eslintrc`、`.eslintrc.js`、`.eslintrc.cjs`、`.eslintrc.json`、`.eslintrc.yaml` 任何旧格式文件

---

### Requirement: 覆盖目标文件类型

ESLint 配置 SHALL 覆盖以下文件类型：`.ts`、`.tsx`、`.js`、`.jsx`、`.mjs`、`.cjs`。

#### Scenario: TypeScript 文件被检查

- **WHEN** 运行 `npm run lint`
- **THEN** `src/**/*.ts` 下的所有文件被包含在 lint 范围内

#### Scenario: TSX 文件被检查

- **WHEN** 运行 `npm run lint`
- **THEN** `src/**/*.tsx` 下的所有文件被包含在 lint 范围内（为未来 React 预留）

#### Scenario: 排除 dist 和 node_modules

- **WHEN** 运行 `npm run lint`
- **THEN** `dist/`、`node_modules/`、`coverage/` 目录下的文件不被 lint

---

### Requirement: Google 风格核心规则集

ESLint 配置 SHALL 包含对齐 Google JavaScript Style Guide 的核心规则，不可使用 `var`，必须使用 `const`/`let`，必须使用严格相等（`===`），缩进为 2 空格，使用单引号字符串，行末必须有分号，行宽不超过 80 字符。

#### Scenario: 使用 var 触发报错

- **WHEN** 源文件中存在 `var x = 1`
- **THEN** ESLint 报告 `no-var` 规则错误

#### Scenario: 使用 == 触发报错

- **WHEN** 源文件中存在 `a == b`（非 `===`）
- **THEN** ESLint 报告 `eqeqeq` 规则错误

#### Scenario: 可自动修复的格式问题

- **WHEN** 运行 `npm run lint:fix`
- **THEN** `prefer-const`、`no-var`、`quotes`、`semi` 等可自动修复的规则被自动处理，不产生剩余错误

---

### Requirement: TypeScript 类型感知规则

ESLint 配置 SHALL 集成 `typescript-eslint`，对 `.ts`/`.tsx` 文件启用类型感知规则（type-aware linting），通过 `parserOptions.project` 指向 `tsconfig.json`。

#### Scenario: TypeScript 解析器正确配置

- **WHEN** 在 `.ts` 文件中使用 `as any` 类型断言
- **THEN** ESLint 通过 `@typescript-eslint/no-explicit-any` 规则发出警告（warn 级别）

#### Scenario: 类型感知规则仅在全量 lint 时启用

- **WHEN** lint-staged 对单个暂存文件执行增量检查
- **THEN** 不启动 TypeScript 编译器，检查速度不受类型感知规则影响

---

### Requirement: import 顺序规范

ESLint 配置 SHALL 集成 `eslint-plugin-import`，强制 import 语句按 builtin → external → internal → parent → sibling → index 顺序排列，组间有空行。

#### Scenario: import 顺序错误触发报错

- **WHEN** 源文件中 external import 出现在 builtin import 之后但顺序颠倒（如 `require('fs')` 在 `import React from 'react'` 之后）
- **THEN** ESLint 报告 `import/order` 规则错误

#### Scenario: 未使用的 import 触发报错

- **WHEN** 源文件中存在未被引用的 import 语句
- **THEN** ESLint 报告 `unused-imports/no-unused-imports` 规则错误

---

### Requirement: 与 Prettier 规则零冲突

ESLint 配置 SHALL 将 `eslint-config-prettier` 放在配置数组最后，关闭所有与 Prettier 格式化可能冲突的规则（包括 `indent`、`quotes`、`semi`、`max-len` 等格式规则），确保 ESLint 只报告代码质量问题，格式问题由 Prettier 处理。

#### Scenario: 格式规则不与 Prettier 冲突

- **WHEN** 同时运行 `npm run lint` 和 `npm run format:check`
- **THEN** 两者报告的问题集合不重叠；修复其中一个不会导致另一个产生新错误

---

### Requirement: React 扩展点预留

`eslint.config.ts` SHALL 包含针对 `.tsx`/`.jsx` 文件的独立配置块，当前以注释形式标注 React 插件安装说明，不加载实际插件。

#### Scenario: TSX 配置块存在

- **WHEN** 查看 `eslint.config.ts` 文件内容
- **THEN** 存在针对 `**/*.{tsx,jsx}` 的独立配置对象，其中 React 相关插件以注释形式列出

---

### Requirement: package.json lint 脚本完整

`package.json` 的 `scripts` 字段 SHALL 包含以下 4 条命令：

- `lint`：对所有目标文件执行 ESLint 检查（不自动修复）
- `lint:fix`：对所有目标文件执行 ESLint 检查并自动修复
- `format`：使用 Prettier 格式化所有目标文件
- `format:check`：检查格式是否符合 Prettier 规则（不写入文件，用于 CI）

#### Scenario: lint 命令存在且可运行

- **WHEN** 运行 `npm run lint`
- **THEN** 命令执行 ESLint 并返回非零退出码（当存在错误时）或零退出码（无错误时）

#### Scenario: lint:fix 命令自动修复

- **WHEN** 运行 `npm run lint:fix`
- **THEN** 可自动修复的 ESLint 错误被修复，文件被修改
