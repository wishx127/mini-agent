## Context

项目当前为纯 TypeScript CLI 工具（Node.js + LangChain），TypeScript 5.x，采用 strict 模式，使用 CommonJS 模块。未来可能引入 React/TSX 和 Less（前端组件），因此需要规范方案具备扩展性。

当前状态：

- 无任何 lint/format 工具
- `tsconfig.json` 已配置 strict 模式（`noImplicitAny`、`strictNullChecks` 等）
- 无 pre-commit 钩子
- 无 `.editorconfig`

约束：

- Node.js 环境，构建工具为 `tsc`，无 webpack/vite（当前）；**未来将引入 vite + React（非 Vue）**，ESLint 配置需预留 React 规则扩展点
- 需与现有 `typescript: ^5.x` 兼容
- 开发体验优先：修复命令需支持 `--fix` 自动修复

---

## Goals / Non-Goals

**Goals:**

- 建立 Google 风格的 ESLint 规则集，覆盖 `.ts` `.tsx` `.js` `.jsx` `.mjs`
- Prettier 配置与 Google 风格对齐（2 空格、单引号、80 字符行宽）
- stylelint 覆盖 `.less` `.css`
- `.editorconfig` 统一编辑器基础行为
- Husky + lint-staged 在 pre-commit 阶段自动执行增量 lint + format
- `package.json` 提供完整的 lint / format 脚本

**Non-Goals:**

- 不引入 CI/CD 集成（留给独立变更）
- 不修改任何业务逻辑代码（即便 lint 报错，修复放 tasks）
- 不配置 commit message 规范（commitlint，留后续）
- 不强制规定测试覆盖率（独立变更）

---

## Decisions

### 决策 1：使用 ESLint v9 Flat Config 而非 v8 `.eslintrc`

**选择：** ESLint v9 Flat Config（`eslint.config.ts`）

**理由：**

- ESLint v8 于 2024 年 EOL，v9 是当前主流
- Flat Config 减少配置层级，更易理解和调试
- `typescript-eslint` v8+ 已原生支持 Flat Config，无需额外适配层
- 项目从零开始，无历史包袱，直接采用新标准

**备选：** ESLint v8 + `.eslintrc.cjs`
**放弃原因：** 已 EOL，社区插件逐步停止支持

---

### 决策 2：Google 风格实现方案

**选择：** `@eslint/js` + `typescript-eslint` + 手动配置 Google 规则集，通过 `@eslint/compat` 兼容层引入 `eslint-config-google`

**核心包组合：**

```
eslint                          # v9.x
@eslint/js                      # ESLint 内置推荐规则
typescript-eslint               # TS 规则（replaces @typescript-eslint/*)
eslint-config-google            # Google 基础规则（通过 compat 适配）
@eslint/compat                  # 将旧格式 config 适配到 Flat Config
eslint-config-prettier          # 禁用与 Prettier 冲突的规则（必须放最后）
eslint-plugin-import            # import 顺序、路径规范
eslint-plugin-unused-imports    # 清理未使用 import
# 为未来 React 预留（当前不安装，通过注释占位提示扩展点）
# eslint-plugin-react           # React JSX 规则
# eslint-plugin-react-hooks     # Hooks 规则
# eslint-plugin-jsx-a11y        # 无障碍规则
```

**React 扩展点设计：** `eslint.config.ts` 中为 `.tsx`/`.jsx` 文件预留独立的配置块（当前仅声明文件匹配模式，不加载 React 插件），待引入 vite + React 时只需取消注释并安装对应包即可。

**关键规则覆盖（对齐 Google Style Guide）：**
| 规则 | 配置值 | 说明 |
|------|--------|------|
| `indent` | 2 | Google 标准 2 空格 |
| `quotes` | `'single'` | Google 使用单引号 |
| `semi` | `true` | 必须有分号 |
| `max-len` | 80 | Google 默认行长 |
| `no-var` | error | 禁止 var |
| `prefer-const` | error | 优先 const |
| `eqeqeq` | error | 强制 === |
| `import/order` | 按 builtin→external→internal 排序 |

**备选：** `@antfu/eslint-config`（Anthony Fu 的一体化方案）
**放弃原因：** 风格偏 Airbnb/个人偏好，与 Google Style Guide 差异较大；且该配置高度集成，难以精细调整单条规则

**备选：** 直接使用 `eslint-config-airbnb`
**放弃原因：** 用户明确要求 Google 风格

---

### 决策 3：Prettier 配置策略

**选择：** Prettier 独立配置 + `eslint-config-prettier` 禁用冲突规则

