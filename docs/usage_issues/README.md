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
| U11 | P1 | 完了 | Journal → 相談、相談 → Issue の生成元が見えない |
| U12 | P1 | 完了 | 相談履歴一覧がステータスばかりで、何の相談か分からない |
| U13 | P1 | 完了 | 状況蒸留の Run が相談タブ履歴に出ない／開けない |
| U14 | P0 | 完了 | 朝サマリー／再開後に業務ナレッジが渡らず「材料不足」Yield になる |
| U15 | P1 | 完了 | AI の Issue 化でタイトルが途中切れ（…）になる |
| U16 | P1 | 完了 | Journal 自動分析が投稿時に動かず、修正なしでは起動しにくい |
| U17 | P2 | 完了 | メンバーに「自分自身」を区別できない |
| U18 | P1 | 完了 | OKR設定が1件ずつで面倒／KR編集不可／複数行不可／Objectiveメモなし |

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

## U11. Journal・相談から生まれた相談・Issueの生成元が見えない

**現象:** Journal自動分析で相談が立ったり、相談をIssue化したりしても、先に開いた側から「なぜこれが生まれたか」が分からない。originラベル（「Journal自動分析」）はあるが、元の入力とリンクが無い。

**原因:** Journal → 相談は `origin=auto-anomaly` と task 内の本文引用だけで、Journal ID を保存していなかった。相談 → Issue は `agentRunId` があるが、更新分析で差し替わり、生成元としては表示していなかった。Issue → Journal の逆リンク表示も無かった。

**方針:** `AgentRun.sourceJournalId` と `Issue.sourceJournalId` / `sourceRunId` を保存する。相談詳細・Issue詳細に「なぜ生まれたか」（本文抜粋＋リンク）を出す。Journalカードからも生成された相談へ辿れるようにする。相談からIssue化したときは元Journalへ `resolvedIssueId` も付ける。

---

## U12. 相談履歴一覧から内容が読めない

**現象:** 相談タブ左の履歴が `Idle（完了・待機中）` / `未確認` / `様子見` などの状態ラベル中心で、何の相談かほとんど分からない。自動分析は `task` 先頭の定型指示文が切り出され、本文に届かない。

**原因:** 一覧が StatusBadge 先行。内容は `task` の先頭50文字で、自動分析の指示文がそのまま出る。日時も無い。

**方針:** 手動は相談文、Journal由来は本文抜粋、それが無い自動分析は結論（無ければ起点ラベル）をタイトルにする。結論がタイトルと違うときは補助行に出す。日時・短い状態・起点はメタ行にまとめる。

---

## U13. 状況蒸留の Run が相談タブ履歴に出ない

**現象:** エージェントの「相談・起動」には状況蒸留があるが、リンクで相談タブへ行くと対象が履歴に出ず新規フォームになる。

**原因:** 蒸留の材料（Journal/Issue一覧）を `run.task` 全文に載せていた。Inboxはページング＋ログ1行で軽いが、相談タブの `/api/agents` は全件フルログのため、巨大 task で一覧取得・表示が破綻する。

**方針:** `run.task` は短い定型のみ。材料は `buildDistillationContextBlock` でシステムプロンプトへ注入。相談タブは `runId` が一覧に無いとき `GET /api/agents/[id]` でピン留めして履歴に出す。

---

## U14. 朝サマリー／再開で業務ナレッジが渡らない

**現象:** 朝サマリー（やエラー後の「続けて」再開）で Lead が「課題テキストが無い」「前提不足」と Yield する。相談チャットとしても、蓄積ナレッジを判断に使えない。

**原因:**
1. システムプロンプトが「タスク文脈だけ／外部アクセス不可」と述べ、注入済み材料を無視しやすかった。
2. `auto-summary` は蒸留と違い、Team Vitals / Yield / 未整理 Issue 等のスナップショットをシステムプロンプトへ注入していなかった（短い task 指示のみ）。
3. 再開時の Journal／関連検索クエリが追加入力だけになり、元 `run.task` が落ちていた。

**方針（今回 A）:** `buildMorningSummaryContextBlock` を `auto-summary` で毎ターン注入。プロンプト文言を「注入ナレッジを使え」に変更。再開時は `run.task` をクエリに結合。注入ブロックと組織名簿は `maskNames` してから渡し、チーム名と人物名の衝突で送信直前 assert に落ちないようにする。

**今後必須（C）:** Claude / agy / cursor のすべてが `…/emther/data`（マスク済み業務データ）を読み取れるようにする。`secure`（実名対応表）は引き続き除外。A の合成シグナル注入は C 実現後も残す。

---

## U15. AI の Issue 化でタイトルが途中切れになる

**現象:** 相談や Journal 自動分析から Issue 化すると、タイトルが文の途中で `…` 省略されることがある。

