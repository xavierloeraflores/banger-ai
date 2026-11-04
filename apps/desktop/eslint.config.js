import base from "@banger/eslint-config/base";

export default [
  { ignores: [".packaging/**", "release/**"] },
  ...base,
  {
    files: ["**/*.mjs", "**/*.cjs"],
    languageOptions: { globals: Object.fromEntries([
      "URL", "Request", "Response", "Headers", "fetch", "AbortSignal", "process", "console", "require",
      "setTimeout", "clearTimeout", "TextDecoder", "TextEncoder", "Blob",
    ].map((name) => [name, "readonly"])) },
  },
  { files: ["src/preload.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
];
