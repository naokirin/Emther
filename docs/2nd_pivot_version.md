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

#### Phase 2.4（続きその2） — Charter編集UIを削除（完了・Phase 2.4完全完了）

**2026-09-15、計画モードへ戻って再調査した結果、当初懸念していた「agent-runtimeのcharter依存7〜8箇所をKnowledgeEventベースの文脈へ置き換える」規模の作業は不要と判明し、スコープを大幅に縮小できた。** charterの読み取り消費箇所（`context-blocks.ts`/`batch-context-blocks.ts`/`run-actions.ts`/`scheduled-tasks.ts`/`agent-knowledge-tools.ts`/`related-context.ts`の7〜8箇所）はすべて`issue.charter`というデータを直接読むだけで、EMの手入力UIとは無関係。加えて、charterには既に「AIが提案しEMが採用/却下する」経路（`charterRule`→`extractCharter`→`SuggestedCharterBlock`→`useIssueSuggestions.ts`の採用ハンドラ）が実装済みで、これはPhase 2.4本体で維持したsub_issues/issue_notesと同じ「AIがSuggest→EMがDecide」構造であり、pivot方針と衝突しない。衝突しているのは`IssueCharterSection.tsx`の**編集モード**（textarea自由入力＋Save）だけだった。

実施内容:
- `IssueCharterSection.tsx`を読み取り専用に書き換え。`charterEditing`状態・textarea 3つ・介入の型タグ選択・タグ入力・`handleSaveCharter`等の編集系ロジックを全削除。Why/What/Howの閲覧表示（MarkdownView）・`charterFilledCount`警告バナー（クリック不可の純表示）・タグのチップ表示（読み取りのみ）・変更履歴は維持。Props を`{issue, history}`のみに縮小し、`IssueDetailContent.tsx`の呼び出し側も追従。
- 「介入の型」タグ編集UIも同時に削除。`selectRelatedSpecialists`（`context-blocks.ts`）はタグが空なら全専門エージェントにフォールバックするだけで機能停止せず、かつPhase 2.2確認済みの通り現行のIssue作成経路（`ConsultReviewPanel`）は既にタグを送っていないため、新規Issueの挙動は変化しない。
- `page.module.css`の`.charterField textarea`／`.charterField textarea.charterEmpty`／`.charterField label`（textarea専用ルール、使用箇所ゼロ化）を削除。`.charterEmptyView`から`cursor: pointer`（クリック不可になったため）を除去。`.charterField`/`.charterWarnBanner`/`.editableTextView`/`.charterSection`は他コンポーネント（`IssueSubIssuesPanel`/`EveningModeCard`/`JournalEntryCard`/`IssueStrategyMetaPanel`）と共有のため維持。
- **触れていない**（挙動を完全維持）: `issue-store.ts`の`updateIssueCharter`（AI提案採用フローが引き続き呼ぶ）、`/api/issues/[id]`のPATCHルート、`context-blocks.ts`の`charterRule`/`buildIssueContextBlock`/`buildOrgBackgroundBlock`、`batch-context-blocks.ts`の朝サマリー/週次蒸留、`run-actions.ts`の`buildIssueDraftTask`、`scheduled-tasks.ts`の`buildIssueUpdateTask`、`extraction.ts`の`extractCharter`、`RunDetail.tsx`の`SuggestedCharterBlock`表示、`useIssueSuggestions.ts`の`handleAdopt/DismissSuggestedCharter`、`IssueListTable.tsx`等の`charterFilledCount`/`issueOverviewText`読み取り表示。
- `IssueCharterSection`専用のテストファイルが存在しなかったため、テスト破壊は無し。
- `npm run lint` / `tsc --noEmit` / `npm run build` / Vitest全体（1053件、変化なし）を確認済み。dev server再起動後にダッシュボード・`/issues`・Issue詳細ページの実描画（200応答・エラーマーカー無し）も確認済み。
- **これでPhase 2.4の持ち越し項目（Action Item CRUD・Charter編集UI）は両方解消し、Phase 2.4は完全完了。**

### Phase 3 — 入力導線の簡素化（完了）

**2026-09-15、Phase 2.4完全完了後に着手。計画モードで調査した結果、元の課題文（「どのIssueに紐付けるか人間に決めさせない」）は既に大部分解消済みと判明した。** Journal作成・observation-dump受理・KnowledgeEventへの分類はすべて完全にAI駆動で、`ConsultReviewPanel`のIssue化もAI提案候補の採用/却下のみ（既存Issueを選ばせない）。唯一残っていた人間決定UIは`JournalEntryCard.tsx`の「解決 / 追跡」ブロック内、EMがIssue IDを手入力して既存Issueに紐付ける「既存Issueに紐付ける」テキスト入力＋ボタンだった。

実施内容:
- `JournalEntryCard.tsx`から「既存Issueに紐付ける」のID手入力＋ボタンを削除。`useJournalEditing.ts`の`linkIssueIdDraft`ステート・`linkToExistingIssue`関数を削除し、呼び出し側2箇所（`JournalDumpPanel.tsx`、`app/journal/page.tsx`）のprop配線も追従。テスト（`useJournalEditing.test.tsx`の3件、`JournalEntryCard.test.tsx`の不要プロパティ）も追従。
- **維持**: 「Issueを起票してこの件を追跡する」（`resolveWithNewIssue`、作成直後の新規Issueへの自動紐付けであり複数の既存Issueから選ぶ操作ではないため）、「メモを残して解決にする」（自由記述の解決メモ）、「解決を取り消す」——いずれもIssue選択とは無関係。`PATCH /api/journal/[id]`の`resolvedIssueId`処理・プレフィックス解決ロジックも`resolveWithNewIssue`が引き続き使うため無変更（コメントのみ実情に合わせて更新）。
- Issue以外の構造化入力の点検結果: **評価ログ**（`person-evaluation-store.ts`、手動作成フォーム自体が無くAI提案`suggest-from-journal`のみ）・**Journal作成**（自由記述＋任意日付のみ、タグ/緊急度は事後AI付与）・**Theme**（`createThemeCandidate`はagent-runtime/OKR由来のみ）は**既にAI起点で完了**、追加対応不要と確認。Team（名前・メンバー・Mission/制約）とOKR入力は現状すべて手動構造化入力（OKRのみ「テキストから取り込む」というAI下書きパスが別途ある）だが、**ユーザー判断によりPhase 3の対象外**とした——新規AI下書き機能の設計は、実際に手間だと感じてから別セッションで改めて計画する。
- `npm run lint` / `tsc --noEmit` / `npm run build` / Vitest全体（1050件、テスト3件減）を確認済み。dev server再起動後にダッシュボード・`/journal`・`/issues`の実描画（200応答）も確認済み。

