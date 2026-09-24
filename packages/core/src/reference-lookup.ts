import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataFilePath } from "./persistence";
import { getRulesAndConstraints } from "./settings-store";

// Grow参考リンク解決用。組織固有データを含まない汎用トピック文字列だけを渡し、
// Claude CLIの `--tools "WebSearch"` で WebSearch のみを構造的に許可する。
// 実機検証で確認した事実（Claude CLI）:
// - `--tools "WebSearch"`は、他のツール（Bash/Read/Write/Edit等）を一切選択肢に含めない
// 「構造的な制約」であり、既存の`--tools ""`と同じ強さの保証を保ったまま、この1機能だけを
// 開放できる。
// - ただし非対話（-p）モードは既定でツール承認を自動拒否するため、`--permission-mode
// bypassPermissions`を明示しないとWebSearch自体が実行されない（実機で
// `permission_denials: [{ tool_name: "WebSearch", ... }]`を確認済み）。
// これはこのモジュール専用の、AgentRunや組織のコンテキスト注入と一切繋がっていない孤立した
// CLI呼び出しであり、送信するのはGrowのreferences[].topic（学びのテーマ・理論名・著者名等の
// 一般知識、組織固有の情報を含まない）だけである。呼び出し元
// （em-growth-store.tsのenrichGrowSuggestionReferences）はfire-and-forgetで呼ぶため、
// ここでの失敗・タイムアウト・予算超過はすべて「見つからなかった」として吸収し、例外を
// 伝播させない（呼び出し元のrun完了処理をブロックしないため）。
// （Cursor CLI版の追加）:
// Claude Code CLIを許可していないユーザーのために、Cursor CLI（cursor-agent）でも同等の
// 「WebSearch/WebFetchだけを許可し、他の全ツールを拒否する」制約を実現できないか実機検証した。
// cursor-agentには`--tools`相当の「ツールカテゴリ全体の許可リスト」フラグが無いため、代わりに
// Cursor CLIのHooks機能（`.cursor/hooks.json`のpreToolUseフック）でdeny-by-default
// （WebSearch/WebFetch以外は問答無用でdeny）を実装し、専用の空ワークスペースディレクトリ
// （CURSOR_WEBSEARCH_WORKSPACE_DIR）に配置した。実機検証で以下を確認済み:
// - `--mode ask`かつ`--force`無しだと、hookが`allow`を返してもWebSearch自体が
// 「User Rejected」で実行されない（ask/print既定の承認层がhookのallowより先に働く）。
// - `--force`（Force allow commands **unless explicitly denied**）を付けると、hookが
// `allow`を返したWebSearch/WebFetchは実行され、hookが`deny`を返したRead/Write/Shellは
// `--force`があっても実行されない（`--force`はhookのdenyを上書きしない）ことを、
// Read・Write・Shellそれぞれについて個別に実機確認済み（モデルの応答に
// 「Read/ShellツールがpreToolUse hookによりブロックされました」という報告が明示的に出た）。
// - Autoモデルルーティングだと組み込みWebSearch/WebFetchに対してpreToolUseフック自体が
// 発火しない既知バグがCursor側フォーラムで報告されているため、named model（既存の
// cursor-agentフォールバックと同じ"gpt-5.2"）を明示指定する。
// この設計はhooks機構自体の堅牢性（deny優先・failClosed）に依存しており、Claudeの
// `--tools`（ツールがそもそも存在しない）ほど構造的に強い保証ではないが、実機での
// Read/Write/Shell拒否・WebSearch許可を確認した上で採用する。
// Settings「CLI優先順位」（cliOrder）に基づき、claude/cursorのうち
// cliOrderで最初に許可されているものを使う（詳細はfindReferenceUrls内のコメント参照）。
// agy（Gemini CLI）はヘッドレス実行中のツール承認要求を構造的に自動拒否する仕様のため
// WebSearch等のツールをそもそも実行できず、代替実装はしていない。
// 日本語優先をプロンプトで強く指示していても、WebSearchが英語版Wikipedia（例:
// en.wikipedia.org）のURLを返すことがある。Wikipediaはページ間の多言語対応関係を
// MediaWikiの公開API（action=query&prop=langlinks、認証不要）で機械的に確認できるため、
// 返ってきたURLがwikipedia.orgのページである場合に限り、日本語版が実在するかをこのAPIで
// 確認し、あれば日本語版のURLに差し替える（preferJapaneseWikipedia）。これはWebSearchの
// ような汎用ツール呼び出しではなく、「そのWikipediaページに対応する日本語版があるか」を
// 聞くだけの単純なfetchであり、送信内容も既にWebSearch結果として得られたURL由来の
// ページタイトルのみ（組織固有の情報を含まない）なので、本モジュールの孤立性方針とは
// 矛盾しない。取得失敗時は元のURL（英語版等）をそのまま使う。

