## 1. 安装 devDependencies

- [x] 1.1 安装 ESLint v9 核心包：`eslint`、`@eslint/js`、`@eslint/compat`
- [x] 1.2 安装 TypeScript-ESLint：`typescript-eslint`
- [x] 1.3 安装 ESLint 插件：`eslint-config-google`、`eslint-config-prettier`、`eslint-plugin-import`、`eslint-plugin-unused-imports`
- [x] 1.4 安装 Prettier：`prettier`
- [x] 1.5 安装 stylelint：`stylelint`、`stylelint-config-standard`（注：`stylelint-config-prettier` 已废弃，stylelint v15+ 不再需要）
- [x] 1.6 安装 Husky + lint-staged：`husky`、`lint-staged`

## 2. 创建 ESLint 配置

- [x] 2.1 创建 `eslint.config.ts`，采用 ESLint v9 Flat Config 格式，导出配置数组
- [x] 2.2 配置全局 `ignores`，排除 `dist/`、`node_modules/`、`coverage/` 目录
- [x] 2.3 配置 `@eslint/js` 推荐规则作为基础层
- [x] 2.4 配置 `typescript-eslint`，启用类型感知规则（`parserOptions.project` 指向 `tsconfig.json`）
- [x] 2.5 通过 `@eslint/compat` 的 `fixupConfigRules()` 引入 `eslint-config-google`（若适配失败则改为手动配置 Google 规则：`no-var`、`prefer-const`、`eqeqeq`、`max-len: 80`）
- [x] 2.6 配置 `eslint-plugin-import`，设置 `import/order` 规则（builtin → external → internal → parent → sibling → index，组间空行）
- [x] 2.7 配置 `eslint-plugin-unused-imports`，启用 `unused-imports/no-unused-imports` 规则
- [x] 2.8 为 `*.{tsx,jsx}` 添加独立配置块，注释标注待安装的 React 插件（`eslint-plugin-react`、`eslint-plugin-react-hooks`、`eslint-plugin-jsx-a11y`）
- [x] 2.9 将 `eslint-config-prettier` 放在配置数组最后，禁用所有与 Prettier 冲突的格式规则
- [x] 2.10 运行 `npx eslint --print-config src/index.ts` 验证配置文件解析无报错

## 3. 创建 Prettier 配置

- [x] 3.1 创建 `.prettierrc`（JSON 格式），配置 `semi: true`、`singleQuote: true`、`printWidth: 80`、`tabWidth: 2`、`useTabs: false`、`trailingComma: "es5"`、`endOfLine: "lf"`
- [x] 3.2 创建 `.prettierignore`，排除 `dist/`、`node_modules/`、`coverage/`、`*.min.js`、`package-lock.json`

## 4. 创建 stylelint 配置

- [x] 4.1 创建 `.stylelintrc.json`，继承 `stylelint-config-standard`，配置覆盖 `*.{less,css}`，末尾添加 `stylelint-config-prettier` 禁用冲突规则

## 5. 创建 EditorConfig

- [x] 5.1 创建 `.editorconfig`，配置 `root = true`，全局设置 `indent_style = space`、`indent_size = 2`、`end_of_line = lf`、`charset = utf-8`、`trim_trailing_whitespace = true`、`insert_final_newline = true`
- [x] 5.2 为 `*.md` 单独添加 `trim_trailing_whitespace = false` 覆盖配置

## 6. 更新 package.json scripts

- [x] 6.1 添加 `"lint": "eslint \"./**/*.{ts,tsx,js,jsx,mjs,cjs}\""` 脚本
- [x] 6.2 添加 `"lint:fix": "eslint \"./**/*.{ts,tsx,js,jsx,mjs,cjs}\" --fix"` 脚本
- [x] 6.3 添加 `"format": "prettier --write \"./**/*.{ts,tsx,js,jsx,mjs,cjs,json,md,less,css}\""` 脚本
- [x] 6.4 添加 `"format:check": "prettier --check \"./**/*.{ts,tsx,js,jsx,mjs,cjs,json,md,less,css}\""` 脚本
- [x] 6.5 添加 `"prepare": "husky"` 脚本（确保 `npm install` 后自动激活 Husky 钩子）

## 7. 配置 Husky + lint-staged

- [x] 7.1 运行 `npx husky init` 初始化 `.husky/` 目录
- [x] 7.2 编辑 `.husky/pre-commit`，内容为 `npx lint-staged`，确保文件有可执行权限
- [x] 7.3 在 `package.json` 添加 `lint-staged` 字段，配置三组规则：
  - `"*.{ts,tsx,js,jsx,mjs,cjs}": ["eslint --fix", "prettier --write"]`
  - `"*.{less,css}": ["stylelint --fix", "prettier --write"]`
  - `"*.{json,md}": ["prettier --write"]`

## 8. 全量修复现有代码

- [x] 8.1 运行 `npm run lint:fix` 对现有代码执行全量 ESLint 自动修复，记录无法自动修复的 error 数量
- [x] 8.2 运行 `npm run format` 对所有文件执行全量 Prettier 格式化
- [x] 8.3 若存在无法自动修复的 ESLint error，在 `eslint.config.ts` 中为问题文件添加临时 `// eslint-disable-next-line` 注释或使用 `ignores` 暂时跳过，避免阻塞后续提交

## 9. 验证

- [x] 9.1 运行 `npm run lint` 确认命令正常执行，无配置层面报错
- [x] 9.2 运行 `npm run format:check` 确认所有文件已符合 Prettier 规则，命令以退出码 0 退出
- [x] 9.3 执行 `git add . && git commit -m "test: verify pre-commit hook"` 确认 Husky 钩子触发、lint-staged 正常运行，仅进行测试不实际提交，测试后撤回本次提交，不影响提交历史
- [x] 9.4 确认 `eslint.config.ts` 中不存在任何旧式 `.eslintrc.*` 文件
