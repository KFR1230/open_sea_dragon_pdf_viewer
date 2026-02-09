/** @type {import('next').NextConfig} */

const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },

  // 你是 Project Pages（帳號.github.io/repo/）就需要
  basePath: `/${process.env.NEXT_PUBLIC_APP_NAME}`,
  assetPrefix: `/${process.env.NEXT_PUBLIC_APP_NAME}/`,
};

export default nextConfig;