export type ReferenceLookupTopic = {
  topic: string;
  // 一次資料（true）は日本語が無ければ英語の原典も許容、二次資料（false）は日本語限定で
  // 検索する旨を検索エージェントへのプロンプトに反映するために使う。
  isPrimarySource: boolean;
  note?: string;
};

export type ReferenceLookupResult = {
  topic: string;
  url?: string;
};

// プロンプトでの指示（後述）に加え、モデルが指示に反した
// 場合の保険として、よく知られた有料学術ジャーナル・論文データベースのドメインへのURLは
// 機械的に破棄する（見つからなかった扱いにし、EM側の画面では検索リンクへフォールバックする）。
// 網羅的な検出ではなく「よくあるものを機械的に弾く」defense-in-depthである点に注意。
const PAYWALLED_ACADEMIC_HOST_SUFFIXES = [
  "sciencedirect.com",
  "springer.com",
  "link.springer.com",
  "onlinelibrary.wiley.com",
  "ieeexplore.ieee.org",
  "dl.acm.org",
  "jstor.org",
  "tandfonline.com",
  "journals.sagepub.com",
  "academic.oup.com",
  "nature.com",
  "cambridge.org",
  "elsevier.com",
  "psycnet.apa.org",
  "proquest.com",
  "ebscohost.com",
];

function isLikelyPaywalledAcademicUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return PAYWALLED_ACADEMIC_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

// WebSearchはツール呼び出しを複数回行うことがあるため、単純なAPI fetchより長めに待つ。
// 予算上限（--max-budget-usd）が主たる歯止めであり、これは異常終了時の保険。
const LOOKUP_TIMEOUT_MS = 90_000;

// agent-runtime/context-blocks.tsのperTurnBudgetUsdArgと同じ考え方だが、循環import回避と
// このモジュールの孤立性を保つためにここで複製する（em-growth-store.tsのisoWeekKeyと同じ
// 既存パターン）。
function lookupBudgetUsdArg(): string {
  const n = getRulesAndConstraints().perTurnBudgetUsd;
  const usd = typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0.5;
  return String(Math.max(0.01, usd));
}

function buildPrompt(topics: ReferenceLookupTopic[]): string {
  const lines = topics.map((t, i) => {
    const kind = t.isPrimarySource
      ? "一次資料（理論の提唱者による原著・原典）。まず日本語の解説・要約記事が無いか探し、それでも見つからない場合に限り英語の原典を検索してよい"
      : "二次資料（実務書・解説記事等）。日本語のページに限定して検索する。日本語で見つからなければ無理に埋めなくてよい";
    const noteText = t.note ? ` 補足情報: ${t.note}` : "";
    return `${i + 1}. トピック: 「${t.topic}」（${kind}）${noteText}`;
  });
  return [
    "あなたはWeb検索専用のサブエージェントです。組織固有の情報は一切与えられていません。",
    "以下に挙げる、学びのテーマ・理論名・著者名（一般知識）それぞれについて、WebSearchツールを使って",
    "実在する参考リンク（解説記事・書籍紹介ページ・公式サイト・Wikipedia記事等）を1つずつ探してください。",
    "",
    ...lines,
    "",
    "重要な制約:",
    "- 実際にWebSearchツールの結果に含まれていたURLだけを使ってください。検索結果に無いURLを記憶や推測で作り出すことは絶対にしないでください。",
    "- 日本語話者向けのプロダクトなので、日本語の情報を強く優先してください。英語のページは、日本語で十分な情報が見つからなかった場合の最終手段としてのみ使ってください。",
    "- 有料の論文データベース・学術ジャーナルサイト（例: ScienceDirect, SpringerLink, Wiley Online Library, IEEE Xplore, ACM Digital Library, JSTOR, Taylor & Francis Online, SAGE Journals, Oxford Academic, Nature, Elsevier, APA PsycNET等）は避けてください。無料で全文または十分な要旨が読めるページ（Wikipedia、著者・出版社の公式サイト、大学や公的機関の解説ページ、企業やメディアの無料解説記事等）を優先してください。",
    "- 検索しても、日本語かつ無料で読める適切なリンクが見つからないトピックは、無理にurlを埋めずnullにしてください（英語ページや有料ページを提示するくらいなら無しの方がよいです）。",
    "- 各トピックにつき検索は1〜2回程度に留めてください。",
    "",
    "最後に、次の形式のフェンス付きJSONブロックだけを出力してください（前後に説明文は不要です）。",
    "indexには上の番号（1始まり）だけを、urlフィールドの値には見つけたリンクの説明文などを混ぜず、URLだけを入れてください:",
    "```url_lookup",
    '[{ "index": 1, "url": "https://…" }]',
    "```",
  ].join("\n");
}

