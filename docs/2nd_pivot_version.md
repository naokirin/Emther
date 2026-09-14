# Emther 2nd Pivot — 実装計画

> 方針そのものは `docs/2nd_pivot_version/pivot_policy.md` を参照。本ドキュメントはその方針に基づく実装計画（2026-09-14時点）。

## Context

現状のEmtherは Issue（階層化、Action Item、Priority、Charter[why/what/how]、Archive、4軸Triageスコア等）を中心とした「EMが管理するシステム」になっている。`docs/memo.md`にもある通り、実際に使ってみると「EMとしてのIssueと備忘に近いタスク系のものが混在して大量にやることが積まれ、管理が難しい」という実利用上の課題が出た。

pivot_policy.mdの結論は明確で、AIが **Observe / Interpret / Remember / Suggest** を担い、EMは **Decide / Communicate / Intervene** に集中する。Issueは「Emtherが管理する最終成果物」ではなく「AIが観測・解釈した結果として現れる判断材料の一つ」に格下げし、実際のタスク管理はJira/Notion等の既存ツールに委ねる。EMの入力は「管理のため」ではなく「重要な情報を残すため」であり、細分類はAIに寄せる。

このドキュメントは、現行コードベースの何を活かし（すでにpivotの理念に近い部分がある）、何を解体するかを整理し、段階的な移行手順を示す。

---

## 現状の棚卸し（既存資産の評価）

**すでに方針と親和性が高く、活かす部分:**
- `web/src/lib/agent-runtime/`（Lead Agent + People/Process/Tech/Product/Exec専門エージェント、`agent-catalog.ts`のROLE_BLOCKS）— すでに「Observe→Interpret→Suggest→EMへYield」の多段構成。`YieldKind`（decide/inform/commit）は「AIは答えでなく判断材料を出す」を体現済み。
- `web/src/lib/knowledge-store.ts`（`KnowledgeEvent`: kind=fact/interpretation、embeddingベースの`searchSimilarEvents`、`listRecentChangeEvents`）— pivot_policy §4「組織の記憶」の実装基盤そのもの。過去との比較に使える検索機構がすでにある。
- Journal（`journal-store.ts`）+ AI抽出（tags/people/urgency）+ EM確認フロー、`observation-dump-*`（議事録等のまとめ投入）— pivot_policy §2「入力→AIが整理→人間は必要なら訂正」に合致。
- ダッシュボード（`app/page.tsx`, `DailyBriefBanner.tsx`, `dashboard-next-actions.ts`）— すでに「一言診断＋今日やるべきこと」という蒸留UIの原型がある。

**方針と衝突し、解体・格下げが必要な部分:**
- `Issue`型（`types.ts`）が抱える人間管理フィールド一式: `parentId`階層、`ActionItem`のCRUD（done/promote）、`IssueCharter`(why/what/how)必須入力、`IssuePriority`の人間による設定・永続化、Archiveライフサイクル、`IssueLogEntry`手動ログ、`IssueTriageScores`の永続4軸スコア。
- 対応API: `/api/issues/[id]/action-items/*`, `/parent`, `/archive`, `/triage`, `/impact`, `/log` — いずれも「EMがIssueを管理する」ことを前提にしたエンドポイント群。
- `/issues`, `/issues/[id]` — Issue管理専用の一覧・詳細画面。

---

## 目標モデル

Issueを独立した管理エンティティとして廃止し、既存の`KnowledgeEvent`（kind: fact/interpretation）に **「Issue化しうる」という属性を持たせた提案** として統合する。新しい並列テーブルを作らず、すでにembedding検索・lineage・entity紐付けを持つ`KnowledgeEvent`を再利用するのがpivot_policy §4「組織の記憶」の趣旨に最も合う。

新モデルが持つのは最小限:
- タイトル（AIが要約）
- 根拠（元Journal/KnowledgeEvent/Themeへのリンク）
- 状態: `open`（未確認）/ `acknowledged`（EMが見た）/ `archived`（対応不要・完了・エクスポート済）
- 任意のexportメモ（Jira/Notion等にコピーした際のリンクだけ保持。Emther側でチケットのライフサイクルは追わない）

**持たせないもの**: 階層（親子）、Action Item CRUD、人間が設定するPriority、Charter必須入力、独立したArchiveワークフロー。優先度に関する示唆は「Suggest」層（ダッシュボードの一言診断）がその場で計算する一時的なランキングに留め、エンティティに永続フィールドとして持たせない。

---

## フェーズ計画

