import base from "@banger/eslint-config/base";

export default [...base, { ignores: ["test/**"] }, { languageOptions: { globals: { setInterval: "readonly", clearInterval: "readonly", AudioContext: "readonly" } } }];
