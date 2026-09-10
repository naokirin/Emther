# 実利用で見つかった課題（2026-09-10）

実機で使って判明した不具合・摩擦の追跡用。一気に全部は直さず、優先度の高いものから潰す。

関連: `docs/em_human_story_and_ux.md` / `docs/packaging.md` / `docs/improvement_v1.md`

## 進め方

1. 本ディレクトリの一覧を正本にする（状態は `未着手` / `対応中` / `完了`）。
2. 1件（または密接に関連する数件）ずつ直す。
3. 直したら本ファイルの状態と「対応」欄を更新する。

## 一覧

| ID | 優先 | 状態 | 課題 |
| --- | --- | --- | --- |
| U1 | P0 | 完了 | ローカルモデルが JSON を返さないと Journal 自体が保存されない |
| U2 | P1 | 完了 | AI が対応不要と判断しても、人間が却下する必要がある |
| U3 | P1 | 完了 | Issue 更新時に他 Agent へ Why/What/How が渡らず、無意味な Issue が立つ |
| U4 | P1 | 完了 | 相談タブで却下しても「次の1手」に残る |
| U5 | P1 | 完了 | アーカイブ済み Issue が「今日」の判断待ちに残る |
| U6 | P1 | 完了 | 判断待ちから相談タブへ飛ぶと対象履歴が開かない |
| U7 | P2 | 完了 | メンバーの表示名（タイトル名）が変更できない |
| U8 | P2 | 完了 | Journal の「対応済み」は Issue 化しただけには強すぎる |
| U9 | P2 | 完了 | 文章量のある入力欄が1行 input になっている |
| U10 | P0 | 完了 | GitHub Releases の tarball から `install.sh` で入れられない |

---

## U1. Journal 保存がローカルモデルの JSON 抽出に依存している

**現象:** ローカルモデル（Qwen 等）が JSON を返さない／壊れた JSON を返すと、API がエラーになり本文が永続化されない。抽出は補助なのに、記録という主目的が止まる。

**原因:** `web/src/lib/journal-store.ts` の `createJournalEventFromText` が `extractFirstJsonObject` 失敗・`JSON.parse` 失敗で throw する。埋め込み失敗は既に握りつぶしているが、構造化抽出は握りつぶしていない。

**方針:** ローカルモデルの成否にかかわらず raw 本文は必ず保存する。抽出できないときは tags/people 空・urgency mid・sentiment neutral・summary 空のまま未確認エントリとして残す（後から校正できる）。モデル呼び出し自体が失敗しても同様。

---

## U2. AI が対応不要でも人間の却下が必要

**現象:** Journal 自動分析が「追跡不要」と結論しても、起票待ちドラフトとして「次の1手」に残り、EM が却下ボタンを押すまで消えない。

**原因:** `startJournalAutoAnalysis` は追跡不要ならその旨を述べるよう指示するが、機械可読な信号が無く、完了した auto-anomaly run は未トリアージのまま Inbox に残る。

**方針:** proposal に任意フィールド `recommendation: "issue" | "dismiss" | "watch"` を追加する。`origin === "auto-anomaly"` かつ `dismiss` のときだけ自動で `triageStatus=dismissed` にする（手動相談は自動却下しない）。フィールドが無い従来出力は従来どおり手動トリアージ。

---

## U3. Lead から他 Agent へ Issue 内容が渡りきらない

**現象:** Issue 更新分析などで専門 Agent が Why/What/How を知らず、「分からない」という EM にとって意味のない Issue / Yield が出る。

**原因（複合）:**

1. 専門 Agent の run は Issue に `linkIssueRun` されない。`buildIssueContextBlock(runId)` は `getIssueByRunId(そのrun)` だけを見るため、専門側ではコンテキストが空になる。
2. 同関数は Why/What/How も tags も空だとブロックごと省略し、タイトルすら渡らない。
3. `buildIssueUpdateTask` は「更新された項目: Why」のようにフィールド名だけを渡し、最新の本文を載せない。

**方針:** `consultedBy` を辿って親 Lead の Issue を解決する。コンテキストブロックはタイトルを常に含める。更新タスクには最新の Why/What/How 本文を載せる。

---

## U4. 相談を却下しても「次の1手」に残る

**現象:** 相談タブで却下しても、今日タブの判断待ちが消えない。

