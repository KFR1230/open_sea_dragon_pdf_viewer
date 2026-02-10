/** @type {import('next').NextConfig} */
const repo = 'open_sea_dragon_pdf_viewer'; // 例: my-gh-page

const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },

  // 你是 Project Pages（帳號.github.io/repo/）就需要
  basePath: `/${repo}`,
  assetPrefix: `/${repo}`,
};

export default nextConfig;