### Phase 4 — レガシー面の縮小（完了・当初計画は大部分が既に無効化済みと判明）

**2026-09-15、Phase 3完了後に着手。計画モードで再調査した結果、元の3方針のうち2つは既に他フェーズで実質解決済み・または前提（KnowledgeEventへの移行）が撤回済みのため無効化されていると判明した。**

- 「`issue-triage.ts`の永続スコアリング機構を廃止...」→ **完了・無効化済み**。`issue-triage.ts`はPhase 2.4（コミットba152cc）で既に全削除済み。「判断する価値がありそうなこと」（`daily-situation.ts`の`worthDeciding`、`dashboard-next-actions.ts`の`buildNextActions`）はPhase 1時点から一貫して永続フィールドを読まず、呼び出しごとにその場で計算している。副産物として、Phase 2.2の削除漏れだった**呼び出し元ゼロの死んだコード**`issue-score-gaps.ts`＋テストを削除した。
- 「`/org/thread`の参照先をIssue階層から新モデル（KnowledgeEvent）へ付け替える」→ **前提が撤回済みのため無効**。IssueをKnowledgeEventへ移行する方針自体をPhase 2.4で撤回し、Issueは`issues.json`のままの実体として残すことに決めている。`/org/thread`（`StrategyThreadTree.tsx`）と`strategy-trail.ts`は素のIssueフィールド（`keyResultId`/`id`/`title`/`status`/`sourceJournalId`）だけを軽く読んでおり、既に問題なく動作しているため**変更不要**と確認した。
- 「ナビゲーションから『Issue管理』の位置付けを外す」→ **文言としては既に解消・構造は現状維持と判断**。`TopNav.tsx`に「Issue管理」というラベル自体は元から存在せず、既に「課題」「課題一覧」へ軟化済み。「課題」タブを「今日」配下へ統合するかはユーザーに確認し、**現状維持**の判断を得た（`/issues`は既に作成・編集UIがほぼ無く、AI提案のIssueを閲覧するだけのページになっているため、独立タブのままでも「EMが管理する場所」という誤解は生まれにくいという判断）。
- `npm run lint` / `tsc --noEmit` / `npm run build` / Vitest全体（1041件、削除した死んだコードのテスト分減）を確認済み。

### Phase 5 — Reports / Timeline の追従（完了・想定と異なる実在バグが見つかった）

**2026-09-15、Phase 4完了後に着手。計画モードで元の2方針を再調査した結果、「新モデルへの付け替え」（`timeline.ts`側）は想定通り前提無効で対応不要だったが、Phase 4までとは異なり「`report-store.ts`の指標更新」側には実在する具体的な不具合が見つかった。**

- 「`timeline.ts`のissueエントリ参照先を新モデルに更新する」→ **無効（変更不要）**。`resolveEntity`は`issue.id`/`issue.title`のみを読んでおり、既に素のIssueフィールドに対して問題なく動作している。
- 「`report-store.ts`の`ReportIssueStats`を『解決したIssue数』から『観測された状態変化』ベースの指標に更新する」→ **前提は無効だが、元の問題意識自体は正しく、実在する不具合があった。** `ReportIssueStats.doneCount`/`doneTitles`（`daily-trends.ts`の`issueDone`、`DailyTrendChart.tsx`の「解決」系列も同様）は`Issue.doneAt`を集計していたが、`doneAt`を書き込む唯一のUI（`IssueStatusPriorityPanel.tsx`）はPhase 2.4で削除済みで、この値を設定する経路は実質存在しない。つまりPhase 2.4以降に作られたIssueの`doneCount`は**構造的に必ず0のまま**なのに、`/reports`画面は「解決 N件」を主要指標として表示し続けていた——達成できないはずの実績を約束する実害のあるバグだった。

実施内容:
- `report-store.ts`の`ReportIssueStats`型・`computeIssueStats`・`toReportView`から`doneCount`/`doneTitles`を削除（`types.ts`のクライアント向け型も追従）。
- `daily-trends.ts`の`JournalIssueDailyPoint`・`buildJournalIssueDailyTrend`から`issueDone`（`doneByDay`集計含む）を削除。`DailyTrendChart.tsx`の`ISSUE_SERIES`から「解決」系列を削除し、関連する空状態メッセージ・コメントも「起票」のみに整理。
- `reports/page.tsx`のサマリー行・「Issue進捗」セクションから「解決」関連の表示を削除。起票・アーカイブの表示は維持。
- `report-store.test.ts`・`daily-trends.test.ts`・`DailyTrendChart.test.tsx`の関連アサーション・テストヘルパー（`setIssueStatus(..., "done")`のテスト用セットアップ含む）を削除・調整。
- 元のPhase 5の意図（「観測された状態変化」ベースの指標）は、**既に存在し正しく機能している`ReportEventStats.byEntityType`**（KnowledgeEventベース、起票/アーカイブ/タイトル変更等あらゆるIssueの変化を記録済み、`/reports`の「各種イベント」セクションで既に表示中）で満たされていると確認し、新規の集計ロジックは追加しなかった。
- `docs/issue_tracker_contract.md`§3に、`status=done`への書き込みUIがPhase 2.4で廃止され現在は実質到達不能である旨を追記した（ドキュメントの整合性維持）。
- **触れていない**: `Issue.status`型・`setIssueStatus`関数・PATCHルートのstatus処理自体（削除・無効化はしない）、`createdCount`/`archivedCount`とその表示、`timeline.ts`・`/timeline`のIssueエントリ処理。
- `npm run lint` / `tsc --noEmit` / `npm run build` / Vitest全体（1040件）を確認済み。dev server再起動後に`/reports`・`/timeline`・ダッシュボードの実描画（200応答）、および実際にレポートを新規生成してレスポンスに`doneCount`/`doneTitles`が含まれないことも確認済み。

