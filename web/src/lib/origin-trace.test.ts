import { describe, expect, it } from "vitest";
import {
  consultExcerpt,
  consultListSecondary,
  consultListTitle,
  isIssueDraftAnalysisTask,
  issueDraftTitleFromTask,
  journalExcerptFromTask,
  resolveSourceConsultRun,
  truncateExcerpt,
} from "./origin-trace";

describe("journalExcerptFromTask", () => {
  it("自動分析タスクからJournal本文を取り出す", () => {
    const task = [
      "Journalに、設定した自動分析条件に合うエントリが追加されました。",
      "",
      '対象のJournalエントリ: "リリースが遅れて現場が疲弊している"',
    ].join("\n");
    expect(journalExcerptFromTask(task)).toBe("リリースが遅れて現場が疲弊している");
  });

  it("マーカーが無ければundefined", () => {
    expect(journalExcerptFromTask("方針を相談したい")).toBeUndefined();
  });
});

describe("isIssueDraftAnalysisTask", () => {
  it("起票直後の分析タスクだけを真にする", () => {
    expect(isIssueDraftAnalysisTask("新しいIssueが起票されました。EMが次の一手を判断できるよう")).toBe(true);
    expect(isIssueDraftAnalysisTask("方針を相談したい")).toBe(false);
  });
});

describe("issueDraftTitleFromTask", () => {
  it("起票分析タスクからタイトル行を取り出す", () => {
    expect(
      issueDraftTitleFromTask("新しいIssueが起票されました。\nタイトル: テスト追加\nWhy/What/Howのうち未整理な項目"),
    ).toBe("テスト追加");
    expect(issueDraftTitleFromTask("方針を相談したい")).toBeUndefined();
  });
});

describe("consultExcerpt", () => {
  it("Journal引用があればそれを、無ければtask全体を返す", () => {
    expect(consultExcerpt('前置き\n対象のJournalエントリ: "本文"')).toBe("本文");
    expect(consultExcerpt("  方針を相談したい  ")).toBe("方針を相談したい");
  });
});

describe("truncateExcerpt", () => {
  it("短い文はそのまま、長い文は省略記号を付ける", () => {
    expect(truncateExcerpt("短い")).toBe("短い");
    expect(truncateExcerpt("あ".repeat(200), 10)).toBe("あああああああああ…");
  });
});

describe("consultListTitle / consultListSecondary", () => {
  const journalTask = [
    "Journalに、設定した自動分析条件に合うエントリが追加されました。",
    "",
    '対象のJournalエントリ: "リリースが遅れて現場が疲弊している"',
  ].join("\n");

  it("手動相談は入力文をタイトルにする", () => {
    expect(consultListTitle({ task: "Aさんの1on1方針を相談したい", origin: "manual" })).toBe(
      "Aさんの1on1方針を相談したい",
    );
  });

  it("Journal自動分析は指示文ではなく本文をタイトルにする", () => {
    expect(consultListTitle({ task: journalTask, origin: "auto-anomaly" })).toBe(
      "リリースが遅れて現場が疲弊している",
    );
  });

  it("起票分析は定型文ではなくIssueタイトルを使う", () => {
    expect(
      consultListTitle({
        task: "新しいIssueが起票されました。\nタイトル: テスト追加\nWhy/What/Howのうち未整理な項目",
        origin: "manual",
      }),
    ).toBe("テスト追加");
  });

  it("本文が取れない自動分析は結論をタイトルにする", () => {
    expect(
      consultListTitle({
        task: "朝のサマリーを作成してください。Team Vitals…",
        origin: "auto-summary",
        proposal: { conclusion: "今日はYieldが2件。まずBチームを見る" },
      }),
    ).toBe("今日はYieldが2件。まずBチームを見る");
  });

  it("結論も本文も無い自動分析は起点ラベルにする（定型指示文を出さない）", () => {
    expect(
      consultListTitle({
        task: "朝のサマリーを作成してください。Team Vitals・1on1 Coverage…",
        origin: "auto-summary",
      }),
    ).toBe("朝のサマリー");
  });

  it("結論がありタイトルと違うときは補助行に出す", () => {
    expect(
      consultListSecondary({
        task: journalTask,
        origin: "auto-anomaly",
        proposal: { conclusion: "Issue化を検討する。現場の負荷が続いている" },
      }),
    ).toBe("Issue化を検討する。現場の負荷が続いている");
  });

  it("タイトルが結論そのものなら補助行は出さない", () => {
    expect(
      consultListSecondary({
        task: "朝のサマリーを作成してください。",
        origin: "auto-summary",
        proposal: { conclusion: "今日はYieldが2件" },
      }),
    ).toBeUndefined();
  });
});

describe("resolveSourceConsultRun", () => {
  const consult = { id: "run-consult", task: "方針を相談したい", origin: "manual" };
  const draft = { id: "run-draft", task: "新しいIssueが起票されました。タイトル: x", origin: "manual" };
  const update = { id: "run-update", task: "更新分析", origin: "auto-issue-update" };

  it("sourceRunIdがあればそれを優先する", () => {
    expect(
      resolveSourceConsultRun({ sourceRunId: "run-consult", agentRunId: "run-update" }, [consult, update])?.id,
    ).toBe("run-consult");
  });

  it("旧データは起票分析でも更新分析でもない linked run を相談元とみなす", () => {
    expect(resolveSourceConsultRun({ agentRunId: "run-consult" }, [consult])?.id).toBe("run-consult");
    expect(resolveSourceConsultRun({ agentRunId: "run-draft" }, [draft])).toBeUndefined();
    expect(resolveSourceConsultRun({ agentRunId: "run-update" }, [update])).toBeUndefined();
  });
});
