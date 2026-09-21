import { timestampToDateInputValue } from "@emther/core/journal-date-parser";

// 改修依頼「前日分を入れ忘れたときに入れるなどできるように日付指定」対応。
// Journal入力の発生日UIと同じ折りたたみパターン。既定は今日のまま隠し、
// 前日分などを入れるときだけ開いて日付を選ぶ。
export function todayDateInputValue(): string {
  return timestampToDateInputValue(Date.now());
}