**これでPhase 1〜5すべて完了。**

### Phase 6 — pivot_policy.mdとの残存不整合の解消（完了）

**2026-09-15、Phase 5完了後、ユーザーから「まだpivot_policy.mdと不整合がある」との指摘を受けて着手。** 課題タブの管理列・管理情報の残存、hint/helpの古い語彙、レポートのIssue情報残存を指摘され、「Issueに代わり『提案（Suggestion）』を軸としたEMへの提示と軽量なEM判断のみにする。そこからのアクションの管理はプロダクト対象外とし、EMのメモ程度にする」という方向性が示された。計画モードで3方向（課題タブUI／help・hint語彙／レポート）を並行調査した結果、指摘の3領域に加え、Phase 5で直した`doneCount`と同型の「書き込み経路が消えたのに指標だけ残っている」バグが**OKR進捗バー**（`/org`・ダッシュボード）にも見つかり、ユーザー確認の上まとめて対応した。

実施内容:
- **課題一覧のフィルタ**: `IssueFilterBar.tsx`からステータス/優先度の`Select`フィルタを撤去。対応する編集UIが既に無く「絞り込んで管理する軸」ではなくなっていたため。行内のステータス/優先度バッジ表示は読み取り専用の軽い文脈情報として維持。フォーカス順の並べ替え（↑/↓ボタン）はEMの軽量判断として維持。`status=done`除外は固定ロジックとして残す（レガシーdoneデータを一覧から隠す既定挙動）。
- **凍結スコア表示の撤去**: `IssueListTable.tsx`の`優先度/判断`列から、二度と更新されない`IssueTriageAxes`（採点軸の生数値）と「提案: ...」の警告行を削除。
- **期限（dueAt）機能の撤去**: UIからの設定経路が一度も実装されずに放置されていた未完成機能。`Issue.dueAt`フィールド（`issue-store.ts`/`types.ts`）、`setIssueDueAt`関数、PATCHルートのdueAt処理、`DueBadge`表示、関連テストを削除。
- **死んだコード削除**: 呼び出し元ゼロの`IssueStatusSelector`/`IssuePrioritySelector`（`IssueStatus.tsx`）とそのテストを削除。
- **help/hint語彙の修正**: `/help#issues`から削除済み機能（評価を一括更新、スコア差ビュー）の説明を削除し、Action Itemの説明を過去形に修正。`IssueTitleHeader.tsx`のアーカイブボタンtooltipから到達不能な「解決（ステータス完了）」との対比表現を削除。`docs/issue_tracker_contract.md`§7に、削除済みの採点・一括再評価機構を指す記述への訂正注記を追加。
- **OKR進捗バーの同型バグ修正**: `objective-progress.ts`の`KeyResultProgress`型から`done`（`status===done`集計、書き込み経路が無く常に0）を削除し`total`（紐付き・非アーカイブIssue件数）のみに縮小。消費側（`ObjectiveTree.tsx`、`KeyResultManager.tsx`、`StrategyThreadTree.tsx`、**ダッシュボードの`TodayActionsPanel.tsx`「今期のKR進捗」表示**——3つの研究エージェントの調査では見つからず、実装中のtsc型エラーから発覚）をすべて「Issue N件」という単純な件数表示に変更。`ObjectiveEditForm.tsx`のヒント文言も追従。
- **Timelineの管理ログ語彙**: 調査の結果、`issue-store.ts`の「ステータスを変更しました」「優先度を変更しました」を生成する書き込み関数（`setIssueStatus`/`setIssuePriority`）自体がどのUIからも呼ばれなくなっており（Phase 5の「将来別経路で使われる可能性」を理由とした残置判断を踏襲）、実際には発火しない死んだイベント種別だと確認した。発火しないコードの文言を書き換えても実害を減らさないため、**追加のコード変更はしないと判断**（ユーザーへの明示的な報告事項）。
- **Reportsの「Issue進捗」見出し**: 達成率を連想させる「Issue進捗」を「Issue（起票・アーカイブ）」に変更。データ構造（`createdCount`/`archivedCount`/タイトル一覧）は個別のIssueが分かる情報として有用なため維持し、`events.byEntityType`との構造統合はしていない。
- **触れていない**: `Issue.status`型・`setIssueStatus`/`setIssuePriority`関数・PATCHルートのstatus/priority処理自体（Phase 5の決定を踏襲）、`IssueStrategyMetaPanel`（つながりを見る機能が依存する構造的メタデータ）、`IssueCharterSection`・`IssueActionItemsPanel`・AI提案採用フロー、`UnlinkedRunsPanel`。
- `npm run lint` / `tsc --noEmit` / `npm run build` / Vitest全体（1035件）を確認済み。dev server再起動後に`/issues`・`/org`・`/org/thread`・`/reports`・`/help#issues`・ダッシュボードの実描画（200応答）、`/help`の静的HTMLから削除済み文言が消えていること、`/api/org/objectives`・`/api/issues`のレスポンスから`done`/`dueAt`が消えていることも確認済み。

**これでPhase 1〜6すべて完了。**

### Phase 7 — Issue廃止 → Suggestion中心化（完了）

**2026-09-15、ユーザー判断で方針2（pivot_policyの理想へさらに進める）を採用。** Issueを第一級エンティティから廃し、新規 `Suggestion`（未確認／確認保留／確認済み＝もう追わない＋確認優先度＋メモ＋壁打ち）を中心に据えた。

実施内容（要約）:
- `suggestion-store.ts` + `suggestions.json` を新設。初回起動時に `issues.json` から ID 維持で移行（charter→メモ、archived/done→確認済み）。
- `/api/suggestions`・詳細・memo API。`/suggestions` UI。TopNav「課題」→「提案」。`/issues*` は redirect。
- 相談「提案として残す」、Journal 追跡起票、UnlinkedRuns、hooks 遷移を Suggestion API へ。
- timeline / id-resolve / strategy trail / dashboard / reports / help の語彙・href を追従。
- agent-runtime: 文脈を title+メモに変更。charter/sub_issues 提案の生成を停止。
- 旧 Issue 詳細 UI（`IssueDetailContent` / `issue-detail/*` / `issues/*`）と死んだ API（archive / log / impact）を削除。壁打ち共通フックは `useAgentDecision` へ移設。
- `issue-store.ts` と薄い `/api/issues`（一覧・詳細 PATCH・link/suggest）は、ダッシュボード等の互換読取用として残置（実体は Suggestion 写像）。

