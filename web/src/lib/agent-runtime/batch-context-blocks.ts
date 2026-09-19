import { listCheckins, listReflectionNotes } from "@core/em-self-store";
import { listIssues } from "@core/issue-store";
import { listJournalEntries } from "@core/journal-store";
import { listEvents } from "@core/knowledge-store";
import { maskNames } from "@core/people-directory";
import { listAdoptedThemes } from "@core/theme-store";
import { charterFilledCount } from "@core/types";
import { computeOrgVitals } from "@/lib/vitals";
import { isJournalInBatchWindow, JOURNAL_BATCH_LIMIT } from "./journal-batch-window";
import { runs } from "./store";
import type { AgentRun } from "./types";

// 朝のサマリー・週次の状況蒸留という「バッチ処理専用」の文脈ブロック。呼び出しタイミングが
// 日1回・週1回程度で、buildSystemPrompt（context-blocks.ts）からはrun.originに応じて
// 条件付きで呼ばれるだけの、毎ターン共通の文脈ブロックとは性質が異なるため別ファイルに分けている。

const MORNING_YIELD_LIMIT = 15;
const MORNING_ERROR_LIMIT = 10;
const MORNING_CHARTER_ISSUE_LIMIT = 15;

// 朝サマリーの材料は run.task に載せない（巨大 task で相談履歴が壊れる・U13 と同型）。
// origin=auto-summary のときシステムプロンプトへ動的注入する。再開（decideRun）でも
// origin 判定だけで再注入するため、「続けて」だけでは材料が消えない。
export function buildMorningSummaryContextBlock(): string {
  const vitals = computeOrgVitals();
  const issues = listIssues();
  const allRuns = [...runs.values()];

  const omitRun = (run: AgentRun) => {
    if (run.consultedBy) return true;
    if (run.triageStatus === "dismissed") return true;
    // docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。
    if (run.archivedAt) return true;
    return issues.some((i) => i.agentRunId === run.id && i.archived);
  };

  const yieldRuns = allRuns
    .filter((r) => r.status === "yield" && !omitRun(r))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MORNING_YIELD_LIMIT);
  const errorRuns = allRuns
    .filter((r) => r.status === "error" && !omitRun(r))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MORNING_ERROR_LIMIT);
  const unchartered = issues
    .filter((i) => !i.parentId && !i.archived && i.status !== "done" && charterFilledCount(i.charter) < 3)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MORNING_CHARTER_ISSUE_LIMIT);

  const teamLines =
    vitals.teams.length > 0
      ? vitals.teams.map((t) => `- ${t.teamName}: ${t.label}（${t.status}）— ${t.reason}`)
      : ["- （チーム未登録）"];
  const coverage = vitals.oneOnOneCoverage;
  const coverageStatusLabel =
    coverage.status === "good"
      ? "安定"
      : coverage.status === "warn"
        ? "やや注意"
        : coverage.status === "bad"
          ? "要注意"
          : "評価不能";
  const coverageLine = `- 1on1 Coverage: ${coverageStatusLabel}（${coverage.status}） ${coverage.covered}/${coverage.total} — ${coverage.reason}`;

  const yieldLines =
    yieldRuns.length > 0
      ? yieldRuns.map((r) => {
          const reason = r.yieldRequest?.reason?.slice(0, 120) ?? "(理由なし)";
          const kind = r.yieldRequest?.kind ? ` [${r.yieldRequest.kind}]` : "";
          return `- [${r.id}] ${r.agentName}${kind}: ${reason}`;
        })
      : ["- （判断待ちの Yield なし）"];
  const errorLines =
    errorRuns.length > 0
      ? errorRuns.map((r) => `- [${r.id}] ${r.agentName}: ${r.task.slice(0, 100)}`)
      : ["- （エラー状態の Run なし）"];
  const charterLines =
    unchartered.length > 0
      ? unchartered.map((i) => {
          const filled = charterFilledCount(i.charter);
          return `- [${i.id}] ${i.title}（Why/What/How ${filled}/3）`;
        })
      : ["- （Why/What/How 未整理の Issue なし）"];

  return maskNames(
    [
      "朝のサマリーの材料（このタスク専用。下記はシステムが業務データから組み立てたスナップショット。無視して「材料が無い」としないこと）:",
      "今日EMがまず確認・判断すべきことを優先度順に簡潔に整理し、proposalブロックで結論を出してください。",
      "",
      "【Team Vitals】",
      ...teamLines,
      "",
      "【1on1 Coverage】",
      coverageLine,
      "",
      "【判断待ち Yield】",
      ...yieldLines,
      "",
      "【エラーの Agent Run】",
      ...errorLines,
      "",
      "【Why/What/How 未整理の Issue】",
      ...charterLines,
    ].join("\n"),
  );
}

