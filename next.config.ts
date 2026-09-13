import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 超星刷课与加密依赖保持为外部包，避免被错误打包
  serverExternalPackages: ['coze-coding-dev-sdk', 'crypto-js'],
  allowedDevOrigins: ['*.dev.coze.site'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