### Phase 8 — Grow（EM自身の学びの提示）を追加する（実装済み）

**2026-09-15、ユーザーとの壁打ちで、pivot_policyの5番目のAI役割として`Grow`を新設する方針に合意した。** 現行のObserve/Interpret/Remember/Suggestはすべて対象が「組織」（チーム・メンバー・プロジェクト）であり、「EM自身の成長」を扱う面が無かった。既存の`/growth`ページ（`em-self-store.ts`のチェックイン・KPTメモ）はEMの自己申告のみで完結しており、AIのObserve/Interpret/Rememberの対象外だった。Growはこの2系統を繋ぎ、「自己申告に見える範囲」だけでなく「組織側の観測・解釈と突き合わせて初めて見える盲点・繰り返しパターン」をEMに示すことを狙う。pivot_policy.mdの役割定義・エレベーターピッチ・目指すUXは本フェーズの合意内容で既に更新済み（詳細は同ファイル参照）。

**合意した設計の骨格:**
- 役割の位置づけ: 既存Suggest（組織向け）とは別の第5の役割。EM側の対応アクションは既存の`Decide`に含める（新しいEM側動詞は追加しない）。
- 入力データ: 自己申告（チェックイン・KPTメモ）に加え、組織側の`KnowledgeEvent`（interpretation）・Journal・相談ログ・介入前後比較（`IssueLogSection`）も横断して使う。自己申告のみだと本人が既に関心を持つ点の増幅にとどまり「新たな学び」にならないため。
- 提示場所: `/growth`ページに新パネルとして追加。
- 頻度: 週次バッチ生成をデフォルトとし設定で変更可能、加えてEMが明示的にオンデマンド実行できるようにする。
- 提示の語法: 「これを学ぶべき」という評価・断定ではなく、「こういう学びが参考になりそうです」「〇〇を調べてみるのはどうでしょうか」という判断材料の形にする（既存Suggestの語法を踏襲）。
- 参考資料の言語ポリシー: 実務書・解説記事等の二次資料は日本語のものを優先する（読むコストを下げるため）。理論の一次資料（提唱者の原著・原典）については、英語であっても優先的に触れてよい。
- 具体性: 理論名・フレームワーク名・書籍名まで踏み込んで良いが、それがEmther内部データの裏付けがない一般知識である点は明示できる形にする（根拠となったパターン・メモと、一般知識由来の参考情報を区別して提示する）。

**2026-09-15、上記設計に基づき実装完了。実装内容:**
- 永続化: 専用ストア[`web/src/lib/em-growth-store.ts`](../web/src/lib/em-growth-store.ts) + `em-growth-suggestions.json`を新設（合意どおり`suggestion-store.ts`は流用せず）。型`GrowReference`/`GrowSuggestionDraft`/`GrowSuggestion`/`GrowSuggestionStatus`（`unread`/`acknowledged`/`dismissed`）はこのファイルが正であり、クライアント（`hooks.ts`等、node:crypto非依存が必要な箇所）向けに`types.ts`へ同型を複製している（`RulesAndConstraints`と同じ既存パターン）。生成時点で確定として保存し、他のsuggested*系と違い「採用」手続きは挟まない（朝サマリーのproposalと同じ扱い）。
- agent-runtime統合:
  - [`agent-runtime/types.ts`](../web/src/lib/agent-runtime/types.ts)の`AgentRun.origin`に`"auto-grow"`を追加（`originLabel`は「学びの提案」）。
  - [`agent-runtime/batch-context-blocks.ts`](../web/src/lib/agent-runtime/batch-context-blocks.ts)に`buildGrowContextBlock()`を追加。材料はEM自己申告（直近チェックイン8件・Problem/Tryメモ各10件）と組織側（`KnowledgeEvent`のinterpretation直近15件・相談run内のEM入力ログ直近10件）を横断し、非評価語法・参考資料の言語ポリシー（二次資料は日本語優先、一次資料は英語可、正確なタイトル不明時はトピック名に留める）をプロンプトに明記。
  - [`agent-runtime/context-blocks.ts`](../web/src/lib/agent-runtime/context-blocks.ts)の`buildSystemPrompt`に`runOrigin === "auto-grow"`分岐を追加。
  - [`agent-runtime/extraction.ts`](../web/src/lib/agent-runtime/extraction.ts)に`extractGrowSuggestions()`を追加（`grow_suggestions`フェンスドJSONブロックを抽出。`extractThemes`と同型の壊れにくいパース）。
  - [`agent-runtime/scheduled-tasks.ts`](../web/src/lib/agent-runtime/scheduled-tasks.ts)に`GROWTH_TASK`・`checkWeeklyGrow()`・`startGrowAnalysis(opts)`を追加（`checkWeeklyDistillation`/`startDistillationAnalysis`と同型。ISO週キー＋`auto-grow.json`ガードで週次二重起動を防止。watchdog tickに追加）。
  - [`agent-runtime/cli-runners/core.ts`](../web/src/lib/agent-runtime/cli-runners/core.ts)の`applyAssistantResultText`で、`origin==="auto-grow"`のとき`extractGrowSuggestions`の結果を`em-growth-store.createGrowSuggestions`へ直接保存。
