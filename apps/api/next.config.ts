import type {NextConfig} from 'next';
const config:NextConfig={
  async headers() { return [{ source: '/:path*', headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'same-origin' },
  ] }]; },
  serverExternalPackages:['pg','@vercel/sandbox'],
  transpilePackages:['@banger/www'],
  outputFileTracingIncludes:{'/':['../../examples/night-drive.banger']},
};
export default config;
