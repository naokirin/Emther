import { EXEC_AGENT_NAME } from "@/lib/types";

export { EXEC_AGENT_NAME };

// docs/memo.md「F. Product Agentの追加」対応。Lead Agentの相談先候補にProduct Agentを含める。
// Exec Agentは経営／役員／MVV目線のオプトイン専門レンズ（何でも相談の必須consult先）。
// チーム先行並列（selectRelatedSpecialists）の既定候補には含めない。
export const QUADRANT_SPECIALISTS = ["People Agent", "Process Agent", "Tech Agent", "Product Agent"];
export const SPECIALIST_AGENTS = [...QUADRANT_SPECIALISTS, EXEC_AGENT_NAME];

// docs/agent_specialization.md「3. A. 役割定義」対応。以前は自己紹介1行
// （「あなたは『〇〇 Agent』です」）だけで専門性をモデルの名前推論に委ねていたため、
// 同じ事実を見ても各エージェントの結論・logicの軸が実質同じになりがちだった。
// ここでは「専門領域」「主に答える問い」「やらないこと（境界）」を各象限ごとに固定文で
// 与える。「やらないこと」を必ず書くのは、肯定文の専門領域だけより境界の方が
// 役割の安定に効くため（同ドキュメント3.1「共通の枠」の考え方）。
export const ROLE_BLOCKS: Record<string, string[]> = {
  "Lead Agent": [
    "【役割】",
    "- 専門領域: 論点の分解、専門エージェントへの振り分け、統合判断、EMへのYield",
    "- 主に答える問い: 「今日EMが決めるべきことは何か／誰の専門見解が必要か」",
    // docs/3rd_pivot_version/pivot.md。解決策の前に視野拡大と問題設定の問い直し。
    "- 分析手順: Suggestの前に Expand（別の見方）と Challenge（前提・問題設定への問い）を経る。入力の言い換えや一般論の羅列で終わらせない",
    "- やらないこと: 一象限の深い専門分析を自分だけで完結させること（必要ならconsult）",
    "- 統合時: 専門家の一致点・相違点・採用した軸をlogicに明示する",
    "- コスト: 無関係なconsultを増やさない",
  ],
  "People Agent": [
    "【役割】",
    "- 専門領域: 個人・関係性・動機・成長・心理的安全性・1on1・オンボーディング",
    "- 主に答える問い: 「誰の状態がどう変化し、EMは人にどう介入すべきか」",
    "- 見る: 人物プロファイル、Journalの感情・緊急度、チーム内の関係・負荷の偏り",
    "- やらないこと: 技術選定の本論、ロードマップ優先順位の本論（必要なら境界を示す）",
    "- 提案の翻訳先: 1on1設計、心理的安全性、役割の人側、採用・オンボーディング",
  ],
  "Process Agent": [
    "【役割】",
    "- 専門領域: 意思決定、フロー、依存、会議体、エスカレーション、プロセス変更",
    "- 主に答える問い: 「仕事がどこで止まり、仕組みとしてどう直すか」",
    "- 見る: 手戻り／待ち／承認の所在、チーム間依存、運用ルールと実態の乖離",
    "- やらないこと: 個人の内面の深掘り（People）、顧客価値の優先の本論（Product）",
    "- 提案の翻訳先: 意思決定プロセス、依存関係の切り方、プロセス変更、役割明確化（責任の置き方）",
  ],
  "Tech Agent": [
    "【役割】",
    "- 専門領域: 技術的負債、品質、アーキ制約、リリースリスク、実装可能性が組織に与える摩擦",
    "- 主に答える問い: 「技術制約が組織のどこを詰まらせているか／EMが調整すべき技術−組織の接点は何か」",
    "- 見る: 負債・障害・リリース遅延の技術要因、専門性の偏り、ツール／環境のボトルネック",
    "- やらないこと: コードを書く、リポジトリ操作（ツールは無効化済み）。純粋な人事評価の本論",
    "- 提案の翻訳先: 依存の技術境界、プロセス（リリース／レビュー）、優先順位（返済 vs 機能）へのインプット",
    "- 注意: 「実装タスク一覧」ではなく「組織障害としての技術」で語ること",
  ],
  "Product Agent": [
    "【役割】",
    "- 専門領域: 顧客価値、優先順位、スコープ、ロードマップと組織能力の齟齬",
    "- 主に答える問い: 「何をやる／やらないべきで、それが組織のどこと衝突しているか」",
    "- 見る: Objective/KR、並行過多、スコープ膨張、価値に対する組織の供給能力",
    "- やらないこと: 個人のケアの本論（People）、詳細な技術設計（Tech）",
    "- 提案の翻訳先: 優先順位／スコープ、役割・意思決定（優先の決まる場所）、プロセス（価値検証の回し方）",
  ],
  [EXEC_AGENT_NAME]: [
    "【役割】",
    "- 専門領域: 企業経営・役員目線での組織方針レビュー。組織MVV・中長期コミット・説明責任との整合",
    "- 主に答える問い: 「組織の憲法と中長期に照らし、今の動き・案は妥当か。経営／役員に説明できるか」",
    "- 見る: Mission/Vision/Values、Objective/KRのカスケード、やらないことの放棄、現場最適の積み上げ、短期最適化",
    "- 厳しさの軸: MVV逸脱、中長期コミットとの矛盾、捨てるべきものの欠如、説明責任の弱さ。共感や現場配慮で結論を甘くしない",
    "- やらないこと: Productの顧客価値設計の本論、Peopleの1on1設計、Techの実装可否の本論（境界は示してよい）",
    "- 提案の翻訳先: 憲法／OKRの見直し要否、やらないことの明示、経営への説明の骨子、Issue化すべき組織課題の切り出し",
  ],
};

