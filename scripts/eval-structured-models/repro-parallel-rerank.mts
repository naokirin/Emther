/**
 * 相談再試行時に近い負荷: MiniLM embed + tiny reranker を並列で叩く。
 * server を落とさず、別プロセスでクラッシュ／OOM を切り分ける。
 */
import { embedText, clearEmbedderCache } from "../../packages/core/src/embeddings.ts";
import {
  clearRerankerCache,
  maybeRerankByText,
  scoreQueryDocuments,
} from "../../packages/core/src/reranker.ts";
import { updateRulesAndConstraints, getRulesAndConstraints } from "../../packages/core/src/settings-store.ts";

function rssMb(): number {
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const st = fs.readFileSync("/proc/self/status", "utf8");
    const m = st.match(/^VmRSS:\s+(\d+)\s+kB/m);
    return m ? Math.round(Number(m[1]) / 1024) : -1;
  } catch {
    return -1;
  }
}

async function specialistLike(label: string, query: string) {
  console.log(`[${label}] start rss=${rssMb()}MB`);
  const emb = await embedText(query);
  console.log(`[${label}] embedded dim=${emb.length} rss=${rssMb()}MB`);
  const docs = [
    "開発生産性を5倍にする目標",
    "食堂のメニュー改訂",
    "組織体制の大幅な変更とアーキテクチャ方針",
    "リリース頻度と障害率のOKR",
    "現場メンバーの負荷とメンタルケア",
  ];
  const items = docs.map((t, i) => ({ id: String(i), t }));
  const ranked = await maybeRerankByText(query, items, (x) => x.t);
  console.log(
    `[${label}] ranked=${ranked.map((x) => x.id).join(",")} rss=${rssMb()}MB`,
  );
}

async function main() {
  const before = getRulesAndConstraints().localRerankEnabled;
  updateRulesAndConstraints({ localRerankEnabled: true });
  clearEmbedderCache();
  clearRerankerCache();

  console.log(`boot rss=${rssMb()}MB`);
  process.on("uncaughtException", (e) => {
    console.error("uncaughtException", e);
  });
  process.on("unhandledRejection", (e) => {
    console.error("unhandledRejection", e);
  });

  // Lead 相当: 先に1回
  await specialistLike("lead", "生産性5倍と組織変更への対応");
  console.log(`after lead rss=${rssMb()}MB`);

  // consult 3 specialist 並列
  await Promise.all([
    specialistLike("exec", "経営目線で生産性5倍目標の真意を整理"),
    specialistLike("process", "仕組み化が追いつかない変化へのプロセス設計"),
    specialistLike("people", "急進的変更下の現場メンバーケア"),
  ]);
  console.log(`after parallel rss=${rssMb()}MB`);

  // 連続スコア（推論並列）
  await Promise.all([
    scoreQueryDocuments("組織", ["開発", "食堂", "体制"]),
    scoreQueryDocuments("生産性", ["残業", "OKR", "食堂"]),
    scoreQueryDocuments("アーキテクチャ", ["変更", "リリース", "休暇"]),
  ]);
  console.log(`after parallel score rss=${rssMb()}MB DONE alive`);

  updateRulesAndConstraints({ localRerankEnabled: before });
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
