import { timestampToDateInputValue } from "@emther/core/journal-date-parser";

// Journal入力の発生日UIと同じ折りたたみパターン。既定は今日のまま隠し
// 前日分などを入れるときだけ開いて日付を選ぶ
export function todayDateInputValue(): string {
  return timestampToDateInputValue(Date.now());
}
