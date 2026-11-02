import config from "@banger/eslint-config/next";
const apiConfig = [...config, { ignores: ["dist/**"] }];
export default apiConfig;
