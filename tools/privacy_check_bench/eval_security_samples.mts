#!/usr/bin/env node
/**
 * docs/security_check/security_check_samples.md の10セットを
 * 現状のルール検知（quick）だけで評価する。実装変更なし・AI段は使わない。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "../../web/src/lib/test-helpers/store-env.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DOC = join(ROOT, "../../docs/security_check/security_check_samples.md");

type ExpectKind =
  | "person_name"
  | "email"
  | "phone"
  | "address"
  | "dob"
  | "login_id"
  | "customer_id"
  | "keyword" // surface string expected in findings.match or excerpt
  | "topic"; // conceptual — only hit if any of needles appear in match/excerpt

type ExpectItem = {
  id: string;
  kind: ExpectKind;
  /** for person_name / email / phone / etc. literal surface */
  surface?: string;
  /** for topic: any of these substrings in findings */
  needles?: string[];
  note?: string;
};

type SampleSet = {
  id: string;
  title: string;
  text: string;
  expects: ExpectItem[];
};

function extractBlockquotes(md: string): string[] {
  const blocks: string[] = [];
  let cur: string[] = [];
  for (const line of md.split("\n")) {
    if (line.startsWith(">")) {
      cur.push(line.replace(/^>\s?/, ""));
    } else if (cur.length) {
      blocks.push(cur.join("\n").trim());
      cur = [];
    }
  }
  if (cur.length) blocks.push(cur.join("\n").trim());
  return blocks;
}

