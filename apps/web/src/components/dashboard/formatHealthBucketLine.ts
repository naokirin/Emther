import type { VitalStatus } from "@emther/core/types";

const BUCKET_LABEL: Record<VitalStatus, string> = {
  good: "良い",
  warn: "要注意",
  bad: "危険",
  unknown: "未観測",
};

/** 凡例1行。examples は最大2件のため、残りがあるときは末尾に「…」を付ける。 */
export function formatHealthBucketLine(bucket: {
  status: VitalStatus;
  count: number;
  examples: string[];
}): string {
  const names =
    bucket.examples.length > 0
      ? ` · ${bucket.examples.join("、")}${bucket.count > bucket.examples.length ? "…" : ""}`
      : "";
  return `${BUCKET_LABEL[bucket.status]} ${bucket.count}${names}`;
}
