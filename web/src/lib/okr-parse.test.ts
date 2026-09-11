import { describe, expect, it, vi } from "vitest";
import { parseOkrTextHeuristic, shouldPreferHeuristic } from "@/lib/okr-parse";

const CAMPFIRE_SAMPLE = [
  "# Objective 1：【Build】共通基盤・決済基盤を進化させ、各チームが安心して利用できる状態をつくる",
  "",
  "- Key Result 1：下期開発予定の施策で利用する基盤のリリースの完了している",
  "    1. アンケート",
  "    2. メッセージ",
  "    3. 通知",
  "    4. 掲示板",
  "    5. カレンダー予約",
  "- Key Result 2：ID基盤がCAMPFIREのプライマリの認証になっている",
  "    - ここはかなりムーンショットとして設定",
  "- Key Result 3：古くなっている決済技術のアップデート完了している",
  "    1. クレカのトークン決済のアップデート完了",
  "    2. PayPal SDK の最新化の完了",
  "- Key Result 4：運用リスクとなる決済関連課題の改善による決済関連の運用トラブル件数を月1件以下に抑えられている",
  "    1. 募集期間変更における実売上期間超過防止策",
  "    2. みなし放棄の決済種別全体での包括的な対応",
  "    3. Rollbarにおける不要な通知の抑止",
  "- Key Result 5：GMO向け決済のOpenAPI化に向けた次期対応計画と調査の完了している",
  "    - OpenAPI方式の決済種別全体での設計方針のドキュメント化",
  "    - 移行難易度・障害となることが決済種別ごとに整理されている",
  "",
  "- Key Result 6：セキュリティ強化のための認証方式アップデート計画と1stリリースの完了している",
  "    - 現状の課題のリストアップ完了と対応計画の策定完了",
  "    - 比較的リスクの高い課題の解決とそのリリースの完遂",
  "",
  "---",
  "",
  "# Objective 2：【Guide】 技術判断・導入判断を仕組み化し、各チームが自律して適切な判断ができる状態をつくる",
  "",
  "- Key Result 1：基盤への需要を適切に整理・判断できる状態になっている",
  "    - 9月時点で以下の方針が決定、チーム外にも共有できている",
  "        - 基盤開発が必要か、基盤以外で実装するか",
  "        - 既存基盤を利用すればよいか",
  "- Key Result 2：各チームが基盤を利用・判断するための仕組みが整備されている",
  "    - 開発した基盤全てで、実装サンプルやドキュメントにより、どのように機能を利用するか、わかるようになっている",
  "- Key Result 3：チーム外の決済関連施策について、AIやソフトウェア品質ツール等により、一定の品質基準・判断基準に基づいて各チームが開発できる仕組みを整備を実現されている",
  "    - 決済開発の判断ができる状態の構築完了（利用できる状態に持っていく）",
  "    - 決済における設計方針のドキュメント化",
  "    - 決済における障害対応フローの整備・AIサポートの仕組み化完了",
  "",
  "---",
  "",
  "# Objective 3：【Enable】 各チームが共通基盤・技術を自律的に利用・改善できる状態をつくる",
  "",
  "- Key Result 1：基盤導入における支援内容・問い合わせ内容を整理し、自己解決できる領域を拡大できている",
  "    - 5件以上の解決できる領域拡大にむけた対応のリストアップと解決の実現",
  "- Key Result 2：次に基盤でやるべきテーマを継続的に発見・評価する仕組みを確立している",
  "    - 来期に実現すべきテーマのリストアップ完了",
  "- Key Result 3：決済関連の施策開発での自律的な開発に向けたサポート、およびほかチームで必要となる情報のキャッチアップによる仕組み化への還元",
  "    - 必要なサポート、施策での課題のヒアリング実施",
  "    - 発見した情報を元にした判断の仕組み化への反映（5件）",
  "    - 下期決済関連施策への設計段階からの参加",
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
    const drafts = parseOkrTextHeuristic(CAMPFIRE_SAMPLE);
    expect(drafts).toHaveLength(3);
    expect(drafts[0].title).toContain("【Build】");
    expect(drafts[0].keyResults).toHaveLength(6);
    expect(drafts[0].keyResults[0]).toContain("下期開発予定の施策で利用する基盤のリリースの完了している");
    expect(drafts[0].keyResults[0]).toContain("アンケート");
    expect(drafts[0].keyResults[1]).toContain("ムーンショット");
    expect(drafts[1].title).toContain("【Guide】");
    expect(drafts[1].keyResults).toHaveLength(3);
    expect(drafts[2].title).toContain("【Enable】");
    expect(drafts[2].keyResults).toHaveLength(3);
  });

  it("空文字は空配列", () => {
    expect(parseOkrTextHeuristic("   ")).toEqual([]);
  });
});

describe("shouldPreferHeuristic", () => {
  it("クラウドが見出し数より薄いときヒューリスティックを優先する", () => {
    const heuristic = parseOkrTextHeuristic(CAMPFIRE_SAMPLE);
    const cloud = [{ title: "別の内容", keyResults: ["x"] }];
    expect(shouldPreferHeuristic(CAMPFIRE_SAMPLE, cloud, heuristic)).toBe(true);
  });
});

describe("parseOkrText", () => {
  it("外部AIが失敗したらヒューリスティックへ落とす", async () => {
    vi.resetModules();
    vi.doMock("@/lib/cloud-chat", () => ({
      runCloudChat: vi.fn(async () => {
        throw new Error("no cli");
      }),
    }));
    vi.doMock("@/lib/people-directory", async () => {
      const actual = await vi.importActual<typeof import("@/lib/people-directory")>("@/lib/people-directory");
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
    vi.doMock("@/lib/cloud-chat", () => ({
      runCloudChat: vi.fn(async () =>
        JSON.stringify({
          objectives: [{ title: "全然違う目標", note: "", keyResults: ["x"] }],
        }),
      ),
    }));
    vi.doMock("@/lib/local-model", () => ({
      extractFirstJsonObject: (text: string) => text,
    }));
    vi.doMock("@/lib/people-directory", async () => {
      const actual = await vi.importActual<typeof import("@/lib/people-directory")>("@/lib/people-directory");
      return {
        ...actual,
        ensureNameCandidatesAllowed: vi.fn(async () => undefined),
        maskForStorage: vi.fn(async (t: string) => t),
        unmaskNames: (t: string) => t,
      };
    });
    const { parseOkrText } = await import("@/lib/okr-parse");
    const result = await parseOkrText(CAMPFIRE_SAMPLE);
    expect(result.source).toBe("heuristic");
    expect(result.objectives).toHaveLength(3);
    expect(result.objectives[0].keyResults).toHaveLength(6);
  });
});
