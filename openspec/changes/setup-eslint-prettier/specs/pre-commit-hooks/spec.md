## ADDED Requirements

### Requirement: Husky pre-commit 钩子存在且可执行

项目 SHALL 包含 `.husky/pre-commit` 脚本，该脚本在 `git commit` 执行前自动触发 lint-staged。Husky SHALL 通过 `prepare` npm script 自动安装，确保新克隆项目的开发者执行 `npm install` 后钩子自动生效。

#### Scenario: 钩子在 git commit 时自动触发

- **WHEN** 执行 `git commit`（暂存区有文件变更）
- **THEN** `.husky/pre-commit` 脚本被执行，lint-staged 运行

#### Scenario: npm install 后钩子自动安装

- **WHEN** 新开发者克隆仓库并执行 `npm install`
- **THEN** `prepare` script 自动运行 `husky`，`.husky/` 目录下的钩子被激活

#### Scenario: 钩子可执行权限正确

- **WHEN** 检查 `.husky/pre-commit` 文件权限
- **THEN** 文件具有可执行权限（`chmod +x`）

---

### Requirement: lint-staged 增量执行策略

`package.json` 的 `lint-staged` 配置 SHALL 仅对本次暂存的文件（staged files）执行检查，按文件类型分组执行不同命令：

- `*.{ts,tsx,js,jsx,mjs,cjs}` → `eslint --fix` → `prettier --write`
- `*.{less,css}` → `stylelint --fix` → `prettier --write`
- `*.{json,md}` → `prettier --write`

#### Scenario: 仅检查暂存文件

- **WHEN** 仅暂存了 `src/index.ts`（其他文件未暂存）并执行 `git commit`
- **THEN** lint-staged 只对 `src/index.ts` 运行 ESLint 和 Prettier，不处理其他文件

#### Scenario: TypeScript 文件触发 ESLint 修复

- **WHEN** 暂存的 `.ts` 文件存在可自动修复的 lint 错误
- **THEN** lint-staged 运行 `eslint --fix` 修复文件，修复后的文件内容被包含在本次提交中

#### Scenario: 格式化后文件自动重新暂存

- **WHEN** lint-staged 对暂存文件执行 `prettier --write` 修改了文件
- **THEN** 修改后的文件被自动重新暂存（lint-staged 默认行为），提交内容包含格式化后的代码

#### Scenario: Less 文件触发 stylelint 检查

- **WHEN** 暂存的 `.less` 文件存在样式规范问题
- **THEN** lint-staged 运行 `stylelint --fix` 处理该文件

---

### Requirement: 提交因 lint 错误失败时给出明确提示

当暂存文件存在无法自动修复的 lint 错误时，pre-commit 钩子 SHALL 以非零退出码退出，阻止提交，并在终端输出具体的错误信息（文件名、行号、规则名）。

#### Scenario: 不可修复的 lint 错误阻止提交

- **WHEN** 暂存文件存在 `no-unused-vars` 等无法自动修复的 lint 错误
- **THEN** `git commit` 被阻止，终端显示具体错误位置和规则名，退出码为非零

#### Scenario: 所有 lint 错误修复后提交成功

- **WHEN** 所有暂存文件通过 ESLint 和 Prettier 检查
- **THEN** `git commit` 正常完成，退出码为 0
