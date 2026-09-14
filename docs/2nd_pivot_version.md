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

#### Phase 2.3 — 周辺モジュールの依存を外す（完了）
`dashboard-next-actions.ts`の`buildExecutionMoves`（Action Item完了チェックのある「実行モード」）を削除し、`TodayActionsPanel`から実行タブ自体を除去（判断待ちのみの単一ビューに）。`staleInterventions`（介入の観測不足）の「着手済みか」判定を`charterFilledCount`/`actionItems.length`/`parentId`から`issue.status !== "not_started"`へ置き換え。`people-hub.ts`の`PersonRelatedIssue`は`charter: IssueCharter`を`overview: string`（`issueOverviewText`で要約）に変更し、`PersonRecordsSection.tsx`の「Why/What/How N/3」完了度バッジを削除。`report-store.ts`の`ReportIssueStats`から`openIncompleteCount`（Why/What/How未整理Issue数）を削除し、`/reports`の表示・テストも追従。

#### Phase 2.4 — 残るIssue管理UI・API（ステータス／優先度／期限／手動採点）を削除（完了・方針変更あり）

**2026-09-15、着手前に再調査した結果、当初案（KnowledgeEventへの全面移行）を取りやめた。** Issue作成はPhase 2.2の結果すでに`ConsultReviewPanel`（title＋出所のみ送信）に一本化されており、新規Issueは既に「タイトル＋根拠だけの軽量な提案」になっている。charterはagent-runtimeのプロンプト文脈として今も補助的に使われており（titleは常に渡る保証がある）、`issues.json`は単なるJSONファイルで動いているプロセス内でしか安全に移行できない——という調査結果を踏まえ、**データモデル（Issue型・`issues.json`）は変えずに、残っている「手入れ用UI」と対応する書き込みAPIだけを削る**方針に変更した。詳細はplanファイルの記録を参照。

実施内容:
- `IssueStatusPriorityPanel.tsx`（ステータス選択・優先度選択・期限・手動再採点ボタン）を`IssueDetailContent.tsx`から削除。
- 対になっていたAI優先度提案の採用/却下（`useIssueSuggestions.ts`の`handleAdopt/DismissSuggestedPriority`、`RunDetail.tsx`の`SuggestedPriorityBlock`表示、`SuggestedPriorityBlock.tsx`本体）を削除。
- `/api/issues/[id]/triage`・`/api/issues/triage/suggest`・`/api/agents/[id]/priority/dismiss`・`/api/issues/[id]/parent`（Phase 2.2の時点で既に呼び出し元が無かった）を削除。
- 呼び出し元が無くなった`issue-store.ts`の書き込み関数（`setIssueTriage`/`rescoreIssueTriage`/`suggestTriageForActiveParents`/`createParentIssue`）と、それらが依存していた優先度自動採点モジュール`issue-triage.ts`全体を削除。`IssueTriageScores`型は「既存の採点結果を読み取り専用で表示する」ためだけに`issue-store.ts`へ残した（`IssueListTable`・`IssueStatus`の`IssueTriageAxes`が引き続き読む）。
- **維持**: `IssueTitleHeader`（タイトル編集＋アーカイブ＝却下）、`IssueStrategyMetaPanel`（チーム/テーマ/KR紐付け——つながりを見るが依存）、`IssueLogSection`（自由記述メモ）、`IssueImpactPanel`・`IssueSubIssuesPanel`（既に読み取り専用）、`IssueCharterSection`・`IssueActionItemsPanel`とそのAI提案採用フロー（agent-runtimeのプロンプト・出力形式と直結するため次のサブフェーズへ持ち越し）。
- Issueのデータ（`issues.json`）・`POST /api/issues`（作成）・agent-runtimeのプロンプト構築には触れていない。

持ち越し: Action Item CRUD（Lead Agentのプロンプト見直しが必要）、Charter編集UI（charter依存7〜8箇所をKnowledgeEventベースの文脈へ置き換える設計が必要）、`/issues`一覧・詳細のさらなる軽量化。

#### Phase 2.4（続き） — Action Item CRUDを削除（完了）

**2026-09-15、Phase 2.4完了後にユーザーから続行指示を受け、持ち越し項目のうちAction Item CRUDに着手した。** Charterと異なりAction Itemはagent-runtimeのどのプロンプトからも文脈として読まれておらず（提案生成のみに使われる一方通行）、削除してもAIの状況把握力への影響が無いことを確認済みだったため、計画モードへ戻らず着手した。

