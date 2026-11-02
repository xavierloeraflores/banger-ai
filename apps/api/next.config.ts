import type {NextConfig} from 'next';
const config:NextConfig={
  serverExternalPackages:['pg','@vercel/sandbox'],
  transpilePackages:['@banger/www'],
  outputFileTracingIncludes:{'/':['../../examples/night-drive.banger']},
};
export default config;