- 設定（頻度）: [`settings-store.ts`](../web/src/lib/settings-store.ts)に`autoGrowEnabled`/`autoGrowWeekday`/`autoGrowHour`を追加（既定OFF・月曜・8時。`autoDistillation*`と同型）。`types.ts`の同名型・[`/api/settings/rules`](../web/src/app/api/settings/rules/route.ts)のPATCHバリデーション・[`AutomationSettingsGroup.tsx`](../web/src/components/settings/AutomationSettingsGroup.tsx)（「学びの提案（週次バッチ）」セクション）も追従。
- API: `/api/growth/suggestions`（GET一覧）・`/api/growth/suggestions/[id]`（PATCH、status変更）・`/api/growth/generate`（POST、`startGrowAnalysis({manual:true})`。`/api/themes/distill`と同型でpendingUnmasked時202）。
- UI: [`/growth`ページ](../web/src/app/growth/page.tsx)の先頭に[`GrowSuggestionsPanel`](../web/src/components/growth/GrowSuggestionsPanel.tsx)を追加。提案カード（title/rationale/evidenceSummary/references、`isPrimarySource`は「原典」バッジ）・「確認済みにする」「今回は見送る」ボタン・「今すぐ生成する」ボタン・`dismissed`の折りたたみ表示。
- 書籍名・フレームワーク名のハルシネーション対策は、プロンプト内で「正確なタイトルを保証できない場合はトピック名・著者名・理論名の範囲に留め、正確なタイトルの特定はEM自身の検索に委ねる」旨を明記する方針で運用開始（機械的な検証は行わない。実際の生成結果を見ながら文言を継続調整する想定）。

**2026-09-15、ユーザーから「参考文献やWeb記事、書籍のリンクを乗せてほしい」との追加要望を受けて対応。** `GrowReference`に任意項目`url`を追加し、LLMが実在を確信できる場合のみ付与するようプロンプトを更新。パース側（`extractGrowSuggestions`）は`http(s)://`形式のみ受理し、不正な値は破棄する。UI（`GrowSuggestionsPanel`）はurlが無い参照をトピック名からのGoogle検索リンクへフォールバックし、「🔍 検索」ラベルで区別する。

**2026-09-16、さらに「検索ばかりなので、もう少し直接知れるリンク先を探すようにしてほしい」との追加要望を受けて対応。** 当初はアプリのサーバー側コードから直接Wikipedia（認証不要の公開API）へ問い合わせる方式で実装したが、Wikipedia記事しか見つけられず網羅性が低いという課題があった。

**同日、ユーザーから「エージェントでネイティブツールを制約しているのはあくまで個人・機密情報の漏洩リスク低減のためであり、組織固有データを含まない汎用化済みのトピック文字列だけを渡すサブタスクであれば、WebSearchを許可してもリスクにはならないはず」との指摘を受け、Wikipedia方式からWebSearch方式へ設計変更した（実装済み）。**

- **実機検証で確認した事実**: Claude CLIの`--tools "WebSearch"`は、他のツール（Bash/Read/Write/Edit等）を一切選択肢に含めない構造的な制約であり、既存の`--tools ""`と同じ強さの保証を保ったままこの1機能だけを開放できる。ただし非対話（`-p`）モードは既定でツール承認を自動拒否するため、`--permission-mode bypassPermissions`を明示しないとWebSearch自体が実行されない（実機で`permission_denials: [{ tool_name: "WebSearch", ... }]`を確認済み）。
- **設計**: [`web/src/lib/reference-lookup.ts`](../web/src/lib/reference-lookup.ts)を全面刷新。`findReferenceUrls(topics)`が、AgentRunや組織のコンテキスト注入と一切繋がっていない孤立したclaude CLI呼び出し（`--tools "WebSearch"` + `--permission-mode bypassPermissions` + 設定の`perTurnBudgetUsd`を流用した予算上限）を1回行い、渡した複数トピック（Grow提案1件分の未確定参照をまとめて渡す。呼び出し回数・コストを抑えるため）についてWebSearchで見つかった実在URLだけを`url_lookup`フェンス付きJSONで受け取る。送信するのは`topic`文字列（学びのテーマ・理論名・著者名などの一般知識）と`isPrimarySource`/`note`のみで、組織のデータ・実名は一切送らない。プロンプトで「検索結果に無いURLを記憶や推測で作り出さない」旨を明記し、見つからなければurlをnullにしてよいとしている。ネットワークエラー・タイムアウト・予算超過・パース失敗はいずれも「見つからなかった」として扱い、例外を伝播させない。
- [`em-growth-store.ts`](../web/src/lib/em-growth-store.ts)の`enrichGrowSuggestionReferences(suggestions)`は変更なし（`findReferenceUrl`→`findReferenceUrls`への切り替えのみ）。生成済みsuggestionのうち`url`が未設定の参照だけをまとめて`findReferenceUrls`に渡し、見つかった分だけ`references`を更新・永続化する。
  - [`cli-runners/core.ts`](../web/src/lib/agent-runtime/cli-runners/core.ts)の`applyAssistantResultText`で、`createGrowSuggestions`直後に`enrichGrowSuggestionReferences`をfire-and-forget（`void ... .catch(() => {})`）で呼ぶ。ネットワーク遅延・失敗があってもrunの完了処理をブロックしない。EM画面には既存の15秒ポーリングで、後から直リンクが反映される（初回表示は検索リンク→しばらくして直リンクへ更新、という体感になる）。
  - プロンプト文言も「urlを省略した場合、アプリ側がトピック名でWeb検索して直リンクを後追い補完しようとします」と更新し、LLM自身に無理なURL生成を促さないようにした（LLMが確信を持てる場合の直接指定は従来どおり尊重する）。
  - テストはネットワークアクセス・実CLI起動を避けるため、`reference-lookup.test.ts`で`node:child_process`の`spawn`をモック（`agent-runtime.test.ts`と同じFakeChildProcessパターン）、`em-growth-store.test.ts`で`@/lib/reference-lookup`モジュール自体をモックしている。
  - **実機検証**: `claude -p "..." --tools "WebSearch" --permission-mode bypassPermissions --output-format json --max-budget-usd 0.30`を実際に起動し、WebSearchツールの実行が許可され応答が返ることを確認した（1回あたり実コスト約$0.04〜）。

