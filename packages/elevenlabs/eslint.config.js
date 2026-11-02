import base from "@banger/eslint-config/base";
export default [...base, { files: ["test/*.mjs"], languageOptions: { globals: { AbortController: "readonly" } } }];