実施内容:
- UI: `IssueActionItemsPanel.tsx`を追加・完了チェック・削除・子Issueへの昇格の無い読み取り専用表示（次の一手／あとでやる予定／完了、の3グループ）に書き換え。クロスIssueの「アクション」一覧ビュー`IssueActionsTable.tsx`と、それに紐づく`IssueFilterBar.tsx`のタブ切り替えUI（`IssueViewMode`型ごと）を削除し、`/issues`一覧は常にリスト表示に一本化。
- AI提案の採用/却下フロー: `SuggestedActionItemsBlock.tsx`、`useIssueSuggestions.ts`のAction Item採用/却下ハンドラ、`RunDetail.tsx`側の配線を削除。
- API: `/api/issues/[id]/action-items/*`（追加・トグル・削除・子Issue昇格）、`/api/agents/[id]/action-items/dismiss`を削除。
- `issue-store.ts`: `addActionItem`/`setActionItemAsNext`/`promoteActionItemToChildIssue`/`toggleActionItem`/`removeActionItem`を削除。自由記述ログ用の`addLogEntry`（pivot_policy §2が明示的に許容する入力のため維持）はそのまま残置。
- agent-runtime: `context-blocks.ts`から`actionItemsRule`（Action Item下書き提案の指示）を削除し、`subIssuesRule`/`charterRule`の文言から`action_items`ブロックへの参照を除去。`run-actions.ts`（`buildIssueDraftTask`）・`scheduled-tasks.ts`（`buildIssueUpdateTask`）のタスク文言からもAction Items関連の指示を除去。`extraction.ts`の`extractActionItems`、`store.ts`の`clearSuggestedActionItems`を削除し、`index.ts`の再エクスポート・`cli-runners/core.ts`の呼び出しも追従。
- ついでの修正: 調査の過程で、`priorityRule`（優先度提案の指示）がPhase 2.4本体で採用/却下UIを削除した後も**プロンプトへ出力させ続けているだけの無駄**になっていたことが分かったため、`priorityRule`・`extractPriority`・`clearSuggestedPriority`も同時に削除した（`parseSuggestedPriority`は`normalizeSuggestedSubIssues`のサブIssue優先度パースに使われているため維持）。
- Issueのデータ（`issues.json`）・Charter編集UI・`POST /api/issues`（作成）には触れていない。
- `npm run lint` / `tsc --noEmit` / `npm run build` / Vitest全体（1053件）を確認済み。dev serverを再起動した上でダッシュボード・`/issues`・既存Issue詳細ページの実描画（200応答・エラーマーカー無し）も確認済み。
- 持ち越し: Charter編集UI（Phase 2.4の唯一の残タスク。agent-runtimeのcharter依存7〜8箇所をKnowledgeEventベースの文脈へ置き換える設計が必要なため、着手前に計画モードへ戻る想定）。

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
- [x] Phase 2.3 — 周辺モジュールの依存を外す（2026-09-15）
  - `web/src/lib/dashboard-next-actions.ts`: `ExecutionMove`型と`buildExecutionMoves`を削除。`staleInterventions`の判定を`charterFilledCount(i.charter) > 0 || i.actionItems.length > 0`から`i.status !== "not_started"`へ変更、`!i.parentId`フィルタも撤廃。
  - `web/src/components/dashboard/TodayActionsPanel.tsx`: 「判断／実行」タブと実行モード一式（Action Item完了チェックボックス、`handleCompleteExecutionMove`等）を削除し、判断待ちのみの単一ビューにした。`web/src/app/page.tsx`の`handMode`状態・`executionMoves`計算・関連propsも削除。
  - `web/src/lib/people-hub.ts`／`web/src/lib/types.ts`: `PersonRelatedIssue.charter: IssueCharter`を`overview: string`（`issueOverviewText`で要約）に変更。`web/src/components/person-detail/PersonRecordsSection.tsx`の「Why/What/How N/3」完了度バッジ列を削除し、要約テキスト表示に変更。
  - `web/src/lib/report-store.ts`／`web/src/lib/types.ts`: `ReportIssueStats`から`openIncompleteCount`（現在Why/What/How未整理のIssue数）を削除。`web/src/app/reports/page.tsx`の表示・`report-store.test.ts`のテストも追従。
  - Issueのデータ・API・`/issues`UI・agent-runtimeには触れていない（`priority`/`actionItems`フィールド自体はまだIssueに残っている。使う側を減らしただけ）。
  - `npm run lint` / `tsc --noEmit` / `npm run build` / Vitest全体（1102件、openIncompleteCountのテスト削除分で1件減）を確認済み。ダッシュボード・`/reports`・`/people/[id]`（実データ）の実描画も確認済み。