### Phase 1 — 今日のブリーフを本当の入口にする（最小変更・最優先）
- `DailyBriefBanner` / `TodayActionsPanel` / `dashboard-next-actions.ts` を拡張し、pivot_policy §「目指すUX」の6項目（昨日から変わったこと／気になる兆候／良い状態／評価できないこと／過去との比較／判断する価値がありそうなこと）を構成する。
- 「過去との比較」は`knowledge-store.searchSimilarEvents` / `listRecentChangeEvents`を使い、既存インフラを流用する（新規実装最小化）。
- この段階ではIssueの内部データモデルには触れず、ダッシュボードの情報源をIssue駆動から「KnowledgeEvent + Journal + Vitals」駆動へ寄せることに集中する。

### Phase 2 — Issueのデータモデルを解体する

**2026-09-14、Phase 1完了後に調査した結果、当初見積りより依存が深いことが分かった。** 一括では行わず、下記のサブフェーズへ分割する。

**調査で分かったこと（要点）:**
- Issue作成は**人間駆動**（`IssueCreateDialog`／`IssueHierarchyDialog`／`ConsultReviewPanel`の3箇所）。作成後にLead Agent runが起動する（逆方向で、エージェントが自発的にIssueを作るわけではない）。
- agent-runtimeはIssueへほぼ書き込まない（例外: `issue-notes`採用時の`log`追記）が、`charter`は`context-blocks.ts`等でAIへの**プロンプト文脈として重く読まれている**（17箇所）。
- `dashboard-next-actions.ts`は`priority`・`actionItems.length`・`parentId`・`charterFilledCount`を判定ロジックへ使っている。
- `people-hub.ts`の`PersonRelatedIssue`は`IssueCharter`をまるごと人物詳細UIへ渡している。`report-store.ts`の`ReportIssueStats`は`parentId`・charter充足度に依存。
- `strategy-trail.ts`（つながりを見る）は`keyResultId`と`id`/`title`だけしか使っておらず軽量——当初計画通り温存できる。
- `/issues`一覧・詳細だけで18コンポーネントファイル（ボード表示・一括再採点ツールバー・スコアギャップ可視化など、想定より機能が多い）。

#### Phase 2.1 — ダッシュボードのIssueグルーミング誘導を止める（完了）
`dashboard-next-actions.ts`から、EMにIssueの構造を手入れさせる方向の次アクションを外した。「Issue未整理」「次の一手未設定」カードを削除、`issueNeedsCharter`関数も削除。「介入の観測不足」（効果を観測したか）と実行モードのAction Item一覧は維持。Issueのデータ・API・`/issues`UI・agent-runtimeには触れていない。

#### Phase 2.2 — 新規の人間発のIssue管理を止める（完了）
`IssueCreateDialog`（一覧の「＋新しいIssue」）・`IssueHierarchyDialog`（詳細の「＋サブIssueを追加」「⬆上位Issueを作る」）を削除。Issue化は「AI提案を承認する」（`ConsultReviewPanel`、`POST /api/issues`自体は維持）経路のみに一本化した。ユーザー確認: 相談したい場合は「今後システム内でIssueを管理していない状態でも、相談チャット（/chat）で十分カバーできる」との方針。あわせて`/issues`一覧の「ボード」「スコア差」ビューと一括再採点ツールバー（`IssueTriageToolbar`）を削除（ステータス・優先度の手入れを促す機能のため）。「リスト」「アクション」ビューと既存の親子関係の読み取り表示は維持。Issueのデータ・API（作成含む）・agent-runtimeには触れていない。

#### Phase 2.3（未着手）— 周辺モジュールの依存を外す
`dashboard-next-actions.ts`の`priority`/`actionItems`/`parentId`依存を除去。`people-hub.ts`の`PersonRelatedIssue`を`IssueCharter`全体ではなく要約テキストに変更。`report-store.ts`の`ReportIssueStats`を`parentId`/charter非依存の指標に再定義。

#### Phase 2.4（未着手）— データモデル・API・UIの本体差し替え
`KnowledgeEvent`に「Issue化しうる」フラグ・状態（open/acknowledged/archived）を追加。既存Issueデータは削除せず読み取り専用の記憶へ変換（階層・Action Item・永続Priority・Triageスコアは破棄）。`/api/issues/[id]/action-items/*`, `/parent`, `/archive`, `/triage`, `/impact`, `/log` を廃止。`/issues`, `/issues/[id]` を新モデル用の軽量な一覧に置き換え。agent-runtimeのcharter依存箇所をKnowledgeEvent由来のナラティブ文脈へ置き換える。

### Phase 3 — 入力導線の簡素化
- Journal / observation-dump からの投入が「どのIssueに紐付けるか」を人間に決めさせず、AIがKnowledgeEventへ直接分類する流れを徹底する。
- `person-evaluation-store.ts`（評価ログ）等、Issue以外の構造化入力も同様に「入力→AI整理→必要なら訂正」の型になっているか点検する。