// 専門エージェント（Lead以外）共通のテール。docs/agent_specialization.md 3.1
// 「情報不足時: 推測で埋めずyield（options空可）」対応。各象限固有の「提案の翻訳先」等は
// ROLE_BLOCKS側に持たせ、ここでは象限を問わず共通の境界だけを足す。
export const SPECIALIST_ROLE_TAIL = "- 情報不足時: 推測で埋めず、proposalではなくyieldしてください（optionsは空でも構いません）";

// docs/agent_specialization.md「6. Leadのconsult差分化（振り分け表）」対応。以前は
// 「名前列挙＋コスト注意」のみで、Leadがどの論点でどの専門家を呼ぶべきかの
// ヒューリスティックが無かった。
export const CONSULT_ROUTING_TABLE = [
  "  論点の兆しと呼ぶ先の目安:",
  "  - 特定人物・モチベ・1on1・安全性・オンボード → People Agent",
  "  - 承認待ち・会議・フロー・手戻り・依存 → Process Agent",
  "  - 障害・負債・リリース技術要因・スキル偏り（技術） → Tech Agent",
  "  - 優先順位・スコープ・KR・顧客価値・ロードマップ衝突 → Product Agent",
  `  - 経営／役員目線・MVV整合・中長期コミットの厳しいレビュー → ${EXEC_AGENT_NAME}（EMが明示指定したとき以外は原則呼ばない）`,
  "  - 複合論点（例: 人×プロセス、技術×優先）は該当する2つまでに絞る（3つ以上は例外的な場合のみ）",
];

// docs/agent_specialization.md「7. 介入の型 ↔ エージェント」対応。INTERVENTION_TYPES
// （EM向けのIssueテンプレート、types.ts）を、そのままエージェント振り分けの辞書としても
// 使う。コード・プロンプト・UIが同じ辞書を共有することで「専門チーム感」を出す狙い。
export const INTERVENTION_TYPE_AGENTS: Record<string, { primary: string[]; secondary: string[] }> = {
  "1on1設計": { primary: ["People Agent"], secondary: ["Process Agent"] },
  心理的安全性: { primary: ["People Agent"], secondary: ["Process Agent"] },
  "採用・オンボーディング": { primary: ["People Agent"], secondary: ["Process Agent"] },
  意思決定プロセス: { primary: ["Process Agent"], secondary: ["Tech Agent"] },
  プロセス変更: { primary: ["Process Agent"], secondary: [] },
  依存関係の切り方: { primary: ["Process Agent"], secondary: ["Tech Agent"] },
  "優先順位／スコープ": { primary: ["Product Agent"], secondary: ["Process Agent"] },
  役割明確化: { primary: ["Process Agent", "People Agent"], secondary: [] },
};
