import { listEventLineageIds } from "@/lib/knowledge-store";
import { listRuns } from "@/lib/agent-runtime";

// Journal（journal-store）とAgent Run（agent-runtime）という2つのドメインを横断する
// 参照なので、どちらのドメイン層にも置かない（互いに依存させない）。EM向けの表示で
// 「このJournalはどのLead相談から生まれたか」を解決したい呼び出し側（APIルート）が、
// journal-store.tsのtoJournalEntryView/toJournalEntryViewsへ渡すインデックスをここで組み立てる。
export async function buildSourceConsultIndex(): Promise<Map<string, string>> {
  const best = new Map<string, { runId: string; updatedAt: number }>();
  for (const run of listRuns()) {
    if (run.agentName !== "Lead Agent" || !run.sourceJournalId) continue;
    for (const journalId of listEventLineageIds(run.sourceJournalId)) {
      const prev = best.get(journalId);
      if (!prev || run.updatedAt > prev.updatedAt) {
        best.set(journalId, { runId: run.id, updatedAt: run.updatedAt });
      }
    }
  }
  const index = new Map<string, string>();
  for (const [journalId, value] of best) {
    index.set(journalId, value.runId);
  }
  return index;
}
