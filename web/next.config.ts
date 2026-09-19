import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ホスト配布（docs/packaging.md Phase 1）用。Docker は従来どおり next start + フル node_modules も可。
  output: "standalone",
  // Docker / 本番で onnxruntime-node 等の native 依存をバンドル対象から外す
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "kuromoji"],
  // npm workspaces の packages/core はソース(.ts)のまま参照するため、Next のトランスパイル対象に含める
  // （docs/2nd_architecture/plan.md フェーズ1）
  transpilePackages: ["@emther/core"],
  // モノレポ化（npm workspaces）により lockfile / node_modules がリポジトリルートに
  // ホイストされるため、standalone トレースのルートを明示する
  outputFileTracingRoot: path.join(__dirname, ".."),
};

export default nextConfig;