**2026-09-16、さらに「英語率が高いのと、有料の論文サイトへの案内もあった。日本語優先をより強め、有料論文サイトは避けたい」との追加要望を受けて対応（実装済み）。**
- プロンプトを強化: 二次資料は「日本語のページに限定して検索する」、一次資料も「まず日本語の解説記事を探し、無ければ英語の原典」という順序を明示。有料の学術ジャーナル・論文データベース（ScienceDirect, SpringerLink, Wiley Online Library, IEEE Xplore, ACM Digital Library, JSTOR等）を避け、無料で読めるページを優先する旨を明記した。
- **defense-in-depth**: モデルが指示に反した場合の保険として、`reference-lookup.ts`によく知られた有料学術ジャーナル・論文データベースのホスト名の一覧（`PAYWALLED_ACADEMIC_HOST_SUFFIXES`）を持たせ、返ってきたURLがこれらに該当する場合は機械的に破棄する（見つからなかった扱いにし、EM側の画面では検索リンクへフォールバックする）。網羅的な検出ではなく「よくあるものを機械的に弾く」保険である点に注意。
- **実装中に発覚したバグの修正**: 実機検証で、`topic`フィールドに「入力と同じトピック文字列を返せ」と指示したにもかかわらず、モデルがプロンプト中の説明文（「トピック: 「〇〇」（二次資料…）」のような行全体）を丸ごと返してしまい、`enrichGrowSuggestionReferences`側のトピック文字列マッチングが失敗する不具合を発見した。文字列の完全一致に依存するのは脆いと判断し、プロンプトで明示した1始まりの`index`で機械的に突き合わせる方式に変更した（`extractLookupResults`が`{ index, url }`を返し、`findReferenceUrls`が`valid[index-1].topic`で元のトピック文字列に復元する）。
- **実機検証**: 修正後、実際に「心理的安全性」（日本語記事）・「シチュエーショナル・リーダーシップ理論」（日本語Wikipedia）の両方で、topicが正しく元の文字列のまま返り、有料ジャーナル・英語ページを避けた結果が得られることを確認した。

**2026-09-16、ユーザーから「設定でClaude Codeが許可されていないときでも、この機能はClaude Codeを使ってしまうのでは」との指摘を受け、修正した（実装済み）。** Settingsの「CLI優先順位」（`cliOrder`）は、ユーザーが`claude`を候補配列から除外することでClaude Code CLIの利用自体を禁止できる設定（ユーザー指摘「claude codeが外せないようになっている」対応で導入済み。詳細は本ファイル上部のcliOrder関連の記述を参照）だが、`reference-lookup.ts`はこの設定を見ずに常に`claude`を直接起動していた。EM側の直リンク補完機能だけがこの制約から漏れているのは一貫性を欠くため、`findReferenceUrls`の先頭で`getRulesAndConstraints().cliOrder.includes("claude")`を確認し、含まれていなければCLIを起動せず空配列を返す（＝この機能自体を丸ごとスキップし、EM画面は既存の検索リンクへフォールバックする）ように修正した。agy（Gemini CLI）・cursor-agentでの代替実装は、agyがヘッドレス実行時に全ツール呼び出しを構造的に自動拒否する仕様（README「Gemini CLI（agy経由）フォールバック」参照）でWebSearch自体が実行できず、cursor-agentも「WebSearchだけを確実に許可する」経路が未検証のため見送っている。テストは`settings-store`の`cliOrder`を操作して、claude除外時にスキップされること・他CLIと併記されていれば起動されることの両方を確認している。

**2026-09-16、ユーザーから「Claudeのみは制約が強すぎるので緩和したい。Cursor CLI + Ask mode + Hooks（WebSearch/WebFetch以外を弾く）で実現できないか」との提案を受け、調査・実機検証の上でcursor-agent対応を追加した（実装済み）。**

- **事前調査**（`cursor-guide`サブエージェント）: Cursor CLIのHooks機能はヘッドレス（`-p`/`--print`）でも公式に発火するが、`preToolUse`の公式マッチャー一覧（`Shell`/`Read`/`Write`/`Grep`/`Delete`/`Task`/`MCP:...`）に`WebSearch`/`WebFetch`は明記されておらず、Cursor側フォーラムでは「Autoモデルルーティング使用時、組み込みWebSearch/WebFetchに対して`preToolUse`が発火しない」既知バグが報告されていた（回避策はnamed modelの明示指定）。deny自体（exit code 2 / `permission: "deny"` / `failClosed`）はハードブロックとして文書化されているが、対象ツールへの発火保証が薄いという結論だった。
- **実機検証**（ユーザー承認済み、`/tmp`の使い捨てワークスペースで実施）: `.cursor/hooks.json`の`preToolUse`フックに、`tool_name`が`WebSearch`/`WebFetch`以外なら無条件で`deny`（`failClosed: true`）を返すスクリプトを設定し、以下を確認した。
  - `--mode ask`かつ`--force`無しでは、hookが`allow`を返してもWebSearch自体が「User Rejected」で実行されない（ask/print既定の承認層がhookのallowより先に働く）。
  - `--mode ask`を外し`--force`（Force allow commands **unless explicitly denied**）を付けると、hookが`allow`するWebSearch/WebFetchは実行され、hookが`deny`するRead/Write/Shellは`--force`があっても実行されない。Read・Write・Shellそれぞれについて個別のアドバーサリアルなプロンプト（`/etc/passwd`読み取り指示、テストマーカーファイルの`Read`指示、`whoami`の`Shell`実行指示）で、モデルの応答に「Read/Shell/WriteツールがpreToolUse hookによりブロックされました」という明示的な報告が出ることを確認した（テストマーカーファイルの内容は実際に一切漏れなかった）。
  - AutoモデルではpreToolUseが発火しない既知バグの回避策として、named model（既存の`cli-runners/cursor.ts`と同じ`gpt-5.2`）を明示指定する。
- **実装**: [`reference-lookup.ts`](../web/src/lib/reference-lookup.ts)に、上記の多層防御（専用の空ワークスペース`cursor-websearch-sandbox`＋deny-by-defaultの`preToolUse`フック＋`--force`＋named model。既存のフォールバック実行用ワークスペース`cursor-sandbox`とは別ディレクトリにし、既存機能を壊さないようにした）でcursor-agentを起動する`runCursorWebSearchLookup`を追加。`findReferenceUrls`は、`cliOrder`の並び順のうち最初に現れる対応CLI（`claude`または`cursor`）を使うよう変更した（例: `["cursor","claude"]`ならcursorを、`["agy"]`のようにどちらも含まれなければ機能自体を無効にする）。この設計はClaudeの`--tools`（ツールが構造的に存在しない）ほど強い保証ではなく、hooks機構自体の堅牢性に依存する点を明記した上で採用している。
- テスト: `reference-lookup.test.ts`に、cliOrderの優先順位でclaude/cursorどちらが選ばれるかの分岐と、cursor-agent起動時の引数（`--force`/`--trust`/`--model gpt-5.2`/専用ワークスペース）・`.cursor/hooks.json`とフックスクリプトの実際の書き出し内容を検証するテストを追加した。