// 検索エージェントに「入力と同じトピック文字列を返せ」と指示しても、周辺の説明文まで
// 巻き込んで返す・表記ゆれで完全一致しない、といった揺れが実機で確認されたため（例:
// topicが「「〇〇」（二次資料…）」のように行全体を丸ごと返してくることがあった）、
// トピック文字列での突き合わせはせず、プロンプトで明示した1始まりのindexで機械的に
// 突き合わせる（文字列マッチングより堅牢）。
type IndexedLookupResult = { index: number; url?: string };

function extractLookupResults(resultText: string): IndexedLookupResult[] {
  const match = resultText.match(/```url_lookup\s*\n?([\s\S]*?)```/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((r) => {
        if (!r || typeof r !== "object") return undefined;
        const indexRaw = (r as { index?: unknown }).index;
        const index = typeof indexRaw === "number" && Number.isInteger(indexRaw) && indexRaw >= 1 ? indexRaw : undefined;
        if (index === undefined) return undefined;
        const urlRaw = (r as { url?: unknown }).url;
        const httpUrl = typeof urlRaw === "string" && /^https?:\/\/\S+$/i.test(urlRaw.trim()) ? urlRaw.trim() : undefined;
        const url = httpUrl && !isLikelyPaywalledAcademicUrl(httpUrl) ? httpUrl : undefined;
        return { index, ...(url ? { url } : {}) };
      })
      .filter((r): r is IndexedLookupResult => !!r);
  } catch {
    return [];
  }
}

// `https://en.wikipedia.org/wiki/Foo_bar` のようなURLから言語コードとページタイトルを
// 取り出す。`ja.wikipedia.org`（既に日本語版）や、Wikipedia以外のURL、Special:等の
// 記事ページでないURLはundefinedを返し、呼び出し元は元のURLをそのまま使う。
const WIKIPEDIA_HOSTNAME_PATTERN = /^([a-z0-9-]+)\.wikipedia\.org$/i;
const WIKIPEDIA_LANGLINKS_TIMEOUT_MS = 5_000;

function parseWikipediaArticleUrl(url: string): { lang: string; title: string } | undefined {
  try {
    const parsed = new URL(url);
    const hostMatch = parsed.hostname.toLowerCase().match(WIKIPEDIA_HOSTNAME_PATTERN);
    if (!hostMatch) return undefined;
    const lang = hostMatch[1];
    const pathMatch = parsed.pathname.match(/^\/wiki\/([^/]+)$/);
    if (!pathMatch) return undefined;
    const title = decodeURIComponent(pathMatch[1].split("#")[0]);
    if (!title || title.includes(":")) return undefined; // Special:/Category:等の非記事ページは対象外
    return { lang, title };
  } catch {
    return undefined;
  }
}

// MediaWiki公開API（認証不要）で、`lang`版の`title`記事に対応する日本語版があるかを調べる。
// あれば`https://ja.wikipedia.org/wiki/…`のURLを返し、無い・取得失敗時はundefinedを返す
// （呼び出し元は元のURLを保持すればよいので、例外は伝播させない）。
async function findJapaneseWikipediaUrl(lang: string, title: string): Promise<string | undefined> {
  if (lang === "ja") return undefined;
  const endpoint = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
    title,
  )}&prop=langlinks&lllang=ja&format=json&formatversion=2`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WIKIPEDIA_LANGLINKS_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, { signal: controller.signal });
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      query?: { pages?: Array<{ langlinks?: Array<{ lang?: string; title?: string }> }> };
    };
    const jaTitle = data.query?.pages?.[0]?.langlinks?.find((l) => l.lang === "ja")?.title;
    if (!jaTitle) return undefined;
    return `https://ja.wikipedia.org/wiki/${encodeURIComponent(jaTitle)}`;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

