import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ホスト配布（docs/packaging.md Phase 1）用。Docker は従来どおり next start + フル node_modules も可。
  output: "standalone",
  // Docker / 本番で onnxruntime-node 等の native 依存をバンドル対象から外す
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
};

export default nextConfig;
