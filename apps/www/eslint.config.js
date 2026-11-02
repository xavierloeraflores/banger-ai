import config from "@banger/eslint-config/next";

const studioConfig = [...config, { ignores: ["public/banger-sidechain.js"] }];
export default studioConfig;