**原因:** Lead 本体は `triageStatus=dismissed` で除外されるが、consult で生えた専門 Agent run（`consultedBy` 付き）は却下されない。origin を親からコピーしているため、未確認ドラフトとして残る。

**方針:** 「次の1手」から `consultedBy` 付き run を除外する。親を却下／様子見したときは子 run にも同じトリアージを伝播する。

---

## U5. アーカイブ済み Issue が判断待ちに残る

**現象:** Issue をアーカイブしても、今日タブの判断待ちに残る。

**原因:** `issueNeedsCharter` は archived を除外済みだが、紐づく Agent run の Yield / ドラフト / エラーは除外していない。アーカイブは run のトリアージを変えない。

**方針:** 紐づく Issue が archived なら、その run を「次の1手」に出さない。様子見の再浮上も同様。

---

## U6. 判断待ちから相談へ飛ぶと対象が開かない

**現象:** 「次の1手」から `/chat?runId=` で遷移しても、対象の相談履歴が開かず新規相談フォームになる。何に対応すればよいか分からない。

**原因:** `chat/page.tsx` が render 中に `runs.length > 0` だけで seed し、`chatHistoryLoaded`（runs + issues）を待たない。seed 後に `chatRuns`（未 Issue 化の Lead のみ）から探すため、見つからないと `selectedRun === null`。一度 seed すると再試行しない。履歴リストもスクロールしない。

**方針:** 両方のロード完了後に `useEffect` で選択する。Lead なら `chatRuns` に無くても `runs` から開く。選択行へスクロールする。

---

## U7. メンバーの表示名が変えられない

**現象:** 人物の正式名（画面上のタイトル）を後から直せない。別名の追加・統合・削除しかない。

**原因:** `PATCH /api/people/:id` は `addAlias` / `removeAlias` のみ。`people-directory` に正式名の差し替えが無い。

**方針:** 旧正式名は別名として残し、新しい表記を正式名にする `renamePerson` を追加する。詳細画面から変更できるようにする。

---

## U8. 「対応済み」は Issue 化だけには強い

**現象:** Journal を Issue にしただけで「対応済み」と出る。追跡開始なのに完了に見える。

**方針:** Issue に紐づいているときは「対応済み/Issue化済み」。解決メモだけのときは従来どおり「対応済み」。フィルタ文言も揃える。

---

## U9. 入力欄が1行になりがち

**現象:** Journal・経過ログ・Action Item・壁打ちなど、そこそこの文章を書く欄が `<input type="text">`。

**方針:** 検索・名前・日付・数値・Issue タイトルはそのまま。本文系は textarea（Enter で改行、Ctrl/Cmd+Enter で送信できるところはそうする）。

対象の目安: Quick Journal、長期プロファイル本文、経過ログ、Action Item 追加、成長メモ、Copilot チャット。解決メモも文章なので textarea。

---

## U10. GitHub Releases からインストールできない

**現象:** ドキュメントどおり `tar -xzf … && ./emther/install.sh` しても入らない。

**原因:** tarball 内の `install.sh` は `scripts/install-release.sh` のコピーで、**tar.gz を引数に取る**。展開後に引数なしで実行すると Usage で落ちる。展開済みの `app/` から入れる経路が無い。

**方針:** スクリプトが自分の隣に `app/server.js` を見つけたら、そこからホストへコピーする（展開済みインストール）。引数に tar.gz がある従来の `emther install-release` は維持する。

---

## 今回入れた対応の要点

- **U1** `journal-store.ts`: 抽出失敗・モデル例外でも raw 本文を未確認エントリとして保存
- **U2** proposal の `recommendation: "dismiss"` + auto-anomaly のみ自動却下
- **U3** `consultedBy` を辿って Issue コンテキストを渡す。タイトルは charter 空でも渡す。更新タスクに Why/What/How 本文を載せる
- **U4/U5** 「次の1手」から consult 子 run・却下済み・アーカイブ紐付け run を除外。親のトリアージを子へ伝播
- **U6** 相談ページは runs+issues ロード後に `runId` を選択し、履歴へスクロール
- **U7** `renamePerson` + 人物詳細の「名前を変更」
- **U8** Issue 化は「対応済み/Issue化済み」
- **U9** Journal / 経過ログ / Action Item / 成長メモ / 壁打ち / 解決メモ / 長期プロファイルを textarea 化（Ctrl/Cmd+Enter で送信）
- **U10** `install.sh` は隣の `app/` からインストール。tar.gz 引数経路は維持