/** Hard-coded expectations aligned with the doc's 「検知されるべき情報」. */
function buildSets(texts: string[]): SampleSet[] {
  return [
    {
      id: "1",
      title: "個人名・連絡先",
      text: texts[0],
      expects: [
        { id: "name:田中さん", kind: "person_name", surface: "田中さん" },
        { id: "name:佐藤さん", kind: "person_name", surface: "佐藤さん" },
        { id: "name:山本一郎さん", kind: "person_name", surface: "山本一郎さん" },
        { id: "name:鈴木さん", kind: "person_name", surface: "鈴木さん" },
        { id: "email:yamamoto", kind: "email", surface: "yamamoto@example.test" },
        { id: "phone:090", kind: "phone", surface: "090-1234-5678" },
        {
          id: "customer:ブルースター",
          kind: "topic",
          needles: ["ブルースター", "顧客情報", "顧客"],
          note: "会社名＋担当者文脈。現状カテゴリに会社名専用なし",
        },
      ],
    },
    {
      id: "2",
      title: "個人情報＋顧客情報",
      text: texts[1],
      expects: [
        { id: "name:高橋美咲さん", kind: "person_name", surface: "高橋美咲さん" },
        { id: "login:mf-takahashi", kind: "login_id", surface: "mf-takahashi-2048" },
        { id: "email:misaki", kind: "email", surface: "misaki.takahashi@example.test" },
        { id: "dob:1989", kind: "dob", surface: "1989年6月12日" },
        {
          id: "customer:グリーンフィールド",
          kind: "topic",
          needles: ["グリーンフィールド", "顧客情報"],
        },
        {
          id: "topic:個人情報言及",
          kind: "keyword",
          surface: "個人情報",
        },
      ],
    },
    {
      id: "3",
      title: "機密情報（システム・認証）",
      text: texts[2],
      expects: [
        { id: "name:山田さん", kind: "person_name", surface: "山田さん" },
        { id: "kw:アクセスキー", kind: "keyword", surface: "アクセスキー" },
        { id: "kw:認証情報", kind: "keyword", surface: "認証情報" },
        { id: "kw:パスワード", kind: "keyword", surface: "パスワード" },
        { id: "kw:契約金額", kind: "keyword", surface: "契約金額" },
        { id: "kw:個人情報核", kind: "topic", needles: ["個人情報", "氏名"] },
        {
          id: "topic:本番DB/NW",
          kind: "topic",
          needles: ["本番データベース", "ネットワーク構成", "バックアップ"],
          note: "文脈機密。CORE語彙に無い",
        },
      ],
    },
    {
      id: "4",
      title: "財務・経営情報",
      text: texts[3],
      expects: [
        { id: "kw:契約金額", kind: "keyword", surface: "契約金額" },
        {
          id: "fin:売上等",
          kind: "topic",
          needles: ["売上", "営業利益", "広告費", "予算"],
          note: "財務カテゴリなし",
        },
        {
          id: "biz:投資計画",
          kind: "topic",
          needles: ["投資", "人員", "取締役会", "経営会議"],
        },
        {
          id: "contract:1億",
          kind: "topic",
          needles: ["1億円", "年間1億"],
        },
      ],
    },
    {
      id: "5",
      title: "個人情報が大量",
      text: texts[4],
      expects: [
        { id: "name:伊藤健一さん", kind: "person_name", surface: "伊藤健一さん" },
        { id: "name:森彩さん", kind: "person_name", surface: "森彩さん" },
        {
          id: "addr:新宿",
          kind: "address",
          surface: "東京都新宿区西新宿2丁目8番1号",
        },
        { id: "phone:03", kind: "phone", surface: "03-1234-5678" },
        { id: "email:ito", kind: "email", surface: "kenichi.ito@example.test" },
        { id: "email:mori", kind: "email", surface: "aya.mori@example.test" },
        { id: "cid:C-493821", kind: "customer_id", surface: "C-493821" },
        {
          id: "billing",
          kind: "topic",
          needles: ["請求金額", "請求書", "契約金額"],
        },
      ],
    },
    {
      id: "6",
      title: "文脈依存の機密",
      text: texts[5],
      expects: [
        {
          id: "unpub:release",
          kind: "topic",
          needles: ["10月15日", "リリース日", "プレスリリース", "10月10日"],
          note: "日付・未公開は語彙なし",
        },
        {
          id: "unpub:price",
          kind: "topic",
          needles: ["値下げ", "新料金", "料金"],
        },
        {
          id: "competitor",
          kind: "topic",
          needles: ["競合", "非公式"],
        },
        {
          id: "tech",
          kind: "topic",
          needles: ["500万件", "クラウド", "構成"],
        },
        {
          id: "roadmap",
          kind: "topic",
          needles: ["ロードマップ"],
        },
      ],
    },
    {
      id: "7",
      title: "個人名の誤検知テスト",
      text: texts[6],
      expects: [
        { id: "name:田中さん", kind: "person_name", surface: "田中さん" },
        { id: "name:佐藤さん", kind: "person_name", surface: "佐藤さん" },
        { id: "name:山田さん", kind: "person_name", surface: "山田さん" },
        { id: "name:鈴木さん", kind: "person_name", surface: "鈴木さん" },
        {
          id: "bare:山本",
          kind: "person_name",
          surface: "山本",
          note: "ダミー列挙・敬称なし。検出は過剰寄りになりうる",
        },
        { id: "bare:伊藤", kind: "person_name", surface: "伊藤", note: "同上" },
        { id: "bare:渡辺", kind: "person_name", surface: "渡辺", note: "同上" },
        {
          id: "kw:給与言及",
          kind: "keyword",
          surface: "給与",
          note: "否定文脈でもヒットしうる",
        },
      ],
    },
    {
      id: "8",
      title: "ソースコード・秘密情報",
      text: texts[7],
      expects: [
        { id: "kw:トークン", kind: "keyword", surface: "トークン" },
        { id: "kw:APIキー", kind: "keyword", surface: "APIキー" },
        { id: "kw:パスワード", kind: "keyword", surface: "パスワード" },
        {
          id: "dbuser:app_development",
          kind: "login_id",
          surface: "app_development",
        },
        {
          id: "topic:secrets",
          kind: "topic",
          needles: ["GitHub Secrets", "Secret Manager", ".env"],
        },
      ],
    },
    {
      id: "9",
      title: "人事・組織情報",
      text: texts[8],
      expects: [
        { id: "name:高橋直樹さん", kind: "person_name", surface: "高橋直樹さん" },
        { id: "kw:査定?", kind: "topic", needles: ["評価", "昇給", "査定"] },
        {
          id: "hr:内示異動",
          kind: "topic",
          needles: ["内示", "異動", "昇進", "リーダー"],
        },
        {
          id: "org:採用予算",
          kind: "topic",
          needles: ["採用", "予算", "組織変更"],
        },
      ],
    },
    {
      id: "10",
      title: "混在実戦型",
      text: texts[9],
      expects: [
        { id: "name:田中さん", kind: "person_name", surface: "田中さん" },
        { id: "name:佐々木花子さん", kind: "person_name", surface: "佐々木花子さん" },
        { id: "name:佐々木さん", kind: "person_name", surface: "佐々木さん" },
        {
          id: "kw:メール電話言及",
          kind: "topic",
          needles: ["メールアドレス", "電話番号"],
        },
        { id: "kw:認証情報", kind: "keyword", surface: "認証情報" },
        { id: "kw:パスワード", kind: "keyword", surface: "パスワード" },
        {
          id: "unpub:10/20",
          kind: "topic",
          needles: ["10月20日", "経営会議"],
        },
        {
          id: "price:10万",
          kind: "topic",
          needles: ["月額10万円", "10万円", "料金"],
        },
        {
          id: "customer:オレンジテック",
          kind: "topic",
          needles: ["オレンジテック", "顧客情報"],
        },
        {
          id: "sys:AWS",
          kind: "topic",
          needles: ["AWS", "構成図", "接続情報"],
        },
      ],
    },
  ];
}

