// ESLint's configuration (RULES.md D18, R-LINT-2): typescript-eslint's
// strictest type-checked rules, React's hooks rules, and the limits of
// R-SIZE. A warning is an error (`--max-warnings 0`, R-LINT-1).
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "target", "src-tauri", "core", "xtask", "node_modules", "coverage"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // R-SIZE-1, R-SIZE-2, R-SIZE-3, R-SIZE-5.
      "max-lines-per-function": ["error", { max: 50, skipBlankLines: true, skipComments: true }],
      "max-lines": ["error", { max: 600 }],
      "max-params": ["error", 5],
      complexity: ["error", 15],
      "max-depth": ["error", 5],
      // R-SEC-4: no eval in any form.
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      // R-STYLE-3: the front end reports through the UI, never the console.
      "no-console": "error",
      // R-DOC-5: no open-work markers.
      "no-warning-comments": ["error", { terms: ["todo", "fixme", "xxx"], location: "anywhere" }],
    },
  },
  {
    files: ["ui/**/*.test.{ts,tsx}"],
    rules: { "max-lines-per-function": "off" },
  },
  {
    files: ["eslint.config.js"],
    ...tseslint.configs.disableTypeChecked,
  },
);
