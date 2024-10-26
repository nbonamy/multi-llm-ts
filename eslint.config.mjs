
import tsParser from '@typescript-eslint/parser'
import { fixupConfigRules } from '@eslint/compat'
import { FlatCompat } from '@eslint/eslintrc'
import { fileURLToPath } from 'node:url'
import globals from 'globals'
import path from 'node:path'
import js from '@eslint/js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
})

export default [...fixupConfigRules(compat.extends(
  'eslint:recommended',
  'plugin:@typescript-eslint/eslint-recommended',
  'plugin:@typescript-eslint/recommended',
  'plugin:import/recommended',
  'plugin:import/electron',
  'plugin:import/typescript',
)), {
  languageOptions: {
    globals: {
      ...globals.browser,
      ...globals.node,
    },
    parser: tsParser,
  },
  settings: {
    'import/resolver': {
      typescript: {
        project: './tsconfig.json'
      }
    }
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
  },
}]
