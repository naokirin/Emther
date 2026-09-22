import {
  clearRerankerCache,
  maybeRerankByText,
  scoreQueryDocuments,
  isLocalRerankEnabled,
} from "../../packages/core/src/reranker.ts";
import {
  getRulesAndConstraints,
  updateRulesAndConstraints,
} from "../../packages/core/src/settings-store.ts";

async function main() {
  const beforeEnabled = getRulesAndConstraints().localRerankEnabled;
  updateRulesAndConstraints({ localRerankEnabled: true });
  console.log("enabled", isLocalRerankEnabled());

  clearRerankerCache();
  console.log("A: scoreQueryDocuments (fp32 fallback)");
  const s = await scoreQueryDocuments("組織体制の変更", ["開発生産性を上げる", "食堂メニュー"]);
  console.log("scores", s);

  clearRerankerCache();
  console.log("B: parallel maybeRerank (single-flight)");
  const items = [{ t: "開発生産性" }, { t: "食堂" }, { t: "組織改革" }];
  const results = await Promise.all([
    maybeRerankByText("組織", items, (i) => i.t),
    maybeRerankByText("組織", items, (i) => i.t),
    maybeRerankByText("組織", items, (i) => i.t),
  ]);
  console.log(
    "parallel ok",
    results.map((r) => r.map((x) => x.t)),
  );

  clearRerankerCache();
  console.log("C: undefined text");
  const bad = [{ t: "a" as string | undefined }, { t: undefined }, { t: "b" }];
  const out = await maybeRerankByText("q", bad, (i) => i.t as string);
  console.log(
    "undefined out",
    out.map((i) => i.t),
  );

  updateRulesAndConstraints({ localRerankEnabled: beforeEnabled });
  console.log("DONE alive");
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
