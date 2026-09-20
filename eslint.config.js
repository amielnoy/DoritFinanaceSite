import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginUnusedImports from "eslint-plugin-unused-imports";

// The rules every first-party file gets, JavaScript or TypeScript.
//
// Until this config also matched `.ts`/`.tsx`, it applied to almost nothing:
// the app had been converted to TypeScript file by file and the `files` glob
// still named `.jsx` only, so the hex ban below, the hooks rules and the
// unused-import check were running on a handful of leftovers while a raw
// `#8a6f54` sat in Leads.tsx. Any rule added here must be one that holds
// across both syntaxes.
const sharedRules = {
  // ── Design tokens ────────────────────────────────────────────────────
  // Raw colour hex is banned in application code. The bronze had already
  // forked into five near-identical values (#C4A484, #C3AD96, #b8916f,
  // #b89a80, #9C836A) with a --highlight token defined and referenced by
  // nothing, so a palette change meant a 141-site find-and-replace.
  // Colours belong in src/index.css and reach components as Tailwind
  // classes: bg-highlight, text-highlight-strong, border-highlight-muted.
  "no-restricted-syntax": [
    "error",
    {
      selector: "Literal[value=/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\\b/]",
      message:
        "Raw colour hex is not allowed here. Add a token to src/index.css and use the Tailwind class (e.g. bg-highlight).",
    },
    {
      selector: "TemplateElement[value.raw=/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\\b/]",
      message:
        "Raw colour hex is not allowed here. Add a token to src/index.css and use the Tailwind class (e.g. bg-highlight).",
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
  "react/no-unknown-property": ["error", { ignore: ["cmdk-input-wrapper", "toast-close"] }],
  "react-hooks/rules-of-hooks": "error",
};

const sharedPlugins = {
  react: pluginReact,
  "react-hooks": pluginReactHooks,
  "unused-imports": pluginUnusedImports,
};

export default [
  // The shadcn primitives are generated code and stay out of lint, as before.
  // `src/lib` used to be ignored too; it now holds first-party TypeScript
  // (seo, structured-data, pension-fee) and is linted like everything else.
  { ignores: ["src/components/ui/**/*", "dist/**", "node_modules/**"] },

  // ── JavaScript / JSX ─────────────────────────────────────────────────
  {
    files: ["src/**/*.{js,mjs,cjs,jsx}"],
    ...pluginJs.configs.recommended,
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    settings: { react: { version: "detect" } },
    plugins: sharedPlugins,
    rules: sharedRules,
  },

  // ── TypeScript / TSX ─────────────────────────────────────────────────
  // typescript-eslint's parser and its recommended set, then the same
  // project rules on top. Syntax-only (no type-aware rules): `tsc` is the
  // type checker and runs as its own blocking step.
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["src/**/*.{ts,tsx}"],
  })),
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "detect" } },
    plugins: sharedPlugins,
    rules: {
      ...sharedRules,
      // TypeScript already reports unused symbols; keep the one rule that
      // can auto-fix (unused-imports) and let it own the warning.
      "@typescript-eslint/no-unused-vars": "off",
      // `React.ElementRef` in the .d.ts shims and a few `{}` prop types are
      // fine here; the recommended set flags them as errors.
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
];