- [x] Phase 2.4 — 残るIssue管理UI・API（ステータス／優先度／期限／手動採点）を削除（2026-09-15）
  - 方針変更: 当初案（`issues.json`をKnowledgeEventへ全面移行）は取りやめ、Issueのデータモデルは維持したまま「手入れ用UI」と対応APIだけを削る方針にした（理由の詳細は本ファイル上部のPhase 2.4節）。
  - 削除: `IssueStatusPriorityPanel.tsx`（ステータス/優先度/期限/手動再採点）、`SuggestedPriorityBlock.tsx`＋`RunDetail.tsx`内の表示、`useIssueSuggestions.ts`の優先度採用/却下ハンドラ、`/api/issues/[id]/triage`、`/api/issues/triage/suggest`、`/api/agents/[id]/priority/dismiss`、`/api/issues/[id]/parent`（既に呼び出し元なし）。
  - `web/src/lib/issue-store.ts`: 呼び出し元が無くなった`setIssueTriage`/`rescoreIssueTriage`/`suggestTriageForActiveParents`/`createParentIssue`を削除。優先度自動採点モジュール`web/src/lib/issue-triage.ts`は依存元が無くなったため全体削除（`IssueTriageScores`型は既存データの読み取り専用表示用に`issue-store.ts`へ残置）。
  - 維持: タイトル編集＋アーカイブ、チーム/テーマ/KR紐付け（つながりを見るが依存）、自由記述ログ、介入前後比較、既存階層の読み取り表示、Charter編集・Action Item CRUD（次のサブフェーズへ持ち越し）。
  - Issueのデータ（`issues.json`）・`POST /api/issues`（作成）・agent-runtimeのプロンプト構築には触れていない。
  - `npm run lint` / `tsc --noEmit` / `npm run build` / Vitest全体（1081件）を確認済み。`/issues`・実データで作成したIssue詳細ページ（作成→アーカイブまで実施）・ダッシュボードの実描画も確認済み。
  - 持ち越し: Action Item CRUD（Lead Agentのプロンプト見直しが必要）、Charter編集UI（agent-runtimeのcharter依存7〜8箇所をKnowledgeEventベースの文脈へ置き換える設計が必要）、`/issues`のさらなる軽量化。
- [x] Phase 2.4（続き） — Action Item CRUDを削除（2026-09-15）
  - UI: `IssueActionItemsPanel.tsx`を読み取り専用化、`IssueActionsTable.tsx`（アクションビュー）と`IssueFilterBar.tsx`のビュー切り替えタブを削除、`SuggestedActionItemsBlock.tsx`とその採用/却下フローを削除。
  - API: `/api/issues/[id]/action-items/*`・`/api/agents/[id]/action-items/dismiss`を削除。`issue-store.ts`の`addActionItem`等5関数を削除（`addLogEntry`は維持）。
  - agent-runtime: `context-blocks.ts`から`actionItemsRule`を削除し関連文言を整理。あわせて表示先の無くなっていた`priorityRule`（Phase 2.4本体の削除で宙に浮いていた）も削除。`extraction.ts`/`store.ts`/`index.ts`/`cli-runners/core.ts`/`run-actions.ts`/`scheduled-tasks.ts`が追従。
  - `npm run lint` / `tsc --noEmit` / `npm run build` / Vitest全体（1053件）を確認済み。dev server再起動後にダッシュボード・`/issues`・Issue詳細ページの実描画も確認済み。
  - 持ち越し: Charter編集UI（Phase 2.4唯一の残タスク。着手前に計画モードへ戻る想定）。
- [ ] Phase 3 — 入力導線の簡素化
- [ ] Phase 4 — レガシー面の縮小
- [ ] Phase 5 — Reports / Timeline の追従