// findReferenceUrlsが返す結果それぞれについて、urlがWikipediaの非日本語版記事なら日本語版に
// 差し替える。Wikipedia以外のURL・既に日本語版のURL・urlが無い結果はAPIを呼ばずそのまま返す。
async function preferJapaneseWikipedia(results: ReferenceLookupResult[]): Promise<ReferenceLookupResult[]> {
  return Promise.all(
    results.map(async (r) => {
      if (!r.url) return r;
      const article = parseWikipediaArticleUrl(r.url);
      if (!article) return r;
      const jaUrl = await findJapaneseWikipediaUrl(article.lang, article.title);
      return jaUrl ? { ...r, url: jaUrl } : r;
    }),
  );
}

// claude/cursor-agentどちらも`--output-format json`で単一JSON（{ result: "…" }）を返す
// 共通仕様なので、spawn～stdout収集～タイムアウトの機構は共通化する。
function spawnAndCollectStdout(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      resolve("");
      return;
    }

    let stdout = "";
    let settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish("");
    }, LOOKUP_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("close", () => finish(stdout));
    child.on("error", () => finish(""));
  });
}

// claude CLIを`--tools "WebSearch"` + `--permission-mode bypassPermissions`で起動する。
// WebSearch以外のツールは選択肢にすら無いため、ファイル・シェルへのアクセスは構造的に不可能。
// 設定でtierが指定されていれば`--model`に渡し、
// 未設定（""）ならclaude CLIの既定モデルのまま動く（既存の挙動を変えない）。
function runClaudeWebSearchLookup(prompt: string): Promise<string> {
  const tier = getRulesAndConstraints().referenceLookupClaudeModel;
  const args = [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--tools",
    "WebSearch",
    "--permission-mode",
    "bypassPermissions",
    "--max-budget-usd",
    lookupBudgetUsdArg(),
    ...(tier ? ["--model", tier] : []),
  ];
  return spawnAndCollectStdout("claude", args);
}

// cursor-agentの起動に使う既定モデル。Autoモデルルーティングだと組み込みWebSearch/WebFetchに
// 対してpreToolUseフックが発火しない既知バグが報告されているため、named modelを明示指定する
// （既存のcursor-agentフォールバック実装＝cli-runners/cursor.tsと同じモデルで揃える）。
const CURSOR_WEBSEARCH_DEFAULT_MODEL = "gpt-5.2";

// 設定（`/api/settings/rules`）側で保存時に"auto"を拒否しているが、それでも万一
// "auto"が設定値に残っていた場合の保険として、ここでも弾いて既定モデルへフォールバックする
// （defense-in-depth。preToolUseフックが発火しないままWebSearchも実行できなくなる事態を防ぐ）。
function resolveCursorWebSearchModel(): string {
  const configured = getRulesAndConstraints().referenceLookupCursorModel.trim();
  if (!configured || configured.toLowerCase() === "auto") return CURSOR_WEBSEARCH_DEFAULT_MODEL;
  return configured;
}

// この機能専用の空ワークスペース。既存のcli-runners/cursor.tsが使うCURSOR_WORKSPACE_DIR
// （フォールバック実行用、hooks無し）とは別のディレクトリにする。同じディレクトリに
// hooks.jsonを置くと、フォールバック実行の全ツール呼び出しまでdeny-by-defaultの対象に
// なってしまい、既存機能を壊すため。
const CURSOR_WEBSEARCH_WORKSPACE_DIR = dataFilePath("cursor-websearch-sandbox");

// preToolUseフックの入力JSONは`tool_name`フィールド（実機確認済み。例:
// `{"tool_name":"WebSearch","tool_input":{...},"hook_event_name":"preToolUse",...}`）に
// ツール種別が入っている。WebSearch/WebFetch以外は無条件でdenyする
// （deny-by-default。未知のツール名も安全側でdeny）。
const CURSOR_HOOK_SCRIPT = `#!/bin/bash
input=$(cat)
tool=$(echo "$input" | jq -r '.tool_name // empty' 2>/dev/null || echo "")
case "$tool" in
  WebSearch|WebFetch)
    echo '{ "permission": "allow" }'
    ;;
  *)
    echo '{ "permission": "deny", "agent_message": "Blocked by policy: only WebSearch/WebFetch are permitted in this isolated lookup task." }'
    ;;
esac
exit 0
`;

const CURSOR_HOOKS_JSON = `${JSON.stringify(
  {
    version: 1,
    hooks: {
      preToolUse: [
        {
          command: ".cursor/hooks/allow-websearch-only.sh",
          failClosed: true,
        },
      ],
    },
  },
  null,
  2,
)}\n`;

let cursorWebSearchSandboxReady = false;