// ユーザー要望「提案はJournal1回ごとに毎回検討するのではなく、一定期間分をまとめて
// 解釈する」対応。個別1件ずつの反応（旧auto-anomalyの即時トリガー）ではなく、
// 前回カバー以降（最大7日）のJournalをまとめて読み、単発では見えない繰り返しや複数
// エントリにまたがるパターンを優先して拾わせる。origin=auto-journal-batchのとき
// システムプロンプトへ動的注入する（材料はrun.taskに載せない。理由はbuildDistillationContextBlockと同じ）。
export function buildJournalBatchContextBlock(): string {
  const journals = listJournalEntries()
    .filter((e) => isJournalInBatchWindow(e.createdAt))
    .slice(0, JOURNAL_BATCH_LIMIT);

  const journalLines =
    journals.length > 0
      ? journals.map((e) => {
          const meta = `urgency=${e.urgency} sentiment=${e.sentiment}${e.tags.length ? ` tags=${e.tags.join(",")}` : ""}`;
          return `- [${e.id}] (${meta}) ${e.rawText.slice(0, 200)}`;
        })
      : ["- （前回解釈以降のJournalなし）"];

  return maskNames(
    [
      "Journal集約解釈の材料（このタスク専用。1件ごとに個別反応するのではなく、直近のJournalをまとめて読み、単発では見えない繰り返しや複数エントリにまたがるパターンから見える問題を優先すること）:",
      // docs/3rd_pivot_version/pivot.md
      "Suggestの前に Expand（別解釈・別仮説・不足情報・別問題設定）と Challenge（前提・本当に解くべき問題か）を経ること。入力の言い換えや一般論の羅列で終わらせないこと。",
      "個別の一時的な感情の吐露など、単体でもまとめても追跡不要なものは無理に提案化しないこと。既に把握済みで動きのある提案・Issueと重複する内容は、新規提案化ではなく監視継続（recommendation: watch）にとどめること（既存の提案・Issueは他の注入材料で確認できます）。",
      "問題設定が未確定で追加の観測・確認が先の場合も recommendation: watch とし、次に確認すべき点を advice に書くこと（解決策を無理に出さなくてよい）。",
      "独立した複数の問題が見つかった場合は、無理に1件へまとめず proposal の issueCandidates に分けてください。",
      "",
      "【前回解釈以降のJournal（最大7日・最大60件）】",
      ...journalLines,
    ].join("\n"),
  );
}

const DISTILL_JOURNAL_LIMIT = 25;
const DISTILL_ISSUE_LIMIT = 20;

