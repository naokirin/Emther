import { describe, expect, it } from "vitest";
import {
  consultExcerpt,
  isIssueDraftAnalysisTask,
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
