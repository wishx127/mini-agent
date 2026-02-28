## Why

项目当前缺乏统一的代码规范工具链，不同开发者提交的代码风格不一致，随着项目扩展（可能引入 React/TSX 组件、Less 样式），代码质量和一致性难以保障。引入 Google 风格的 ESLint + Prettier 配置，建立统一的代码规范基线，从提交阶段拦截不规范代码。

## What Changes

- 新增 `eslint.config.ts`（ESLint Flat Config，ESLint v9+）：基于 Google JavaScript/TypeScript 风格规则集
- 新增 `.prettierrc`：Prettier 格式化规则（与 ESLint 零冲突配置）
- 新增 `.prettierignore`：排除 dist、node_modules 等目录
- 新增 `.editorconfig`：编辑器层面的基础一致性保障（缩进、换行、编码）
- 更新 `package.json`：新增 lint / lint:fix / format / format:check 脚本
- 新增 `.husky/` + `lint-staged` 配置：pre-commit 钩子，提交前自动 lint + format
- 覆盖文件类型：`.ts`、`.tsx`、`.js`、`.jsx`、`.mjs`、`.cjs`、`.less`、`.css`、`.json`、`.md`

## Capabilities

### New Capabilities

- `eslint-config`: ESLint Flat Config 配置，整合 Google 风格规则，覆盖 TS/TSX/JS/JSX，含 import 排序、类型检查等规则
- `prettier-config`: Prettier 配置规则，与 ESLint 解耦（通过 `eslint-config-prettier` 禁用冲突规则），覆盖所有支持的文件类型
- `editor-config`: `.editorconfig` 统一编辑器基础行为（缩进 2 空格、LF 换行、UTF-8 编码）
- `pre-commit-hooks`: Husky + lint-staged 配置，提交前对暂存文件执行 ESLint 修复 + Prettier 格式化

### Modified Capabilities

<!-- 无现有 specs，无需填写 -->

## Impact

**依赖新增（devDependencies）：**

- `eslint` ^9.x（Flat Config）
- `@eslint/js`
- `typescript-eslint`（`@typescript-eslint/eslint-plugin` + `@typescript-eslint/parser`）
- `eslint-config-google`（Google 风格基础规则）
- `eslint-config-prettier`（禁用与 Prettier 冲突的 ESLint 规则）
- `eslint-plugin-import`（import 顺序规范）
- `eslint-plugin-prettier`（将 Prettier 作为 ESLint 规则运行）
- `prettier`
- `prettier-plugin-organize-imports`（TS import 自动排序）
- `stylelint` + `stylelint-config-standard`（Less/CSS 规范）
- `husky`
- `lint-staged`

**影响范围：**

- 所有 `src/**` 下的 TypeScript 源文件将被 ESLint 检查，现有代码可能产生 lint warning/error
- CI/CD 流程需在构建前加入 `npm run lint` 步骤
- `package.json` scripts 新增 4 条命令
- 不影响运行时行为，不修改业务逻辑