// docs/knowledge_distillation.md。蒸留の材料は run.task に載せない（巨大な task だと
// /api/agents 全件取得が重くなり、相談タブの履歴に載らない／開けない不具合の原因になる）。
// origin=auto-distill のときシステムプロンプトへ動的注入する。
export function buildDistillationContextBlock(): string {
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const journals = listJournalEntries()
    .filter((e) => e.createdAt >= since)
    .slice(0, DISTILL_JOURNAL_LIMIT);
  const openIssues = listIssues()
    .filter((i) => !i.archived && i.status !== "done")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, DISTILL_ISSUE_LIMIT);
  const adopted = listAdoptedThemes().slice(0, 10);

  const journalLines =
    journals.length > 0
      ? journals.map((e) => {
          const snippet = (e.summary || e.rawText).slice(0, 160);
          return `- [${e.id}] ${snippet}${e.tags.length ? `（タグ: ${e.tags.join(", ")}）` : ""}`;
        })
      : ["- （直近30日のJournalなし）"];
  const issueLines =
    openIssues.length > 0
      ? openIssues.map((i) => {
          const why = i.charter.why ? ` Why: ${i.charter.why.slice(0, 80)}` : "";
          return `- [${i.id}] ${i.title}${why}`;
        })
      : ["- （未完了のIssueなし）"];
  const themeLines =
    adopted.length > 0
      ? adopted.map((t) => `- ${t.title}: ${t.summary.slice(0, 120)}`)
      : ["- （採用済みテーマなし）"];

  return [
    "状況蒸留の材料（このタスク専用。個別1件対応ではなく、繰り返しや横断から見える上段の解釈を出すこと）:",
    "proposalブロックでは全体の見立て（結論・参照ファクト・判断ロジック・棄却した代替案）を述べてください。",
    "加えて、採用候補となるテーマを themes ブロックで1〜5件出してください（無ければ空配列でも可）。",
    "各テーマには title / summary（根本課題の見立て）/ rationale（なぜこの結果に至ったか）/ facts（根拠）を必須とし、任意で rootCause・suggestedDirection・evidenceJournalIds・evidenceIssueIds（下記一覧のID）を付けてください。",
    "```themes",
    '[{ "title": "…", "summary": "…", "rationale": "…", "facts": ["…"], "rootCause": "…", "suggestedDirection": "…", "evidenceJournalIds": [], "evidenceIssueIds": [] }]',
    "```",
    "",
    "【直近Journal（最大25件）】",
    ...journalLines,
    "",
    "【未完了Issue（最大20件）】",
    ...issueLines,
    "",
    "【既に採用されているテーマ解釈】",
    ...themeLines,
  ].join("\n");
}

const GROW_CHECKIN_LIMIT = 8;
const GROW_NOTE_LIMIT = 10;
const GROW_INTERPRETATION_LIMIT = 15;
const GROW_DECISION_LOG_LIMIT = 10;

