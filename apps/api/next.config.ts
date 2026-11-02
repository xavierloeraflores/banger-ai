import type { NextConfig } from "next";
const config: NextConfig = { serverExternalPackages: ["pg", "@vercel/sandbox"] };
export default config;
