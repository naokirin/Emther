import type { useNameCandidateConfirm } from "@/lib/useNameCandidateConfirm";

// IssueDetailContent とその配下のパネル間で共有する小さな型群。
export type FetchWithNameConfirm = ReturnType<typeof useNameCandidateConfirm>["fetchWithNameConfirm"];

export type RetryableError = { message: string; retry: () => void };
