# MEMO

## TODO

### バグ
* [対応済み] まれにJournalの入力順と表示順が変わることがある → 校正（updateJournalEntry）のたびにrecordedAtが編集時刻へ進んでしまい、occurredAtが同値のグループ内で入力順が崩れていた。originalのrecordedAtを引き継ぐよう修正（journal-store.ts）
* [対応済み] 観測不足に解決済みJournalが残り続ける → ダッシュボード「今日やるべき」の観測不足レーンが表示ウィンドウ（24時間）だけで自然に外れる設計で、対応済み/Issue化済みかを見ていなかった。isJournalEntryResolvedで除外するよう修正（dashboard-next-actions.ts）

### UI / UX 改善
* [対応済み] Issue の Action Items が一番下にあるので扱いにくい → Why / What / How（IssueCharterSection）の直後に移動（IssueDetailContent.tsx）
* [対応済み] Issue / Journal リンク等について、ツールチップ等で概要（長い場合は省略）が表示されると嬉しい → 既存のaxisTooltip機構を使い、charter（Why優先）を表示中のIssueデータで賄える範囲（Issue一覧・サブIssue一覧・メンバー詳細の関連Issue）に適用。ID/リンクのみでJournal本文などを保持していない箇所（例: 評価ログの「根拠Journal」）は追加のデータ取得が要るため未対応のまま
* [対応済み] 今日タブの今日やるべきに「チームリスク」が表示されるが「チームの状態」と内容的には被っている → 同一ダッシュボード上のTeamStatePanelと重複するbad/warnのカードは今日やるべきから削除（評価不能＝観測を増やす誘導は役割が違うため残す）

### 機能追加
* [対応済み] 現場メモのタブでも単発のメモ入力をしたい → /journalページに「📝 単発でメモする」の折りたたみフォームを追加（QuickJournalNoteForm.tsx）。観測ダンプ（AI解析の複数件取り込み）とは別の、POST /api/journalへの単発投稿
* メンバーの詳細にJournalのような流れるものではなく、固定情報を残せるメモ欄を作成したい
  * → 2026-09-14調査: 既存の「長期プロファイル（解釈）」も内部的にはknowledge-storeのイベントログ（追記のみ・不変）で、これもまだ「流れるもの」。真に単一・上書き可能な固定メモを持たせるには、アプリ全体のイベントソーシング方針（削除・上書きしない）から意図的に外れる必要があり実装より先に方針確認が要る。未着手
* [対応済み] Issue の関連JournalをIssue詳細で見れるようにしたい → 表示自体は既存のOriginTrace（起票元Journal＋resolvedIssueIdで紐づいたJournal）で対応済みだったが、既存Issueへ後から手動でJournalを紐付ける手段が無かった。Journal編集画面に「既存Issueに紐付ける」欄を追加（Issue ID/8桁以上のプレフィックス入力、/api/journal/[id]側でIssueの実在確認）
* Journal等から見つかった情報をもとに、コンテキスト化したものなどをまとめてみたいが見れる場所がない
* [対応済み] 自動で先週分・先月分のレポートを作ってほしい → レポート画面に「先週」「先月」の手動生成ボタンを追加（POST /api/reportsにperiodsAgoを渡すだけで、cron等の自動化はしていない）
* [対応済み] スケジュールを引くのと、ロードマップ的な期日の見せ方ができる状態にし、Time-boundを明確化する仕組みをいれる → Issueに期限（dueAt）フィールドを追加し、詳細画面での設定・一覧/詳細での表示・期限切れの強調に対応（ガントチャート的な専用画面は作っていない）
* [対応済み] Agentが相談などから他Issueなどへ記録することができない → lookupで見つけた別Issueへの追記提案（issue_noteブロック）をAgentが出せるようにし、EMが採用するとそのIssueの経過ログへ追記される（作成・ステータス変更は不可の安全側API）。/chat・Issue詳細の両方の実行状態パネルに採用/却下UIを追加

### 情報設計・運用改善
* [対応済み] Issue等で期限管理ができない → 上記のIssue期限（dueAt）フィールドで対応
* EMとしてのIssueと、備忘に近いタスク系のものが混在すると大量にやることが積まれてしまい、管理がむずかしい。このあたりはどうにかしたいかも