### Phase 4 — レガシー面の縮小
- `issue-triage.ts`の永続スコアリング機構を廃止し、「判断する価値がありそうなこと」のランキングはブリーフ生成時にその場で計算する一時的なものにする。
- `/org/thread`（つながりを見る、`strategy-trail.ts` / `related-context.ts` / `origin-trace.ts`）はObjective→KeyResult→Issue→Journalの縦の接続を可視化する機能として価値が確認済み（`docs/memo.md`参照）なので**維持**するが、参照先をIssue階層から新モデル（KnowledgeEventのIssue化フラグ）に付け替える。
- ナビゲーションから「Issue管理」の位置付けを外し、「判断待ち」の一部として扱う。

### Phase 5 — Reports / Timeline の追従
- `report-store.ts`の`ReportIssueStats`を「解決したIssue数」から「観測された状態変化」ベースの指標に更新。
- `timeline.ts`（journal/person/team/issue/org横断フィード）は構造を維持しつつ、issueエントリの参照先を新モデルに更新。

---

## 明示しておく前提（実装中に覆してよい判断）
- 既存Issueデータは**破棄しない**。読み取り専用の記憶に変換するのがデフォルト。
- Jira/Notion等への実APIエクスポートは今回のスコープに含めない（pivot_policy自身が「既存ツールに委ねる」としているため、コピー用テキスト生成に留める）。
- 移行は一括コミットではなく、Phase単位で段階的に進める（「一気に作り変える」は方向性の話であり、レビュー可能な単位でPRを刻む）。

---

## 検証方法
- `npm run lint` と既存Vitestスイート（現状503件、issue関連テストは書き換え/削除が必要）を都度実行。
- Phase 1完了時点でダッシュボードを実際に開き、6カテゴリのブリーフがJournal/KnowledgeEventの実データから生成されることを確認。
- Phase 2完了時点で `/issues` 配下に作成・階層・Action Item UIが残っていないこと、既存Issueデータが記憶として閲覧できることを確認。
- Phase 4完了時点で `/org/thread` のパンくずが新モデルでも壊れていないことを確認。

---

## 進捗

- [x] Phase 1 — 今日のブリーフの6項目化（初期実装。2026-09-14）
  - `web/src/lib/daily-situation.ts`: 6カテゴリ（昨日から変わったこと／気になる兆候／良い状態／評価できないこと／過去との比較／判断する価値がありそうなこと）を組み立てる純粋関数。新規API・永続化は追加せず、既存のJournal/Vitals/People/`buildNextActions`（判断待ちレーン）を再利用。「過去との比較」は今週・先週のJournal件数比較（量的）＋既存の長期解釈`KnowledgeEvent(interpretation)`（質的、`/api/knowledge/interpretations`を新規フック`useInterpretations`で取得）の組み合わせ。
  - `web/src/components/dashboard/DailySituationPanel.tsx`: 上記をカード形式で表示。`app/page.tsx`の`DailyBriefBanner`直下に追加（既存のDailyBriefBanner/TodayActionsPanelは維持したまま並置）。
  - テスト: `web/src/lib/daily-situation.test.ts`（6件）。`npm run lint` / `tsc --noEmit` / `npm run build` / Vitest全体（新規分含め成功、既存の一部テストはローカルモデル起動待ちで時々タイムアウトするが今回の変更とは無関係）を確認済み。ブラウザでの目視確認は今回未実施（Claude in Chrome未接続のため）。
  - 次の課題: Issueデータモデルには未着手（Phase 2で対応）。「過去との比較」は今回テキスト一致（人物名）ベースの素朴な紐付けで、Embedding類似検索（`knowledge-store.searchSimilarEvents`）を使ったより広い比較は今後の改善余地。
  - デザイン見直し（ユーザー指摘、2026-09-14）: 「テキスト・バイタル・ステータスが同じレイアウトのカードに入っている」への対応として、気になる兆候／良い状態／評価できないことの3カテゴリ（実体はTeam/PersonのVitalsステータス）を、既存`TeamStatePanel`と同じ🟢🟡🔴⚪の色分けチップ1本（`.situationChipRow`）にまとめた。昨日から変わったこと／過去との比較は文章カード、判断する価値がありそうなことは`TodayActionsPanel`との重複を避け先頭1件だけのティーザーにした。
  - バグ修正（ユーザー指摘、2026-09-14）: `unmaskNames`（`web/src/lib/people-directory.ts`）が、対応表に登録の無い裸ID（例: カウンタリセット等で失効した`PERSON_20`）を、短い既登録ID（`PERSON_2`）への部分一致で誤って「佐藤さん0」のような別人名に化けさせていた。`/PERSON_\d+/`で数字列を貪欲に消費してから解決するよう修正し、未登録IDは誤帰属せず素通しにした。回帰テスト追加済み（`people-directory.test.ts`）。ローカルDBは同日中にリセット＋クリーンなテストデータで再投入済み（詳細はメモリ`project_data_reset_seed_2026-09-14`参照）。
  - 追加修正（ユーザー指摘、2026-09-14）: 「Journalもチップ化されている／リンク先とチップのテキストが違う」対応。状態チップ（`.situationChipRow`）はTeam/PersonのVitals（継続的な状態）専用にし、緊急ネガティブJournal（個別の出来事）は`SituationItem.status`を付けないことで区別し、「気になる兆候（出来事）」という別の文章カードへ分離した。また、チームのチップは以前`/teams`（一覧）へ飛ぶだけでその場でどのチームか分からなかったため、`/journal?focus=`と同じ導線で`/teams?focus=<teamId>`へ飛ぶようにし、チップのテキストとリンク先の対象を一致させた（Personチップはもともと`/people/<id>`で一致していた）。
  - レイアウト再調整（ユーザー指摘、2026-09-14）: 「過去との比較は常に1行しかないので専用の1行に」「昨日から変わったこと・気になる兆候（出来事）は2段組みで幅を使いたい」対応。過去との比較はカード化せず区切り線1本の全幅帯（`.situationCompareRow`）にし、昨日から変わったこと／気になる兆候（出来事）は小さいカードのグリッドではなく既存の`.dashColumns`（固定2カラム、1000px以下で縦積み）を再利用してウィンドウ幅を使うようにした。「過去との比較の下にマージンが無い」「チーム・メンバーのチップはステータス色でわかるので名前だけで良い」「チーム・メンバーが混合で並んでいる」という追加指摘にも対応: `.situationCompareRow`に`margin-bottom`を追加、`SituationItem.text`はチーム名／メンバー名のみにして詳細（旧text）は`SituationItem.detail`（チップのホバーtitle）へ逃がし、`SituationItem.entityKind`（team/person）でチーム段落・メンバー段落に分けて表示するようにした。「過去との比較」を「チーム・メンバーの状態」の直下に配置する並び順変更も反映済み。