function normName(s: string): string {
  return s.replace(/(さん|くん|ちゃん|様|氏)$/, "");
}

function scoreSet(
  set: SampleSet,
  names: string[],
  findings: { category: string; match: string; excerpt: string }[],
) {
  const nameNorms = new Set(names.map(normName));
  const nameRaw = new Set(names);
  const findingBlob = findings.map((f) => `${f.match}\n${f.excerpt}`).join("\n");
  const findingMatches = findings.map((f) => f.match);

  const rows = set.expects.map((e) => {
    let hit = false;
    let how = "";
    switch (e.kind) {
      case "person_name": {
        const s = e.surface!;
        hit = nameRaw.has(s) || nameNorms.has(normName(s)) || [...nameRaw].some((n) => n.includes(s) || s.includes(n));
        // also honorific expansion: gold 伊藤健一 without さん
        if (!hit && !s.endsWith("さん")) {
          hit = nameRaw.has(s + "さん") || nameNorms.has(s);
        }
        how = hit ? "names" : "miss";
        break;
      }
      case "email":
        hit = findings.some((f) => f.category === "email" && f.match.includes(e.surface!));
        how = hit ? "email" : "miss";
        break;
      case "phone":
        hit = findings.some((f) => f.category === "phone" && f.match.replace(/\s/g, "").includes(e.surface!.replace(/\s/g, "")));
        how = hit ? "phone" : "miss";
        break;
      case "address":
      case "dob":
      case "login_id":
      case "customer_id":
        hit = findingBlob.includes(e.surface!) || names.some((n) => n.includes(e.surface!));
        how = hit ? "surface-in-findings" : "miss";
        break;
      case "keyword":
        hit = findingMatches.some((m) => m.includes(e.surface!)) || findingBlob.includes(e.surface!);
        how = hit ? "keyword" : "miss";
        break;
      case "topic":
        hit = (e.needles ?? []).some((n) => findingBlob.includes(n) || findingMatches.some((m) => m.includes(n)));
        how = hit ? "topic-needle" : "miss";
        break;
    }
    return { ...e, hit, how };
  });

  const hitN = rows.filter((r) => r.hit).length;
  return {
    id: set.id,
    title: set.title,
    hit: hitN,
    total: rows.length,
    rate: hitN / rows.length,
    names,
    findings: findings.map((f) => ({ category: f.category, match: f.match })),
    rows,
  };
}

const dir = setupIsolatedStoreEnv();
try {
  const md = readFileSync(DOC, "utf8");
  const texts = extractBlockquotes(md);
  if (texts.length < 10) {
    console.error(`expected >=10 blockquotes, got ${texts.length}`);
    process.exit(1);
  }
  const sets = buildSets(texts.slice(0, 10));
  const { detectNameCandidates, detectSensitiveByRules } = await import("../../web/src/lib/mask-check.ts");

  const results = sets.map((set) => {
    const names = detectNameCandidates(set.text);
    const findings = detectSensitiveByRules(set.text);
    return scoreSet(set, names, findings);
  });

  const allRows = results.flatMap((r) => r.rows.map((row) => ({ set: r.id, title: r.title, ...row })));
  const byKind: Record<string, { hit: number; total: number }> = {};
  for (const row of allRows) {
    byKind[row.kind] ??= { hit: 0, total: 0 };
    byKind[row.kind].total++;
    if (row.hit) byKind[row.kind].hit++;
  }

  console.log("\n=== セット別 ===");
  for (const r of results) {
    console.log(
      `セット${r.id} ${r.title}: ${r.hit}/${r.total} (${(r.rate * 100).toFixed(0)}%)`,
    );
    for (const row of r.rows) {
      console.log(`  ${row.hit ? "✓" : "✗"} [${row.kind}] ${row.id}${row.note ? ` — ${row.note}` : ""}`);
    }
    console.log(`  names: ${JSON.stringify(r.names)}`);
    console.log(`  findings: ${JSON.stringify(r.findings)}`);
  }

  console.log("\n=== 種別集計 ===");
  for (const [k, v] of Object.entries(byKind)) {
    console.log(`${k}: ${v.hit}/${v.total} (${((v.hit / v.total) * 100).toFixed(0)}%)`);
  }

  const overallHit = allRows.filter((r) => r.hit).length;
  console.log(`\n全体: ${overallHit}/${allRows.length} (${((overallHit / allRows.length) * 100).toFixed(0)}%)`);

  const out = {
    engine: "emther-rules-only (no AI phase)",
    overall: { hit: overallHit, total: allRows.length },
    byKind,
    results,
  };
  const outPath = join(ROOT, "out_security_samples_eval.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.error(`\nWrote ${outPath}`);
} finally {
  teardownIsolatedStoreEnv(dir);
}