// docs/2nd_pivot_version.md Phase 8。pivot_policy.mdの5番目のAI役割「Grow」（EM自身の
// 学びの提示）の材料。自己申告（チェックイン・KPTメモ）だけでは本人が既に関心を持つ点の
// 増幅にとどまるため、組織側の観測・解釈（長期解釈イベント・相談での判断ログ）も横断し、
// EM自身では気づきにくい繰り返しのパターンや盲点を示せるようにする。
// 材料の現場がエンジニア組織でも、学び候補を開発実務に閉じ込めず、経営・マネジメント等の
// 隣接分野も含めて「EMとして視点を拡げる」ための判断材料にする（ユーザー要望 2026-09-17）。
// origin=auto-growのときシステムプロンプトへ動的注入する。
export function buildGrowContextBlock(): string {
  const checkins = listCheckins().slice(0, GROW_CHECKIN_LIMIT);
  const notes = listReflectionNotes();
  const problemNotes = notes.filter((n) => n.type === "problem").slice(0, GROW_NOTE_LIMIT);
  const tryNotes = notes.filter((n) => n.type === "try").slice(0, GROW_NOTE_LIMIT);
  const interpretations = listEvents({ kind: "interpretation" }).slice(0, GROW_INTERPRETATION_LIMIT);

  const decisionLines: string[] = [];
  for (const run of [...runs.values()].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (decisionLines.length >= GROW_DECISION_LOG_LIMIT) break;
    const metaInput = [...run.log].reverse().find((l) => l.channel === "meta" && l.text.startsWith("EMからの入力:"));
    if (metaInput) decisionLines.push(`- [${run.agentName}] ${metaInput.text.slice(0, 160)}`);
  }

  const checkinLines =
    checkins.length > 0
      ? checkins.map((c) => {
          const dateLabel = new Date(c.createdAt).toLocaleDateString("ja-JP");
          const noteSuffix = c.note ? ` — ${c.note.slice(0, 80)}` : "";
          return `- ${dateLabel}: mood=${c.mood} energy=${c.energy} stress=${c.stress}${noteSuffix}`;
        })
      : ["- （チェックインの記録なし）"];
  const problemLines =
    problemNotes.length > 0 ? problemNotes.map((n) => `- ${n.text.slice(0, 160)}`) : ["- （Problemメモなし）"];
  const tryLines = tryNotes.length > 0 ? tryNotes.map((n) => `- ${n.text.slice(0, 160)}`) : ["- （Tryメモなし）"];
  const interpretationLines =
    interpretations.length > 0
      ? interpretations.map((e) => `- ${(e.summary || e.text).slice(0, 160)}`)
      : ["- （組織側の長期解釈なし）"];
  const decisionLinesOut = decisionLines.length > 0 ? decisionLines : ["- （相談での判断ログなし）"];

  return maskNames(
    [
      "学びの提案（Grow）の材料（このタスク専用。組織の観測・解釈とEM自身の振り返りを横断し、EM自身が気づきにくい繰り返しのパターンや盲点を示すこと。個別1件への対応ではなく、繰り返しや横断から見える傾向を優先すること。目的はEMとして視点を拡げること）:",
      "これは評価ではなく判断材料の提示です。「これを学ぶべき」という断定ではなく、「こういう学びが参考になりそうです」「〇〇を調べてみるのはどうでしょうか」という形で示してください。",
      "自己申告（チェックイン・KPTメモ）だけで導ける範囲に留めず、組織側の観測・解釈と突き合わせて初めて見える点を優先してください。材料が乏しい場合は無理に3件出さず、1件でも構いません。",
      "材料の現場がエンジニアリング組織であっても、学びの候補をエンジニアリング実務・開発プロセスの枠に閉じ込めないでください。同じパターンに対し、経営・事業・組織設計・マネジメント・リーダーシップ・コーチング・心理・他業種のマネジメントなど隣接分野からの類推も含め、EMとして視点を拡げる材料にしてください。複数件出す場合は、少なくとも1件はエンジニアリング実務以外の分野からの視点を含めてください。",
      "参考として挙げる学びのトピックについて、実務書・解説記事等の二次資料は日本語のものを優先してください。理論の提唱者による原著・原典（一次資料）については、英語であっても構わず優先的に触れてください。書籍の正式なタイトルや出版社名などの正確性を保証できない場合は、トピック名・著者名・理論名の範囲に留め、正確なタイトルの特定はEM自身の検索に委ねてください。",
      "各参考トピックには、実在すると確信できる場合に限りurl（Wikipedia記事・公式サイト・出版社の書籍ページ等）を付けてください。存在するか確信が持てないURLは絶対に作り出さないでください（不正確なリンクを提示するくらいなら省略した方がよいです）。urlを省略した場合、アプリ側がトピック名でWeb検索して直リンクを後追い補完しようとします。それでも見つからない場合はEM側の画面で検索リンクが表示されます。",
      "",
      "grow_suggestionsブロックで1〜3件出力してください（無理に3件埋めなくてよい）。各要素は title（学びの見出し）/ rationale（なぜこの学びが参考になりそうかの説明。観測された繰り返しパターンに触れること）/ evidenceSummary（根拠となったデータの要約、任意）/ references（参考トピックの配列。各要素は topic / isPrimarySource（true=原著・原典、false=二次資料）/ note（任意の補足）/ url（実在を確信できる場合のみのhttp(s)リンク、任意））を持たせてください。",
      "```grow_suggestions",
      '[{ "title": "…", "rationale": "…", "evidenceSummary": "…", "references": [{ "topic": "…", "isPrimarySource": false, "note": "…", "url": "https://…" }] }]',
      "```",
      "",
      "【EM自己申告: 直近のチェックイン（mood/energy/stress、1〜5）】",
      ...checkinLines,
      "",
      "【EM自己申告: 直近のProblemメモ】",
      ...problemLines,
      "",
      "【EM自己申告: 直近のTryメモ】",
      ...tryLines,
      "",
      "【組織側: 長期的な解釈の蓄積】",
      ...interpretationLines,
      "",
      "【組織側: 相談でのEMの判断ログ（直近）】",
      ...decisionLinesOut,
    ].join("\n"),
  );
}
