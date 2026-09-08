import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginUnusedImports from "eslint-plugin-unused-imports";

export default [
  {
    files: [
      "src/components/**/*.{js,mjs,cjs,jsx}",
      "src/pages/**/*.{js,mjs,cjs,jsx}",
      "src/Layout.jsx",
    ],
    ignores: ["src/lib/**/*", "src/components/ui/**/*"],
    ...pluginJs.configs.recommended,
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    plugins: {
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "unused-imports": pluginUnusedImports,
    },
    rules: {
      // ── Design tokens ────────────────────────────────────────────────────
      // Raw colour hex is banned in application code. The bronze had already
      // forked into five near-identical values (#C4A484, #C3AD96, #b8916f,
      // #b89a80, #9C836A) with a --highlight token defined and referenced by
      // nothing, so a palette change meant a 141-site find-and-replace.
      // Colours belong in src/index.css and reach components as Tailwind
      // classes: bg-highlight, text-highlight-strong, border-highlight-muted.
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value=/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\\b/]",
          message:
            'Raw colour hex is not allowed here. Add a token to src/index.css and use the Tailwind class (e.g. bg-highlight).',
        },
        {
          selector: "TemplateElement[value.raw=/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\\b/]",
          message:
            'Raw colour hex is not allowed here. Add a token to src/index.css and use the Tailwind class (e.g. bg-highlight).',
        },
      ],

      "no-unused-vars": "off",
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unknown-property": [
        "error",
        { ignore: ["cmdk-input-wrapper", "toast-close"] },
      ],
      "react-hooks/rules-of-hooks": "error",
    },
  },
];