**`.prettierrc` 关键配置（对齐 Google 风格）：**

```json
{
  "semi": true,
  "singleQuote": true,
  "printWidth": 80,
  "tabWidth": 2,
  "useTabs": false,
  "trailingComma": "es5",
  "bracketSpacing": true,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

**与 ESLint 的协作模式：** ESLint 负责代码质量规则（`no-unused-vars`、`prefer-const` 等），Prettier 负责格式化（缩进、引号、行宽），通过 `eslint-config-prettier` 关闭所有会与 Prettier 冲突的 ESLint 格式规则。

**不使用** `eslint-plugin-prettier`（将 Prettier 作为 ESLint 规则运行）
**原因：** 该模式在保存时产生双重检查开销，社区已推荐分离运行；`eslint-config-prettier` 方案更轻量

---

### 决策 4：Less/CSS 规范工具

**选择：** `stylelint` v16 + `stylelint-config-standard` + `stylelint-config-prettier`

**配置文件：** `.stylelintrc.json`，覆盖 `.less` `.css` 文件

**备选：** 在 ESLint 中通过插件处理样式
**放弃原因：** ESLint 对样式文件支持有限，stylelint 是样式规范领域的专业工具

---

### 决策 5：Pre-commit 钩子方案

**选择：** Husky v9 + lint-staged v15

**工作流：**

```
git commit
  └─ husky pre-commit
       └─ lint-staged（仅处理暂存文件）
            ├─ *.{ts,tsx,js,jsx,mjs} → eslint --fix → prettier --write
            ├─ *.{less,css}          → stylelint --fix → prettier --write
            └─ *.{json,md}           → prettier --write
```

**增量执行：** lint-staged 只处理本次暂存的文件，不影响全量文件，保证提交速度

**Husky 初始化方式：** `husky init`（v9 推荐，替代旧的 `husky install`）

**备选：** `simple-git-hooks`（更轻量）
**放弃原因：** Husky 生态更成熟，文档完善，团队更熟悉

---

## Risks / Trade-offs

**[风险 1] 现有代码存在大量 lint error**
→ 缓解：首次引入时运行 `eslint --fix` 自动修复可自动处理的问题；剩余手动修复放入 tasks；可在 `eslint.config.ts` 中为 `dist/` 和旧代码目录临时添加 `ignores`

**[风险 2] `eslint-config-google` 对 ESLint v9 Flat Config 兼容性**
→ 缓解：通过 `@eslint/compat` 的 `fixupConfigRules()` 适配旧格式配置；如适配失败，降级为手动配置所有 Google 规则（已在决策 2 中列出关键规则，可作为 fallback）

**[风险 3] TypeScript 类型感知规则（`type-aware linting`）增加 lint 耗时**
→ 缓解：`typescript-eslint` 的类型感知规则需要 `parserOptions.project` 指向 `tsconfig.json`；仅在全量 lint（`npm run lint`）中启用，lint-staged 的增量检查使用不带类型感知的基础规则集，保证提交速度

**[风险 4] `.prettierrc` 规则与团队偏好冲突**
→ 缓解：所有规则已对齐 Google Style Guide，且在 proposal 阶段已明确采用 Google 风格；配置文件为 JSON 格式，修改成本极低

---

## Migration Plan

1. 安装所有 devDependencies（`npm install --save-dev ...`）
2. 写入配置文件：`eslint.config.ts`、`.prettierrc`、`.prettierignore`、`.stylelintrc.json`、`.editorconfig`
3. 初始化 Husky：`npx husky init`，写入 `.husky/pre-commit`
4. 配置 `lint-staged`（写入 `package.json` 的 `lint-staged` 字段）
5. 更新 `package.json` scripts
6. 运行 `npm run lint:fix` + `npm run format`，处理现有代码的全量修复
7. 验证：执行一次 `git add . && git commit` 确认钩子正常触发

**回滚策略：** 删除所有新增配置文件，从 `package.json` 移除相关 devDependencies 和 scripts，运行 `npm install`；Husky 钩子删除 `.husky/pre-commit` 即可停用

---

## Open Questions

> 所有问题已解答（2026-02-28）

- **Q1 [已解答]：** 将引入 **vite + React**（非 Vue）。`eslint.config.ts` 在当前变更中预留 React 扩展点（注释占位），不加载 React 插件；待 vite + React 引入时通过独立变更补充。
- **Q2 [已解答]：** 不需要对 `*.md` 代码块执行 lint，不引入 `eslint-plugin-markdown`。
- **Q3 [已解答]：** CI 集成放**下一个独立变更**，在 GitHub Actions 中加入 `npm run lint` 步骤。