- [x] Phase 2.1 — ダッシュボードのIssueグルーミング誘導を止める（2026-09-14）
  - `web/src/lib/dashboard-next-actions.ts`: 「Issue未整理」（`charter-${issue.id}`）「次の一手未設定」（`missing-next-${issue.id}`）カードと、それらでのみ使われていた`issueNeedsCharter`関数を削除。「介入の観測不足」（`stale-issue-*`）とexecuteモードのAction Item一覧（`buildExecutionMoves`）は維持。Issueのデータ・API・`/issues`UI・agent-runtimeは未変更。
  - `npm run lint` / `tsc --noEmit` / `npm run build` / Vitest全体（1108件）を確認済み。ダッシュボードの実描画も確認済み。
- [x] Phase 2.2 — 新規の人間発のIssue管理を止める（2026-09-14）
  - 削除: `IssueCreateDialog.tsx`（一覧の手動起票）、`IssueHierarchyDialog.tsx`（詳細のサブIssue追加／上位Issue作成）、`IssueBoard.tsx`＋`IssueBoard.test.tsx`（ボードビュー）、`IssueScoreGapsView.tsx`（スコア差ビュー）、`IssueTriageToolbar.tsx`（一括再採点）。
  - 変更: `src/app/issues/page.tsx`（ダイアログ・ボード/スコア差ビュー・ツールバーの配線を除去）、`IssueFilterBar.tsx`（`IssueViewMode`を`"list" | "actions"`に縮小、作成ボタン・ボードタブ・ボード用チェックボックスを削除）、`IssueDetailContent.tsx`／`IssueSubIssuesPanel.tsx`（階層作成ダイアログの配線を除去、既存の親子関係は読み取り表示のまま維持）。
  - ユーザー確認（2026-09-14）: 「相談したい課題があれば、Issueを管理していない状態でも相談チャット（/chat）で十分カバーできる」との方針を受け、手動作成系UIを削除する判断をした。
  - Issueのデータ・API（`POST /api/issues`＝ConsultReviewPanel経由のAI提案承認フローは維持）・agent-runtimeには触れていない。
  - `npm run lint` / `tsc --noEmit` / `npm run build` / Vitest全体（1103件、IssueBoard.test.tsx削除分で5件減）を確認済み。`/issues`・`/issues/[id]`（存在しないID）・ダッシュボードの実描画も確認済み。既存Issueが無い状態での確認のため、子Issueが実在する詳細画面の見た目は未確認。
  - Phase 2.3以降（周辺モジュールの依存除去、データモデル・API・UI本体の差し替え）は未着手。
- [ ] Phase 3 — 入力導線の簡素化
- [ ] Phase 4 — レガシー面の縮小
- [ ] Phase 5 — Reports / Timeline の追従
