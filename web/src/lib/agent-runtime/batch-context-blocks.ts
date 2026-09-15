import { listIssues } from "@/lib/issue-store";
import { listJournalEntries } from "@/lib/journal-store";
import { maskNames } from "@/lib/people-directory";
import { listAdoptedThemes } from "@/lib/theme-store";
import { charterFilledCount } from "@/lib/types";
import { computeOrgVitals } from "@/lib/vitals";
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