**原因:** Issue タイトルに `proposal.conclusion`（「〜を Issue 化して追跡すべきと判断します」等の一文）をそのまま使い、`truncateForTitle` が 60 文字で機械的に切っていた。

**方針:** proposal に任意の `issueTitle`（短い課題名）を追加し、Issue 化を勧めるときはこれを出すようプロンプトで指示。タイトル候補は `issueTitle` → 結論から判断メタを除いた文 → task の順。`truncateForTitle` は句読点付近で切り、上限を 80 に緩和する。

---

## U16. Journal 自動分析の起動タイミングが分かりにくい

**現象:** 投稿時点では自動分析が動かない（設計どおり）。修正がなくても起動したい場合、「編集 → この内容で確定」が必要で分かりにくく、確定済みでフィルタ外／自動 OFF のときは起動手段が無い。

**原因:** 自動検知は初回校正（`supersedes` 初回）かつ Settings フィルタ適合時のみ。投稿直後起動は誤抽出による偽緊急事態を防ぐための意図的な制約。手動の明示起動口が無かった。

**方針:** 投稿時起動は維持しない。未確認カードに「この内容で確定」ショートカットを出し、確定後に相談が無いときは「分析する」でフィルタ／自動 OFF に関係なく明示起動できるようにする。既存相談があるときは「相談を開く」を優先。Settings と確定 UI に「投稿直後は動かない」旨を明記する。

---

## U17. メンバーに「自分自身」を区別できない

**現象:** チーム名簿や People に EM 本人を入れると、他メンバーと同じ「部下」「1on1 対象」として扱われ、Agent の組織コンテキストでも本人である旨が伝わらない。

**原因:** `PersonRecord` / Settings に「利用者本人」フラグが無く、`managedByEm` はチーム属性で本人区別には使えない。

**方針:** Settings に任意の `selfPersonId`（既存の `PERSON_n`）を追加。人物詳細から「自分として設定／解除」。本人は People の「自分」区分・バッジ表示、部下一覧と 1on1 Coverage から除外、Org Context 注入で「利用者本人」と明示。未設定時は従来どおり。統合時は ID 追従、削除時は解除。

---

## U18. OKR設定の一括・AI構造化と編集摩擦

**現象:** Objective / Key Result を1件ずつ追加するしかなく、既存のOKR全文を流し込めない。Key Result のタイトル編集ができず、タイトルも単一行 input。Objective に判断理由などの補足を残す欄が無い。

**原因:** 最小実装として KR は追加・削除のみ（更新 API/ストア無し）。タイトルはすべて `<input type="text">`。自由記述からの構造化導線も無い。

**方針:**
1. KR の更新（ストア・PATCH・UI）と、Objective/KR タイトルの textarea（改行可）化。
2. Objective に任意の `note`（判断理由などの補足）。Agent の `buildObjectivesBlock` にも渡す。
3. 「テキストから取り込む」で全文を貼り、**外部AI（SettingsのCLI優先順）**が Objective/KR/メモに分解 → プレビューで修正 → 追記または同一スコープ（組織全体／指定チーム）の差し替えで保存。ローカル小モデルは使わない。失敗時や Markdown 見出し付きでクラウド結果が薄いときはルールベースへフォールバック。

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
- **U11** 相談・Issue詳細に生成元（Journal / 相談の本文とリンク）を表示。Journalカードから相談へも辿る。`sourceJournalId` / `sourceRunId` を保存
- **U12** 相談履歴は本文（Journal抜粋 / 相談文 / 結論）を先に出し、日時・状態・起点はメタ行へ
- **U13** 状況蒸留の task を短くし材料はシステムプロンプトへ。相談タブは欠落 run を ID 取得でピン留め
- **U14** 朝サマリー材料を `buildMorningSummaryContextBlock` で毎ターン注入。プロンプトを注入ナレッジ前提に変更。再開時は `run.task` を検索クエリへ結合。3 CLI への data 読み取り（C）は今後必須
- **U15** proposal に `issueTitle`。`runFallbackTitle` は短い課題名を優先し、結論からは Issue 化メタを除去。`truncateForTitle` は句読点切れ＋上限 80
- **U16** Journalカードに「この内容で確定」と「分析する」。`POST /api/journal/[id]/analyze` で手動起動。Settings／確定UIに投稿直後は動かない旨を明記
- **U17** `selfPersonId` で既存人物を本人に紐付け。People「自分」区分・1on1/部下除外・Org Context 明示
- **U18** OKR: KR編集API/UI、タイトル textarea（改行可）、Objective `note`（Agent注入含む）、テキスト一括取り込み（外部AI構造化→プレビュー修正→追記/差し替え。Markdownはルールベースでも分解）
