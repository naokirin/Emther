import { describe, expect, it, vi } from "vitest";
import { parseOkrTextHeuristic, shouldPreferHeuristic } from "@/lib/okr-parse";

const MOCK_SAMPLE = [
  "# Objective 1：【Sales】オンライン書店の売上を昨対比150%にする",
  "",
  "- Key Result 1：新規ユーザー獲得施策のリリースが完了している",
  "    1. 初回クーポン",
  "    2. 紹介キャンペーン",
  "    3. SNS連携",
  "    4. SEO対策",
  "    5. リスティング広告",
  "- Key Result 2：レコメンドエンジンの精度が大幅に向上している",
  "    - ここはかなりムーンショットとして設定",
  "- Key Result 3：既存システムのパフォーマンス改善が完了している",
  "    1. データベースのインデックス最適化",
  "    2. キャッシュ層の導入",
  "- Key Result 4：システムエラーの発生件数を月1件以下に抑えられている",
  "    1. タイムアウト処理の見直し",
  "    2. リトライ制御の実装",
  "    3. エラー時の通知設定",
  "- Key Result 5：新しい検索エンジンの導入に向けた調査が完了している",
  "    - 検索精度向上に向けたドキュメント化",
  "    - 移行難易度が整理されている",
  "",
  "- Key Result 6：カート画面のUI刷新プロジェクトの1stリリースが完了している",
  "    - 既存画面の課題リストアップとデザイン策定完了",
  "    - ユーザーテストの実施と改善の完遂",
  "",
  "---",
  "",
  "# Objective 2：【Delivery】 配送プロセスを最適化する",
  "",
  "- Key Result 1：提携配送業者との連携を強化できている",
  "    - 9月時点で以下の方針が決定",
  "        - 即日配送エリアの拡大",
  "        - 送料の見直し",
  "- Key Result 2：倉庫内オペレーションの効率化が図られている",
  "    - ピッキング作業の時間が20%短縮されている",
  "- Key Result 3：顧客への配送状況通知システムが整備されている",
  "    - LINE通知の連携完了",
  "    - メールテンプレートの刷新",
  "    - 追跡画面のUI改善",
  "",
  "---",
  "",
  "# Objective 3：【Team】 開発チームの生産性とモチベーションを高める",
  "",
  "- Key Result 1：オンボーディングプロセスを改善できている",
  "    - 新入社員のキャッチアップ期間が2週間に短縮",
  "- Key Result 2：技術的負債を定期的に返済する仕組みを確立している",
  "    - スプリントの20%をリファクタリングに割り当てる",
  "- Key Result 3：チームメンバーのスキルアップを支援できている",
  "    - 月1回の社内勉強会の実施",
  "    - 外部カンファレンスへの参加支援",
  "    - 書籍購入補助の利用率向上",
].join("\n");

describe("parseOkrTextHeuristic", () => {
  it("Objective / メモ / 箇条書きKRを分解する", () => {
    const text = [
      "Objective: プロダクトの信頼性を上げる",
      "メモ: インシデントが四半期で増えたため",
      "- 重大インシデントを半期で50%削減する",
      "- デプロイ失敗率を1%未満にする",
    ].join("\n");
    expect(parseOkrTextHeuristic(text)).toEqual([
      {
        title: "プロダクトの信頼性を上げる",
        note: "インシデントが四半期で増えたため",
        keyResults: ["重大インシデントを半期で50%削減する", "デプロイ失敗率を1%未満にする"],
      },
    ]);
  });

  it("空行区切りと O/KR 接頭辞で複数Objectiveを分解する", () => {
    const text = [
      "O1: 顧客体験を改善する",
      "KR1: NPSを+10",
      "KR2: サポート初回解決率を80%へ",
      "",
      "O2: エンジニアリング速度を上げる",
      "KR1: リードタイムを2週間以内に",
    ].join("\n");
    expect(parseOkrTextHeuristic(text)).toEqual([
      {
        title: "顧客体験を改善する",
        keyResults: ["NPSを+10", "サポート初回解決率を80%へ"],
      },
      {
        title: "エンジニアリング速度を上げる",
        keyResults: ["リードタイムを2週間以内に"],
      },
    ]);
  });

  it("Markdown見出し付きの実OKR全文を3 Objectiveに分解する", () => {
    const drafts = parseOkrTextHeuristic(MOCK_SAMPLE);
    expect(drafts).toHaveLength(3);
    expect(drafts[0].title).toContain("【Sales】");
    expect(drafts[0].keyResults).toHaveLength(6);
    expect(drafts[0].keyResults[0]).toContain("新規ユーザー獲得施策のリリースが完了している");
    expect(drafts[0].keyResults[0]).toContain("初回クーポン");
    expect(drafts[0].keyResults[1]).toContain("ムーンショット");
    expect(drafts[1].title).toContain("【Delivery】");
    expect(drafts[1].keyResults).toHaveLength(3);
    expect(drafts[2].title).toContain("【Team】");
    expect(drafts[2].keyResults).toHaveLength(3);
  });

  it("空文字は空配列", () => {
    expect(parseOkrTextHeuristic("   ")).toEqual([]);
  });
});

describe("shouldPreferHeuristic", () => {
  it("クラウドが見出し数より薄いときヒューリスティックを優先する", () => {
    const heuristic = parseOkrTextHeuristic(MOCK_SAMPLE);
    const cloud = [{ title: "別の内容", keyResults: ["x"] }];
    expect(shouldPreferHeuristic(MOCK_SAMPLE, cloud, heuristic)).toBe(true);
  });
});

describe("parseOkrText", () => {
  it("外部AIが失敗したらヒューリスティックへ落とす", async () => {
    vi.resetModules();
    vi.doMock("@core/cloud-chat", () => ({
      runCloudChat: vi.fn(async () => {
        throw new Error("no cli");
      }),
    }));
    vi.doMock("@core/people-directory", async () => {
      const actual = await vi.importActual<typeof import("@core/people-directory")>("@core/people-directory");
      return {
        ...actual,
        ensureNameCandidatesAllowed: vi.fn(async () => undefined),
        maskForStorage: vi.fn(async (t: string) => t),
      };
    });
    const { parseOkrText } = await import("@/lib/okr-parse");
    const result = await parseOkrText("Objective: 売上を伸ばす\n- 新規10件");
    expect(result.source).toBe("heuristic");
    expect(result.objectives[0]?.title).toBe("売上を伸ばす");
    expect(result.objectives[0]?.keyResults).toEqual(["新規10件"]);
  });

  it("外部AIが薄い結果のときMarkdownヒューリスティックを優先する", async () => {
    vi.resetModules();
    vi.doMock("@core/cloud-chat", () => ({
      runCloudChat: vi.fn(async () =>
        JSON.stringify({
          objectives: [{ title: "全然違う目標", note: "", keyResults: ["x"] }],
        }),
      ),
    }));
    vi.doMock("@core/local-model", () => ({
      extractFirstJsonObject: (text: string) => text,
    }));
    vi.doMock("@core/people-directory", async () => {
      const actual = await vi.importActual<typeof import("@core/people-directory")>("@core/people-directory");
      return {
        ...actual,
        ensureNameCandidatesAllowed: vi.fn(async () => undefined),
        maskForStorage: vi.fn(async (t: string) => t),
        unmaskNames: (t: string) => t,
      };
    });
    const { parseOkrText } = await import("@/lib/okr-parse");
    const result = await parseOkrText(MOCK_SAMPLE);
    expect(result.source).toBe("heuristic");
    expect(result.objectives).toHaveLength(3);
    expect(result.objectives[0].keyResults).toHaveLength(6);
  });
});
