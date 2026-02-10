/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  logging: false,
  experimental: {
    browserDebugInfoInTerminal: false, // 這才是「轉發 console 到 terminal」 [oai_citation:2‡nextjs.org](https://nextjs.org/docs/app/api-reference/config/next-config-js/browserDebugInfoInTerminal?utm_source=chatgpt.com)
  },
};

export default nextConfig;
