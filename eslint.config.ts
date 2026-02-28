import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';
import prettierConfig from 'eslint-config-prettier';
// eslint-config-google is CJS; ESM can default-import it
import googleConfig from 'eslint-config-google';

const googleRules = (
  googleConfig as unknown as { rules: Record<string, unknown> }
).rules;

/** 全局忽略目录 */
const globalIgnores = {
  ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.min.js'],
};

/** 基础 JS 推荐规则 */
const baseConfig = {
  ...js.configs.recommended,
};

/** TypeScript 配置（带类型感知，仅限 src/ 目录） */
const tsConfig = tseslint.config(
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // 根目录配置文件使用不带类型感知的基础规则
    files: ['*.{ts,js,mjs,cjs}'],
    extends: [...tseslint.configs.recommended],
  }
);

/** Google 风格规则覆盖 */
const googleStyleConfig = {
  rules: {
    ...googleRules,
    'valid-jsdoc': 'off',
    'require-jsdoc': 'off',
    'max-len': ['error', { code: 80, ignoreUrls: true, ignoreStrings: true }],
    'no-var': 'error',
    'prefer-const': 'error',
    eqeqeq: ['error', 'always'],
    quotes: ['error', 'single', { avoidEscape: true }],
    semi: ['error', 'always'],
    indent: ['error', 2, { SwitchCase: 1 }],
  },
};

/** import 顺序规则 */
const importConfig = {
  plugins: {
    import: importPlugin,
    'unused-imports': unusedImports,
  },
  rules: {
    'import/order': [
      'error',
      {
        groups: [
          'builtin',
          'external',
          'internal',
          'parent',
          'sibling',
          'index',
        ],
        'newlines-between': 'always',
      },
    ],
    'unused-imports/no-unused-imports': 'error',
    'unused-imports/no-unused-vars': [
      'warn',
      {
        vars: 'all',
        varsIgnorePattern: '^_',
        args: 'after-used',
        argsIgnorePattern: '^_',
      },
    ],
  },
};

/**
 * React 扩展点预留（当前未安装 React 插件）
 *
 * 引入 vite + React 后，取消以下注释并安装对应包：
 *   npm install --save-dev eslint-plugin-react eslint-plugin-react-hooks eslint-plugin-jsx-a11y
 *
 * import reactPlugin from 'eslint-plugin-react';
 * import reactHooksPlugin from 'eslint-plugin-react-hooks';
 * import jsxA11y from 'eslint-plugin-jsx-a11y';
 */
const reactExtensionConfig = {
  files: ['**/*.{tsx,jsx}'],
  rules: {
    // React 规则将在引入 vite + React 时配置
  },
};

export default [
  globalIgnores,
  baseConfig,
  ...tsConfig,
  googleStyleConfig,
  importConfig,
  reactExtensionConfig,
  // eslint-config-prettier 必须放最后，禁用所有与 Prettier 冲突的格式规则
  prettierConfig,
] satisfies import('eslint').Linter.Config[];