**2026-09-16、続けてユーザーから「エージェント種別ごとのモデルに、この検索で使うモデル設定を追加してほしい（他のタスクに比べてもコストが低く軽量なモデルで良いはず）。CursorはAutoをHooksの不具合のため指定できないように（設定しようとしたら不具合で設定できない旨を表示）。agyは安全のため常に非アクティブ化」との要望を受けて対応（実装済み）。**

- 設定: [`types.ts`](../web/src/lib/types.ts)/[`settings-store.ts`](../web/src/lib/settings-store.ts)に`referenceLookupClaudeModel`（`ModelTier | ""`）・`referenceLookupCursorModel`（自由入力の文字列）を追加。既存の`agentModelTiers`/`agentCursorModels`（エージェント種別ごと）とは独立した、`reference-lookup.ts`専用の単一モデル設定（既定は両方とも未設定＝各CLIの既定モデルのまま）。
- UI: [`AiToolsSettingsGroup.tsx`](../web/src/components/settings/AiToolsSettingsGroup.tsx)の「エージェント種別ごとのモデル」マトリクスに、他のエージェント行と同じ見た目・列構成で「学びの参考リンク検索（Grow・専用）」という専用行を追加した（「軽量モデル推奨（コスト低減）」という補足を明記）。
  - claude列: 既存の`agentModelTiers`と同じtierエイリアスのセレクト。
  - cursor列: 自由入力のテキスト。入力値（大小文字・前後空白を無視）が`"auto"`ならその場でonChangeを止め、「Cursor CLIの既知の不具合（Autoモデルルーティング時にpreToolUseフックが発火しない）のため、Autoは指定できません」という趣旨のインラインエラーを即時表示する（保存を試みるまで待たない）。
  - agy列: 常に`disabled`の入力欄（placeholder「常に無効」）＋「agyは安全のため（ヘッドレス実行時に全ツール呼び出しを自動拒否する仕様のためWebSearchを実行できない）、この検索では常に非アクティブです」という説明文。設定できる余地自体を見せない。
- API: [`/api/settings/rules`](../web/src/app/api/settings/rules/route.ts)のPATCHに、`referenceLookupClaudeModel`（`MODEL_TIER_OPTIONS`に無い値は黙って落とす、既存の`agentModelTiers`と同じ検証）と`referenceLookupCursorModel`（値が`"auto"`相当なら400エラーで拒否。他のフィールドも含め一切保存しない）のバリデーションを追加。UI側の即時ブロックに加え、APIを直接叩く経路への保険（defense-in-depth）。
- [`settings/page.tsx`](../web/src/app/settings/page.tsx)の保存失敗時ハンドリングを、汎用文言だけでなくAPIが返す`error`文言（今回のケースを含む）をそのまま表示するように改善した。
- [`reference-lookup.ts`](../web/src/lib/reference-lookup.ts): claude起動時は`referenceLookupClaudeModel`が設定されていれば`--model`に渡す（未設定ならCLIの既定モデルのまま、既存の挙動を変えない）。cursor-agent起動時は`referenceLookupCursorModel`（未設定または万一`"auto"`相当が紛れ込んでいた場合は既定の`gpt-5.2`へフォールバック。API側の拒否をすり抜けた場合の保険）を`--model`に渡す。
- 実描画確認: `/settings`の「AIツール」タブで新しい行の表示、Cursor欄に`auto`と入力した際のインラインエラー表示、有効なモデル名（`gpt-5.2`）を入力して保存し`/api/settings/rules`に実際に反映されることを確認した。

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
- Phase 4完了時点で `/org/thread` のパンくずが壊れていないことを確認（新モデルへの移行はPhase 2.4で撤回済みのため、素のIssueフィールドに対する動作確認のみ）。

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
- [x] Phase 2.4（続きその2） — Charter編集UIを削除（2026-09-15、Phase 2.4完全完了）
  - 計画モードで再調査した結果、charterの読み取り消費箇所（7〜8箇所）はUIと無関係、かつ「AIが提案しEMが採用/却下する」経路（`SuggestedCharterBlock`）が既に実装済みと判明し、スコープを`IssueCharterSection.tsx`の編集モード削除のみに縮小できた。
  - `IssueCharterSection.tsx`を読み取り専用化（textarea編集・介入の型タグ選択・保存ロジックを全削除、Why/What/How閲覧表示・警告バナー・タグ表示・変更履歴は維持）。Propsを`{issue, history}`に縮小。
  - `page.module.css`のtextarea専用ルール（`.charterField textarea`等）を削除、`.charterEmptyView`からクリック用cursorを除去。
  - `issue-store.ts`の`updateIssueCharter`、`/api/issues/[id]`のPATCH、agent-runtimeのcharter読み取り・AI提案採用フロー一式は無変更で維持。
  - `npm run lint` / `tsc --noEmit` / `npm run build` / Vitest全体（1053件、変化なし）を確認済み。dev server再起動後にダッシュボード・`/issues`・Issue詳細ページの実描画も確認済み。
  - Phase 2.4の持ち越し項目（Action Item CRUD・Charter編集UI）は両方解消し、Phase 2.4完全完了。