// ワークスペースディレクトリと`.cursor/hooks.json`・フックスクリプトを用意する
// （初回のcursor-agent呼び出し時に1回だけ。冪等なので複数回呼んでも安全）。
function ensureCursorWebSearchSandbox(): void {
  if (cursorWebSearchSandboxReady) return;
  const hooksDir = join(CURSOR_WEBSEARCH_WORKSPACE_DIR, ".cursor", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(join(CURSOR_WEBSEARCH_WORKSPACE_DIR, ".cursor", "hooks.json"), CURSOR_HOOKS_JSON);
  const scriptPath = join(hooksDir, "allow-websearch-only.sh");
  writeFileSync(scriptPath, CURSOR_HOOK_SCRIPT);
  chmodSync(scriptPath, 0o755);
  cursorWebSearchSandboxReady = true;
}

// Cursor CLI（cursor-agent）を、専用サンドボックス＋WebSearch/WebFetch限定hooksで起動する。
// `--force`は「明示的にdenyされていない限り許可する」という意味で、hookのdenyを上書きしない
// ことを実機確認済み（Read/Write/Shellはhookのdenyでブロックされ、hookがallowするWebSearch/
// WebFetchだけが実際に実行される）。`--mode ask`は使わない（`--force`無しでは`--mode ask`
// 自体の既定承認層がhookのallowより先にWebSearchを拒否してしまうことを実機確認したため、
// このサンドボックス+hooksの組み合わせでは付けない）。
function runCursorWebSearchLookup(prompt: string): Promise<string> {
  ensureCursorWebSearchSandbox();
  const args = [
    "--print",
    "--trust",
    "--force",
    "--workspace",
    CURSOR_WEBSEARCH_WORKSPACE_DIR,
    "--output-format",
    "json",
    "--model",
    resolveCursorWebSearchModel(),
    prompt,
  ];
  return spawnAndCollectStdout("cursor-agent", args);
}

/**
 * 複数トピックをまとめて1回のCLI呼び出しでWebSearchさせる（呼び出し回数・コストを抑えるため、
 * Grow提案1件分の参照はまとめて渡す想定）。見つからなかった・エラー・タイムアウトの場合は
 * 該当トピックがそのまま結果配列から欠落する（＝呼び出し元は既存urlを保持すればよい）。
 */
export async function findReferenceUrls(topics: ReferenceLookupTopic[]): Promise<ReferenceLookupResult[]> {
  const valid = topics.filter((t) => t.topic.trim());
  if (valid.length === 0) return [];
  // Settings「CLI優先順位」（cliOrder）で
  // 例: cliOrderが["cursor","claude"]ならcursorを使い、["agy"]や["claude"]でclaudeを
  // 除外している設定ならこの機能は無効（見つからなかった扱いにし、EM側の画面は既存の
  // 検索リンクへフォールバックする。機能が丸ごと無効になるだけで、不正な動作にはならない）。
  // agy（Gemini CLI）はヘッドレス実行中のツール承認要求を構造的に自動拒否する仕様のため
  // WebSearch等のツールをそもそも実行できず、対応していない。
  const cliOrder = getRulesAndConstraints().cliOrder;
  const candidate = cliOrder.find((c) => c === "claude" || c === "cursor");
  if (!candidate) return [];
  try {
    const stdout = await (candidate === "claude" ? runClaudeWebSearchLookup(buildPrompt(valid)) : runCursorWebSearchLookup(buildPrompt(valid)));
    if (!stdout.trim()) return [];
    const parsed = JSON.parse(stdout) as { result?: unknown };
    if (typeof parsed.result !== "string") return [];
    const indexed = extractLookupResults(parsed.result);
    // indexはプロンプトで明示した1始まりの通し番号（valid配列の並び順と対応）。
    // 範囲外・重複はそのトピック行を「見つからなかった」扱いにする。
    const mapped = indexed
      .map((r) => {
        const topic = valid[r.index - 1]?.topic;
        if (!topic) return undefined;
        return { topic, ...(r.url ? { url: r.url } : {}) };
      })
      .filter((r): r is ReferenceLookupResult => !!r);
    return await preferJapaneseWikipedia(mapped);
  } catch {
    return [];
  }
}

/** 単一トピック向けの簡易ラッパー。 */
export async function findReferenceUrl(
  topic: string,
  opts: { isPrimarySource?: boolean; note?: string } = {},
): Promise<string | undefined> {
  const results = await findReferenceUrls([{ topic, isPrimarySource: opts.isPrimarySource ?? false, note: opts.note }]);
  return results.find((r) => r.topic === topic)?.url;
}
