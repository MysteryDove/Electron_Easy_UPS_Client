import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
    {
        ignores: ["dist/**/*", ".vite/**/*", "node_modules/**/*", "forge.config.ts", "vite.*.config.ts"]
    },
    {
        files: ["src/**/*.ts", "src/**/*.tsx"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaFeatures: { jsx: true },
            },
        },
        plugins: {
            "@typescript-eslint": tsPlugin,
        },
        rules: {
            ...tsPlugin.configs.recommended.rules,
            "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-inferrable-types": "warn"
        }
    }
];
