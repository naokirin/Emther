import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker / 本番で onnxruntime-node 等の native 依存をバンドル対象から外す
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
};

export default nextConfig;
