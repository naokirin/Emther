import { addJournalEntryWithProfileCandidate, type JournalEntry, type JournalNameCandidateHint } from "@/lib/journal-store";
import { parseObservationDumpText } from "@/lib/observation-dump-parse";
import {
  getObservationDump,
  refreshDumpStatusAfterAccept,
  updateObservationDump,
  type ObservationDump,
} from "@/lib/observation-dump-store";
import { ensureNameCandidatesAllowed, unmaskNames } from "@/lib/people-directory";
import type { MaskOptions } from "@/lib/name-candidate-confirmation";

function dateHintToOccurredAt(hint: string | undefined, fallback: number): number {
  if (!hint) return fallback;
  const m = hint.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return fallback;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  const d = new Date(y, mo - 1, da, 12, 0, 0, 0);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return fallback;
  return d.getTime();
}

function defaultOccurredAt(dump: ObservationDump): number {
  const start = dump.occurredRangeHint?.start;
  if (start) return dateHintToOccurredAt(start, dump.createdAt);
  const d = new Date(dump.createdAt);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

export async function runParseOnDump(dumpId: string): Promise<ObservationDump> {
  const dump = getObservationDump(dumpId);
  if (!dump) throw new Error("Dumpが見つかりません");
  if (dump.status === "discarded") throw new Error("破棄済みのDumpは再分割できません");

  updateObservationDump(dumpId, { status: "parsing", parseError: undefined });
  try {
    const result = await parseObservationDumpText(dump.sourceType, dump.rawTextMasked);
    const priorNotes = dump.droppedNotes ?? [];
    const mergedNotes = [
      ...priorNotes,
      ...result.droppedNotes.filter((n) => !priorNotes.includes(n)),
    ];
    const updated = updateObservationDump(dumpId, {
      status: result.chunks.length > 0 ? "draft_ready" : "failed",
      chunkDrafts: result.chunks,
      droppedNotes: mergedNotes,
      parseSource: result.source,
      parseError: result.chunks.length > 0 ? undefined : "チャンクを抽出できませんでした",
    });
    if (!updated) throw new Error("Dumpの更新に失敗しました");
    return updated;
  } catch (err) {
    const message = (err as Error).message || "分割に失敗しました";
    const failed = updateObservationDump(dumpId, {
      status: "failed",
      parseError: message,
      chunkDrafts: [],
    });
    if (!failed) throw err;
    return failed;
  }
}

export async function acceptDumpChunks(
  dumpId: string,
  chunkIds: string[],
  opts: MaskOptions = {},
): Promise<{ dump: ObservationDump; entries: JournalEntry[]; nameCandidateSuggestions: JournalNameCandidateHint[] }> {
  const dump = getObservationDump(dumpId);
  if (!dump) throw new Error("Dumpが見つかりません");
  if (dump.status === "discarded") throw new Error("破棄済みのDumpからは採用できません");
  if (dump.status === "parsing") throw new Error("分割処理中です");

  const idSet = new Set(chunkIds);
  if (idSet.size === 0) throw new Error("採用するチャンクを選んでください");

  const targets = dump.chunkDrafts.filter(
    (c) => idSet.has(c.id) && !c.acceptedJournalId && c.disposition !== "drop",
  );
  if (targets.length === 0) throw new Error("採用可能なチャンクがありません");

  const fallbackOccurred = defaultOccurredAt(dump);
  const entries: JournalEntry[] = [];
  const chunkDrafts = [...dump.chunkDrafts];

  // docs/memo.md「メンバーに登録がない名前をJournalで入力して分析にかけましたが、とくに
  // 引っかからずにAIに渡されてしまいました」対応。以前はここで無条件に
  // allowUnmaskedCandidates: trueを渡しており、呼び出し元のopts（未確認なら確認が必要）が
  // 効かなかった。addJournalEntriesBulkと同じ「途中保存を残さないよう先に全チャンクの
  // 候補をまとめて確認する」方式にそろえる。
  const chunkTexts = targets.map((chunk) => unmaskNames(chunk.textMasked).trim()).filter(Boolean);
  await ensureNameCandidatesAllowed(chunkTexts, opts);

  // docs/memo.md「テキストから検出されたメンバー名を確実に『人物』にすべて登録する」対応。
  // 上の一括確認は生テキストの形態素検出だけを見ているため、チャンクごとのローカルモデル
  // 抽出が見つけた未登録名（検出漏れ）を、単発投稿と同じヒントとしてチャンク単位で拾い上げる。
  const nameCandidateSuggestions: JournalNameCandidateHint[] = [];
  for (const chunk of targets) {
    const text = unmaskNames(chunk.textMasked).trim();
    if (!text) continue;
    const occurredAt = dateHintToOccurredAt(chunk.suggestedOccurredAt, fallbackOccurred);
    const people = chunk.people.map(unmaskNames).filter(Boolean);
    // 上で一括確認済みなので、各チャンクでは再検出をスキップする（allow付きで通す）。
    const { entry, nameCandidates } = await addJournalEntryWithProfileCandidate(text, occurredAt, {
      allowUnmaskedCandidates: true,
      people: people.length > 0 ? people : undefined,
      sourceDumpId: dump.id,
      sourceChunkId: chunk.id,
    });
    entries.push(entry);
    if (nameCandidates.length > 0) {
      nameCandidateSuggestions.push({ entryId: entry.id, people: entry.people, candidates: nameCandidates });
    }
    const idx = chunkDrafts.findIndex((c) => c.id === chunk.id);
    if (idx >= 0) {
      chunkDrafts[idx] = {
        ...chunkDrafts[idx],
        disposition: "accept",
        acceptedJournalId: entry.id,
      };
    }
  }

  const next: ObservationDump = {
    ...dump,
    chunkDrafts,
    updatedAt: Date.now(),
  };
  const status = refreshDumpStatusAfterAccept(next);
  const updated = updateObservationDump(dumpId, { chunkDrafts, status });
  if (!updated) throw new Error("Dumpの更新に失敗しました");
  return { dump: updated, entries, nameCandidateSuggestions };
}