- [x] Phase 3 — 入力導線の簡素化（2026-09-15）
  - 調査の結果、Journal作成・observation-dump受理・KnowledgeEvent分類・`ConsultReviewPanel`のIssue化はすべて既にAI起点と確認。唯一の人間決定UIは`JournalEntryCard.tsx`の「既存Issueに紐付ける」ID手入力＋ボタンで、これを削除（`useJournalEditing.ts`の`linkIssueIdDraft`/`linkToExistingIssue`も削除、`JournalDumpPanel.tsx`/`app/journal/page.tsx`が追従）。
  - 「Issueを起票してこの件を追跡する」「メモを残して解決にする」「解決を取り消す」は無変更（Issue選択とは無関係）。
  - 評価ログ/Journal作成/Themeは既にAI起点と確認（追加対応不要）。Team/OKRの手動構造化入力はユーザー判断によりPhase 3対象外（将来、必要になれば別セッションで計画）。
  - `npm run lint` / `tsc --noEmit` / `npm run build` / Vitest全体（1050件、テスト3件減）を確認済み。dev server再起動後の実描画も確認済み。
- [x] Phase 4 — レガシー面の縮小（2026-09-15、当初計画は大部分が無効化済みと判明・縮小版で実施）
  - 調査の結果、元の3方針のうち「issue-triage.ts廃止」「ナビからIssue管理位置付けを外す」は既に他フェーズで実質解決済み、「`/org/thread`の参照先を新モデルへ付け替え」はKnowledgeEvent移行自体の撤回で前提無効と判明。
  - 実施したのは、Phase 2.2の削除漏れだった死んだコード`issue-score-gaps.ts`＋テストの削除のみ。ナビ構造（「課題」タブ独立維持）はユーザー確認の上で現状維持と判断。
  - `npm run lint` / `tsc --noEmit` / `npm run build` / Vitest全体（1041件）を確認済み。
- [x] Phase 5 — Reports / Timeline の追従（2026-09-15、Phase 1〜5すべて完了）
  - `timeline.ts`の「新モデルへ付け替え」は前提無効で変更不要と確認。`report-store.ts`側は再調査の結果、実在する不具合を発見: `doneCount`（Issue解決数の指標）が、Phase 2.4でstatus編集UIが削除されたため書き込み経路が無くなり構造的に必ず0になっていたのに、`/reports`が「解決 N件」を表示し続けていた。
  - `report-store.ts`/`types.ts`/`daily-trends.ts`/`DailyTrendChart.tsx`/`reports/page.tsx`から`doneCount`/`doneTitles`/`issueDone`（死んだ指標）を削除。「観測された状態変化」の指標は既存の`ReportEventStats.byEntityType`（KnowledgeEventベース）で満たされていると確認し新規実装は不要だった。`docs/issue_tracker_contract.md`にも軽微な追記。
  - `npm run lint` / `tsc --noEmit` / `npm run build` / Vitest全体（1040件）を確認済み。`/reports`・`/timeline`の実描画、実際のレポート新規生成での確認も実施済み。
- [x] Phase 6 — pivot_policy.mdとの残存不整合の解消（2026-09-15）
  - 課題タブの管理列・help語彙・レポート見出し・OKR進捗バーの死んだ done 指標などを整理。
- [x] Phase 7 — Issue廃止 → Suggestion中心化（2026-09-15）
  - Suggestion 型・ストア・移行・API・提案 UI・入口・周辺読替・agent-runtime 文脈更新・help/ナビ更新。
  - 旧 Issue 詳細 UI と archive/log/impact API を削除。issue-store と薄い `/api/issues` は互換レイヤーとして残置。
- [x] Phase 8 — Grow（EM自身の学びの提示）を追加する（2026-09-15）
  - pivot_policy.mdに5番目のAI役割`Grow`を追記（役割定義・エレベーターピッチ・目指すUX）。
  - 骨格: 対象はEM自身の学び／組織側の観測・解釈＋自己申告（チェックイン・KPT）を横断／`/growth`へ新パネル／週次デフォルト＋設定可＋オンデマンド／判断材料としての語法（評価・断定はしない）／参考資料は日本語優先、一次資料は英語も可。
  - 実装: 専用ストア`em-growth-store.ts`＋`em-growth-suggestions.json`／agent-runtime統合（`buildGrowContextBlock`・`extractGrowSuggestions`・origin`auto-grow`・`checkWeeklyGrow`/`startGrowAnalysis`）／設定`autoGrowEnabled`等／`/api/growth`配下API／`/growth`の`GrowSuggestionsPanel`。
  - 追加（2026-09-15/16）: `GrowReference.url`（LLMが確信できる場合のみ）／urlが無い場合は検索リンクへフォールバック／`reference-lookup.ts`（隔離されたWebSearch専用CLI呼び出し、`--tools "WebSearch"` + `--permission-mode bypassPermissions`）による直リンクの後追い自動補完（`enrichGrowSuggestionReferences`、fire-and-forget）。日本語優先・有料学術ジャーナル回避（プロンプト強化＋ホスト名denylist）・index方式でのトピック突き合わせも追加。
  - 追加（2026-09-16）: `cliOrder`でclaudeが除外されている場合に機能自体を無効化する修正、およびユーザー提案「Cursor CLI + Ask mode + Hooks」の実機検証（deny-by-defaultフックがRead/Write/Shellを確実に拒否しWebSearch/WebFetchのみ許可することを確認）を経て、cursor-agent対応（専用サンドボックス＋hooks＋`--force`＋named model）を追加。`cliOrder`の優先順位でclaude/cursorのうち先に現れる方を使う。
  - 追加（2026-09-16）: この検索専用の軽量モデル設定（`referenceLookupClaudeModel`/`referenceLookupCursorModel`）を追加（設定画面「エージェント種別ごとのモデル」に専用行）。CursorのAutoは既知の不具合（preToolUseフック不発火）のためUI・API双方で拒否し、agyは常に非アクティブとして表示する（説明はレイアウト崩れを避けるためカスタムツールチップに）。
  - 追加（2026-09-16）: ユーザー要望「Wikipediaの場合、日本語のページがないかチェックしてほしい」対応。WebSearchが返したURLがWikipedia記事（`*.wikipedia.org/wiki/...`）で、かつ日本語版でない場合、MediaWiki公開API（`action=query&prop=langlinks&lllang=ja`、認証不要）で日本語版の有無を機械的に確認し、あれば日本語版のURLに差し替える（`preferJapaneseWikipedia`）。実機のAPI応答形式を`curl`で確認済み。取得失敗・タイムアウト（5秒）時は元のURLをそのまま使う。
