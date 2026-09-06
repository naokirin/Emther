# EM Support System — MVP

`docs/first_implession/em_v5.md` で定義したアーキテクチャのうち、以下の垂直スライスを実装したもの。

- **3.4 CLIサブプロセス実行エンジン** と **3.6 Yield（一時停止）設計**（Agent Runtime）
- **3.2 ハイブリッド・データ収集**（Quick Journal — 軽量モデルによる自動タグ付け）
- 人物名の匿名化（`docs/memo.md`） — クラウドLLMに送る前に実名をIDへ置換し、表示時のみ実名に戻す
- **3.1 Core Context** と **3.1.1 Team Vitals** — チーム・メンバー登録、MVV/OKR（Strategy）、Journal実データに基づく三値ステータス算出
- **Settings（新設）** — Team Vitalsの判定閾値（Rules_and_Constraints）はOrganization Contextから分離し、`/settings`という独立の設定画面として持つ
- Agent Fleetステータス表示 — エージェント種別ごとの直近の稼働状況を信号機で表示
- **3.7 双方向Issueトラッキング（最小版）** — Issue Workspace
- ローカルファイルへの簡易永続化 — `.data/*.json`。プロセス再起動でデータが消える問題を解消
- **3.5 構造化された提案** — yieldしない完了時も「結論/参照ファクト/判断ロジック/棄却した代替案」を必ず構造化させる
- **3.3 階層型マルチエージェント（最小版）** — Lead Agentが専門エージェントに実際に相談し、その回答を踏まえて結論を出す
- UI再構成 — `docs/first_implession/em_ui_wireframe_v5.html` に合わせて、Dashboard / Issue一覧 / Issue詳細 / Organization Contextを実URLの別画面に再編
- Issue詳細のワイヤーフレーム準拠デザイン — 大見出し＋Context＋Yieldのラジオ選択＋チャットバブル形式のCopilot Workspaceに再設計
- Issue管理を一般的なIssue管理サービス同様に分離 — Issue一覧(`/issues`)とIssue詳細(`/issues/[id]`)を別画面にし、起票は一覧画面のダイアログから行う方式に変更
- Issue charter（Why/What/How） — Issueの計画・実行前に明らかにすべき3要素をデータモデルに追加し、未整理な項目を隠さず表示する
- UIバグ修正 — `.field`内の`<input>`に幅指定が漏れており、Issue起票ダイアログのタイトル欄などが小さいデフォルト表示になっていた問題を修正
- **3.8 動的Issue実行管理（分解の最小版）** — Issueの親子関係（1階層のみ、孫は禁止）。サブIssueへの分解と、既存Issueの上位Issue作成の両方に対応
- 動的ロードの完成 — Organization Context（チーム名簿・MVV/OKR）、Issue charter、関連Journalエントリの3系統をAgent Runtimeの`--append-system-prompt`へ実際に注入し、それぞれ「そこにしかない事実」を実際に思い出せることを確認済み
- Settings画面の新設 — Team Vitalsの判定閾値（Rules_and_Constraints）を、組織のMVVのような「不動の前提」とは別の「アプリの設定値」として`/org`から`/settings`へ分離
- Issueのアーカイブ（`docs/memo.md`のTODO対応） — `/issues`は既定でアーカイブ済みを隠し、チェックボックスで表示切替。詳細画面からアーカイブ/解除できる
- チームの編集・アーカイブ（`docs/memo.md`のTODO対応） — `/org`からチーム名・メンバーを編集可能に。アーカイブ済みチームはTeam VitalsとAgent Runtimeへの注入対象から除外される
- チーム／メンバーに関連するIssue・Journalの表示（`docs/memo.md`のTODO対応） — `/org`のチーム詳細に、名前一致による関連Issue一覧と、Issue化されていないJournal（EMの所感メモ）を表示
- チームの組織階層（`docs/memo.md`のTODO対応） — チーム名を`"Engineering / Team A"`のように`/`区切りにすると、`/org`のツリーがネストしたフォルダとして表示される
- Issueのタグ付け（`docs/memo.md`のTODO対応） — Issueにカンマ区切りのタグを付与でき、一覧・詳細に表示。Agent Runtimeへも「絶対の前提」として注入される
- リストのフィルタ・ページネーション（`docs/memo.md`のTODO対応） — Issue一覧のタグ/charter未整理フィルタ、DashboardのInbox状態フィルタ、共通の`usePagination`によるページ送り
- ワイヤーフレームのスタイルテーマ適用（`docs/memo.md`のTODO対応） — Agent Fleetのカードを状態色で塗る「信号機」表示に変更（他の見た目は既に一致していたため未変更）
- Dashboard「次にすべきこと」パネル（`docs/memo.md`のTODO対応） — Yield待ち・エラー・Issue charter未整理・Team Vitals不調を1箇所に集約し、クリックで詳細へ遷移できるようにした
- Agent Runの無応答検知（`docs/memo.md`のTODO対応） — 「動いていると思ったら止まっていた」を防ぐため、応答なしの表示警告＋一定時間超過後の自己修復（子プロセスの強制終了）を追加
- 永続化データモデルの再設計 Phase 1（`docs/memo.md`のTODO対応） — Journal/Agent Runの実行ログをSQLite（`node:sqlite`）へ移行し、イベントソーシング＋バイテンポラル＋ファクト/解釈分離のKnowledgeEventモデルを導入。Agent Runtimeへの注入もTTLで重み付けするよう変更
- 永続化データモデルの再設計 Phase 2（`docs/memo.md`のTODO対応） — Issue/Teamの変更（charter更新・タグ・Action Item・アーカイブ・メンバー変更等）をKnowledgeEventとして記録し、Issue詳細・チーム詳細から変更履歴を確認できるようにした
- 永続化データモデルの再設計 Phase 3（`docs/memo.md`のTODO対応） — ローカル完結の埋め込みモデルでJournal/長期プロファイルをベクトル化し、名前の完全一致では拾えない意味的に関連する過去情報をAgent Runtimeへ補助的に注入。副次的にmaskNames/unmaskNamesの自己破壊バグを修正
- Gemini CLI（agy経由）フォールバック（`docs/memo.md`のTODO対応） — Settingsで有効化したエージェント種別のみ、claude CLIの実行失敗・予算/レート制限時に`agy`経由でGeminiモデルへフォールバック。実際の成功応答・会話継続まで実機で検証済み

## できること

### 画面構成

`docs/first_implession/em_ui_wireframe_v5.html` のワイヤーフレームに合わせて、単一の縦長ページだったものを実ルーティングの4画面に再編した（タブのクリックで表示を切り替えるだけの単一ページではなく、それぞれが固有のURLを持つ）。

- **`/`（Dashboard）** — Agent Fleetステータス（信号機）、Team Vitals、Quick Journal、タスク起票フォーム＋実行中Run一覧（Inbox）。Inboxのrunをクリックすると、未起票なら自動でIssue化してから`/issues/[id]`へ遷移する。
- **`/issues`（Issue一覧）** — Issue一覧、「Issue未起票のAgent Run」一覧。「＋ 新しいIssue」ボタンでダイアログ（モーダル）を開いて起票する（画面遷移しない）。行をクリックすると`/issues/[id]`へ遷移する。
- **`/issues/[id]`（Issue詳細）** — 選択したIssueのAction Items・Yield判断・壁打ちチャット。上部に「← Issue一覧に戻る」リンクを常設。
- **`/org`（Organization Context）** — 左のツリーは「Strategy」（MVV/OKR）と「Teams」（チーム追加フォーム＋チーム一覧）の2系統。Strategyを選ぶとMission/Vision/Values/OKRを編集できる。チームを選ぶとメンバー一覧・削除操作を表示する。ワイヤーフレームのようなファイル単位のツリー編集ではなく、この2系統に簡略化している。
- **`/settings`** — Team Vitalsの判定閾値（Rules_and_Constraints）を編集する画面。「組織のMVVや体制などの不動の前提」であるOrganization Contextとは性質が異なり「アプリの挙動を調整する設定値」であるため、あえて別画面に分離している。
- 画面間で共有するデータ取得（`useRuns`/`useIssues`/`useTeams`/`useVitals`/`useJournal`/`useIssue`）は`web/src/lib/hooks.ts`にポーリング付きフックとして共通化。共有する型定義は`web/src/lib/types.ts`にまとめている。
- 実機検証: 4画面すべてが実URLで200を返すこと、Issueを作成して`/issues/[id]`のSSR出力に反映されること、Dashboard→Issue一覧→Issue詳細のAPIチェーン（起動→Issue化→詳細取得）が一致することを確認済み。ただしこのセッションではブラウザ拡張（Claude in Chrome）が未接続のため、クリック操作そのものの対話的な目視確認はできていない（クライアント側フェッチのため、SSR直後のHTMLには読み込み中の状態しか出ない点も含め、APIレスポンスとコードレビューでの担保に留まる）。

### Agent Runtime

- 画面からタスク（自然文）とエージェント種別（Lead/People/Process/Tech）を指定してエージェントを起動する。
- 起動すると `claude` CLI を非対話（`-p --output-format stream-json`）でサブプロセス実行し、出力をリアルタイムにActivity Streamへ表示する。
- エージェントが「複数の妥当な選択肢がある」「判断に必須の前提情報が不足している」と判断した場合、応答の末尾に構造化された`yield`ブロックを出力する規約になっており、これを検出すると実行を **Yield（🟡）** 状態にして停止する。
- EMがOptionを選択する、または自由記述でチャットすると、`claude --resume <session-id>` で同一セッションを再開し、そのまま思考を継続する。
- 完了すると **Idle（⚪️・完了）**、エラー時は **Error（🔴）** になる。
- 毎ターン、Organization Context（チーム名簿）を`--append-system-prompt`に注入する（docs 3.1「動的ロード」の簡略版。本来は関連チームだけに絞るべきだが、MVPでは常に全チームを注入している）。実機検証: タスク文に一切人物名を書かずに「Team Xのメンバー全員に名前をリストアップして」と依頼したところ、登録済みの実名2名が正しく列挙されることを確認済み（＝ロスターが実際にクラウド側へ渡っている証拠）。
- そのrunがIssueに紐づいている場合、Issueのタイトルとcharter（Why/What/How）も同様に「絶対の前提」として毎ターン注入する（`buildIssueContextBlock`、charterが3項目とも空なら注入自体をスキップする）。実機検証: タスク文に一切登場しない合言葉をIssueのWhyにだけ書いて、その合言葉を尋ねたところ、エージェントが正しく認識していることを確認済み（さらに「プロンプトインジェクション検証では」と自律的に警戒する応答まで見せた）。
- タスク／EMの発言文に、Journalで過去に言及されたことのある人物名が含まれていれば、その人物に関する直近のJournalエントリ（最大5件、タグ・緊急度・感情つき）を参考情報として注入する（`buildJournalContextBlock`）。全Journalを渡すとノイズで推論がブレるため、「今回の話題に出てきた人」だけに絞るのがdocs 3.1「動的ロード」の要点。実機検証: 「Fさんが社内マラソン大会で優勝した」というJournalを登録した上で、そのマラソンの件に一切触れずに「Fさんについて最近良いニュースがあったか」とタスクを起票したところ、Journalの内容を正しく参照して1on1での話題を提案することを確認済み。
- **docs 3.5「構造化された提案」**: yieldせずに完結する場合、必ず「結論・参照ファクト・判断ロジック・棄却した代替案」を含む`proposal`ブロックを出力させる規約にしており、これを緑色のカードとして表示する（規約に従わなかった場合は無理に構造化せず、素のテキストログのみ表示する）。実機検証: 「ベロシティが3スプリント連続で10%ずつ低下している」という事実だけを与えたところ、結論（原因調査を優先）・根拠・判断ロジックに加え、棄却した代替案3件（スコープ削減／増員／様子見、それぞれの棄却理由付き）が正しく構造化されて返ることを確認済み。

### 階層型マルチエージェント（Lead Agentの相談機能）

docs 3.3「リードエージェント/専門エージェント」の最小実装。Lead Agentだけが、1ターンにつき1回、People/Process/Tech Agentのいずれか1つに実際に相談できる。

- Lead Agentがconsultブロック（`{"agent": "...", "question": "..."}`）を出すと、`web/src/lib/agent-runtime.ts`の`handleConsult`が実際に専門エージェントのrunを起動し、完了を待ってから、その回答をLead Agent自身の会話に`--resume`で差し戻して最終結論を出させる。
- 相談先の専門エージェントは独立した`AgentRun`として記録され（`consultedBy`にLead run idを保持）、ダッシュボードのRun一覧にも「🔀 Lead Agentからの相談」として表示される（隠蔽せず、docs 3.5のExplainability方針に合わせている）。
- 無限相談を防ぐため、相談は1ターンに1回まで（フォローアップ呼び出しはconsult機能自体を無効化する）。専門エージェント側がyieldしてしまった場合でも、そのyield理由をベストエフォートの回答として扱いLead Agentに返す（内部相談で人間の入力待ちにはならない）。
- 実機検証: 「技術的負債の返済計画を立てたい。Tech Agentに相談してから結論をまとめて」というLeadタスクに対し、実際にTech Agentへの相談run（独立した`AgentRun`、`consultedBy`がLeadのidを指す）が生成され、その回答（4軸スコアリングによる優先順位付け案）を踏まえた上で、Organization Context（登録済みチーム構成）まで加味した構造化proposalが返ることを確認済み。
- コストに関する注意: 相談が発生すると1タスクあたりのclaude呼び出しが最大3回（Lead初回 + 専門エージェント + Leadフォローアップ）になり、`PER_TURN_BUDGET_USD`（0.5ドル/回）の上限も比例して増える。

### Quick Journal

- 雑多な一言メモを入力してSubmitすると、**完全にローカルで動く**軽量モデル（Transformers.js + `onnx-community/Qwen2.5-0.5B-Instruct`, q4量子化）が構造化抽出（タグ／登場人物／緊急度／感情／要約）を行い、その場でカード表示する。
- 「軽量モデル」はコストや速度のためではなく、**ジャーナルに含まれうる機微情報（人名・心情など）を一切外部に送信しないため**の要件（docs 3.2「サニタイズ（秘匿化）」、業務要求3「情報の壁とセキュリティ」）。そのためAgent Runtime側（`claude -p`, クラウド）とは完全に切り離した推論経路にしてある。
- 初回リクエスト時にモデル重みをHugging Faceからダウンロードしてローカルにキャッシュする（`~/.cache/huggingface/` 等）。以降はネットワークアクセスなしで動く。
- モデルサイズはこのリポジトリの検証環境（メモリ7.7GB、常時スワップ逼迫気味）での安定性を優先して0.5Bを選んでいる。1.5B（`onnx-community/Qwen2.5-1.5B-Instruct`）の方が人物抽出やJSON整形の精度は高いが、この環境ではリクエスト後にNode.jsプロセスが（おそらくOOMで）落ちることを複数回確認したため見送った。メモリに余裕のある環境で動かす場合は `web/src/lib/journal-store.ts` の `MODEL_ID`/`MODEL_DTYPE` を差し替えるとよい。
- 0.5Bモデルなりの精度限界があり、要約文が不自然になったり、人物とチーム名を混同する（例:「Bチーム」をpeopleに含めてしまう）ことがある。tags/people/urgency/sentimentは概ね実用的だが、summaryの信頼度は低めに見ておくこと。

### 人物名の匿名化（People Directory）

`docs/memo.md` に書かれた設計をそのまま実装したもの。

- `web/src/lib/people-directory.ts` が「実名 ⇔ `PERSON_n` ID」の対応表をプロセス内メモリだけで保持する（外部LLMは一切参照できない場所）。
- Quick Journalがローカルモデルで人物を抽出するたびに、その名前をこの対応表へ自動登録する。
- Agent Runtimeが `claude -p`（クラウド）にタスクや返信メッセージを送る直前に、
  1. ローカルモデルでその場のテキストからも人物名を検出して対応表に追記し（Journalで一度も触れていない新規の名前を拾うため）、
  2. 対応表にある名前をすべて `PERSON_n` に置換してから送信する。
- クラウドからの応答（Activity Streamに表示するテキスト、yieldの `reason`/`options` を含む）は、表示直前にプログラムで `PERSON_n` → 実名へ戻す。EM向けの画面には常に実名が出るが、外部に出るテキストには実名が乗らない。
- 実機検証: Journalで「Aさん」を登録 → 別タスクで「Aさんのモチベーション低下について...」を起票 → ログに「送信前に人物名を匿名化しました」が出た上で、エージェントの回答は正しく「Aさん」の表記で表示されることを確認済み。
- 既知の限界: 名前の表記ゆれ（「Aさん」と「A」を別人扱いしてしまう等）やタイプミスには弱い。新規名の検出はローカルモデル任せなので、抽出漏れがあれば実名がそのまま送信される可能性が残る（100%の保証ではない）。逆に、ローカルモデルがチーム名（例:「Team X」）を人物名と誤検出して登録してしまうこともある。実害はなく（該当語がIDに置換され、応答時に元の表記へ戻るだけ）、置換対象が広がる程度の副作用にとどまる。

### Team Vitals / Organization Context（最小版）

ワイヤーフレーム（`docs/first_implession/em_ui_wireframe_v5.html`）で示した「良好／要注意／評価不能」の三値ステータスを、モックではなく実データから算出するようにしたもの。

- `web/src/lib/org-context-store.ts` — Core Contextの実装。チーム名とメンバー一覧に加え、`Strategy/`ディレクトリ相当の**MVV（Mission/Vision/Values）とOKR**（`OrgStrategy`、組織全体で1レコード、各項目は空文字列＝未設定を許容）を持つ。v5設計書が想定するツリー型ディレクトリ・JSON/YAMLファイル群までは実装せず、フラットな構造化データに簡略化している。メンバー名はJournalの`people`と同じ表記で登録する必要がある（表記ゆれ吸収なし）。
- `web/src/lib/settings-store.ts` — **Rules_and_Constraints**（`RulesAndConstraints`、Team Vitalsの判定閾値）を持つ。当初は`org-context-store.ts`に同居させていたが、「組織のMVV・体制のような不動の前提（ナレッジ）」ではなく「アプリの挙動を調整する設定値」という性質の違いから、独立した`settings-store.ts`／`/settings`画面へ分離した。
- `web/src/lib/vitals.ts` — チームごとに、直近N日以内でそのメンバーが`people`に含まれるJournalエントリを集計し、平均センチメントから「安定／やや注意／要注意」を判定する。**該当エントリが閾値件数未満の場合は必ず「評価不能」を返す**（三値であることが最初の要件だったため、ここが最重要ロジック）。1on1 Coverageは、直近N日以内で`#1on1`系タグの付いたエントリに登場したメンバー数 ÷ 登録メンバー総数で算出する。
- 判定式や閾値（参照期間・最低件数・センチメント境界・カバー率境界）は、以前はソースコード直書きの暫定値だったが、`getRulesAndConstraints()`経由で`settings-store.ts`の`RulesAndConstraints`から読むように変更した（v5設計書3.1.1「判定閾値はCore Context（Rules_and_Constraints）側で定義」の考え方を、独立したSettingsという形で採用）。デフォルト値は従来と同じ（14日、2件、±0.34/0.2、30日、80%/40%）。
- `/org`画面の「Strategy」ノードからMission/Vision/Values/OKRを編集でき（`PATCH /api/org/strategy`）、`/settings`画面から上記の閾値を編集できる（`PATCH /api/settings/rules`）。
- MVV/OKRはAgent Runtimeの`buildStrategyBlock()`から、Issueに依らず毎ターン「絶対の前提」として注入される（`agent-runtime.ts`）。
- 実機検証: チーム未登録→全体が評価不能。メンバー登録直後（Journal無し）→そのチームは評価不能。`/settings`から`minEntriesForJudgement`を1に変更すると、Journal1件のみのチームが「評価不能」から「安定」に切り替わり、2に戻すと再び「評価不能」に戻ることを確認（閾値がRules_and_Constraints経由で実際に効いている証拠）。また`/api/org/strategy`にMission/OKRを設定した状態で、それらに一切触れないタスク（「今期の組織のOKRとMissionを教えてください」）をAgent Runで実行したところ、設定した文言をそのまま回答・proposalに引用したことを確認（Strategy注入の実機検証）。

### Issue Workspace（最小版・ワイヤーフレーム準拠デザイン）

docs 3.7/3.8で想定するIssue Workspaceの最小実装。ただしYieldと壁打ちチャットの実体は独自実装せず、**既存のAgent Runにそのまま委譲**している——Issue自体が持つのはタイトル・Why/What/How・Action Itemsチェックリストだけ。

- `web/src/lib/issue-store.ts` — Issue（title, agentRunId?, charter, actionItems）のCRUD。`agentRunId`は任意で、「EMが直接起票（AI runと無関係）」と「既存のAgent Run（AIのYieldを含む）をIssue化」の両方に対応する（docs 3.7の「双方向性」）。
- Agent Runの各runに「📌 このRunをIssueにする」ボタンがあり、押すとそのrunに紐づいたIssueが作られる。Issue側は既存のrunと同じ`/api/agents/[id]/decide`を叩くので、Yield→再開のロジックは重複させていない。

**ワイヤーフレームとの差分と対応方針**（`docs/first_implession/em_ui_wireframe_v5.html`のIssue Workspaceと比較して洗い出したもの）:

| ワイヤーフレームの要素 | 旧実装 | 対応 |
| --- | --- | --- |
| Issue番号+タイトルの大見出し、ステータスバッジ | 小さな`<h2>` | `.issueTitleRow`に`<h1>`＋StatusBadgeで再現 |
| `Context:` 要約パラグラフ | 無し | run.taskをContextとして表示 |
| Yieldのオプションをラジオ的に選択→共通の「選択してStateを更新」「別の案をチャットで壁打ち」ボタン | Optionごとに個別の即時実行ボタン | ラジオ風カード選択＋共通の確定/壁打ちボタンに変更（`selectedOptionId`を親で保持） |
| Copilot Workspaceがチャット吹き出し形式 | ターミナル風の生ログ（Activity Stream的な見た目） | `run.log`をuser/ai/noteに分類して吹き出し表示するチャットビューに変更。yield/proposal/consultの機械可読ブロックは二重表示を避けるため吹き出しから除去（Execution State側にだけ構造化表示） |
| Execution State（Yield＋Action Items）とCopilot Workspaceの2カラム | 単一カラムに全部縦積み | `.issueColumns`で2カラム化（860px以下は1カラムにフォールバック） |
| Issueの一覧・Issue未起票Runの一覧 | — | **ワイヤーフレームには無いが、複数Issueを扱う実運用上必要**と判断。当初は詳細画面のサイドバーに同居させていたが、後の指示で一般的なIssue管理サービス同様に**`/issues`（一覧・起票ダイアログ）と`/issues/[id]`（詳細）を別画面に分離**した |

- `web/src/components/RunDetail.tsx` を `ExecutionState`（Context/Yield選択/Proposal）と`CopilotChat`（チャット吹き出し＋入力欄）の2コンポーネントに分割。Issue詳細画面の2カラムはこの2つを並べるだけで構成している。
- Issueの起票は`/issues`の「＋ 新しいIssue」ボタンから開くモーダルダイアログ（`web/src/components/Modal.tsx`）で行う。作成後は自動でその`/issues/[id]`へ遷移する。
- 実機検証: 単独Issueの作成・Action Item追加・完了チェックのトグル、実際のAgent Run（Tech Agentがyieldに到達したもの）へのIssue紐付け、Yieldオプションの選択→確定メッセージ送信→再開までを確認済み。チャット吹き出しからのyieldブロック除去は、実際に取得したエージェント出力に対して正規表現の単体動作を確認済み。ただしクリック操作の目視確認はブラウザ拡張未接続のため未実施。

### Issue Charter（Why/What/How）

Issueは重要な意思決定の単位であり、計画・実行の前に「Why（生む価値・誰のため・なぜ今か）」「What（何を・どこまで・どのくらい・完了の定義）」「How（どのように・なぜその方法か・前提と制約）」を明らかにしておくべき、という指摘に対応したもの。

- `Issue.charter = { why, what, how }` を`web/src/lib/issue-store.ts`に追加。各項目は空文字列（＝未整理）を許容する——**Team Vitalsの「評価不能」と同じ考え方**で、分からないことを分からないまま隠さず明示する。既存の永続化データ（charterフィールドが無い旧Issue）は読み込み時に自動的に空のcharterで補完する。
- `PATCH /api/issues/[id]` を新設し、Why/What/Howを個別または一括で更新できるようにした（title等は今のところ対象外）。
- Issue起票ダイアログ（`/issues`）にWhy/What/Howの入力欄（任意）を追加。「分かっている場合は事前に、分からなければ空欄のまま起票し、詳細画面で明らかにしてから計画・実行する」という運用を想定している。
- Issue一覧の各行に「✅/❓ Why/What/How: n/3」の整理状況バッジを表示。Issue詳細画面では、未整理の項目を点線枠で視覚的に強調し、3項目揃っていない場合は警告バナーを表示する（ただしYieldの選択やAgent Runの起動自体をブロックはしない——Agent Runを使ってWhy/What/How自体を明らかにするという使い方を妨げないため）。
- 実機検証: charter付きIssueの作成、既存Issueへの`PATCH`による部分更新（howだけの更新でwhy/whatが保持されること）、旧形式Issueの自動マイグレーションをAPI経由で確認済み。

### UIバグ修正: `.field`内の`<input>`サイズ

`page.module.css`の`.field select, .field textarea`ルールに`.field input`が含まれておらず、`<input type="text">`がブラウザの素の小さい表示になっていた（Issue起票ダイアログの「タイトル」、Organization Contextの「チーム名」「メンバー」など）。`.field input`を追加して他のフォーム部品と統一したスタイルになるよう修正した。

### Issueの親子関係（分解・1階層のみ）

「Issueを必要に応じて分解し、上位Issueも作れるようにしたいが、複雑な階層は避けたい」という要求に対応。**親子関係は1階層のみ**（子がさらに子＝孫を持つことは禁止）というルールを、UIで気をつけるのではなく`web/src/lib/issue-store.ts`側でハードな制約として実装している。

- `Issue.parentId?: string` を追加。`createIssue`に`parentId`を渡すと子Issueとして作成されるが、**指定した親自体が既に子（parentId持ち）の場合はエラーを返して拒否する**（孫Issueの防止）。
- 既存Issueの上位に新しいIssueを作る`createParentIssue`（`POST /api/issues/[id]/parent`）も追加。こちらは対象のIssueが**既に親を持つ場合**、または**既に自分の子を持つ場合**の両方でエラーを返す（前者は孫になってしまう、後者は既存の子が孫になってしまうため）。
- Issue一覧（`/issues`）はトップレベルのIssue（parentIdなし）だけを表示し、子は親の詳細ページの「サブIssue」欄に表示する形にして、一覧が親子入り混じって煩雑になるのを避けている。親には子Issueの件数バッジを表示。
- Issue詳細ページ（`/issues/[id]`）:
  - 子Issueなら上部に「⬆ 上位Issue: ○○」というリンクを表示。
  - 親になりうるIssue（子を持たない）は「＋ サブIssueを追加」ボタンで分解できる。既に子を持つIssueにはこのボタンだけ残り、子Issue自身（parentIdあり）にはサブIssueセクション自体を表示しない（＝孫は作れない）。
  - まだ親子どちらでもないIssueには「⬆ 上位Issueを作る」ボタンも表示し、後から大きな課題として括り直せるようにしている（子を持つと同時に消える）。
- 実機検証: 親→子の作成、子への孫作成の拒否、子を持つIssueへの上位Issue作成の拒否、単独Issueへの上位Issue作成成功（元Issueが正しく`parentId`を持つこと）をすべてAPI経由で確認済み。

### Issueのアーカイブ

`docs/memo.md`のTODO「Issueのアーカイブなどができないのでできるようにする」への対応。

- `Issue.archived: boolean` を追加（`web/src/lib/issue-store.ts`の`setIssueArchived`）。`POST /api/issues/[id]/archive`にbodyで`{ archived: true/false }`を渡すか、bodyなしで現在値をトグルする。
- 親子関係のカスケードは行わない意図的な簡略化——親をアーカイブしても子は独立してアーカイブ状態を持つ。
- Issue一覧（`/issues`）はトップレベルの未アーカイブIssueのみを既定表示し、「アーカイブ済みも表示する」チェックボックスで一時的に表示を切り替えられる（アーカイブ件数を横に表示）。表示中のアーカイブ済みIssueは行を薄く表示し、🗄バッジを付ける。
- Issue詳細ページには「アーカイブする/アーカイブを解除」ボタンを設置。子Issue一覧の各行にも同様の🗄バッジを表示する（こちらは常時表示、親Issueの詳細内という狭い文脈なので絞り込みはしない）。
- 実機検証: `POST /api/issues/[id]/archive`をbodyなし→`archived:true`、`{archived:false}`指定→`archived:false`と、両方のAPI呼び出しパターンで状態が正しく切り替わることを確認。

### チームの編集・アーカイブ

`docs/memo.md`のTODO「チームの編集・アーカイブができるようにする」への対応。以前はチーム名・メンバーを一度登録すると削除以外の変更手段が無かった。

- `Team`に`archived: boolean`と`updatedAt`を追加。`PATCH /api/teams/[id]`でチーム名・メンバーを編集でき、`POST /api/teams/[id]/archive`でアーカイブ/解除できる（Issueのアーカイブと同じくbodyなしでトグル、`{archived: bool}`で明示指定も可）。
- `listActiveTeams()`（`org-context-store.ts`）を新設し、**アーカイブ済みチームはTeam Vitalsの算出とAgent Runtimeへの「絶対の前提」注入の両方から除外**する。`listTeams()`は引き続き全件返す（`/org`側の表示切替のため）。
- `/org`画面: Teamsツリーに「アーカイブ済みも表示する」チェックボックスを追加（既定は非表示）。チームを選択すると、名前・メンバーを直接編集できるフォームと「アーカイブする/アーカイブを解除」ボタンが表示される（削除ボタンはそのまま残す）。
- 実機検証: チームを新規作成→`PATCH`で名前・メンバーを変更→`POST .../archive`でアーカイブしたところ、`/api/vitals`からそのチームが消え、かつそのチーム名に一切触れないAgent Runのタスク（「現在登録されているすべてのチーム名を一言で列挙してください」）に対して、アーカイブ済みチームを含まず未アーカイブのチームのみが列挙されることを確認（除外が実際に効いている証拠）。

### チーム／メンバーに関連するIssue・Journalの表示

`docs/memo.md`のTODO「チームや、メンバーごとの関連するIssueおよびIssueではない特性や問題などについて、Organization Context から確認できるようにする」への対応。

- IssueとTeam、JournalとTeamの間に明示的な紐付けは持たせず、**チームのメンバー名がテキストに含まれるか**という簡易な一致で関連付けている（`agent-runtime.ts`の各`buildXxxContextBlock`と同じ簡略化）。関連Issueはタイトル・Why/What/Howにメンバー名を含むもの、関連Journalは`people`配列にメンバー名を含むもの（直近10件）。
- `/org`でチームを選択すると、Members_Profileの下に「関連Issue」（クリックで`/issues/[id]`へ遷移、アーカイブ済み・charter充足バッジ付き）と「関連Journal（Issue化されていない特性・所感）」（本文・緊急度・感情・タグ）を表示する。「Issueではない特性や問題」＝まだIssue化されていない揺らぎのログとして、Journalをそのまま見せている。
- 実機検証: メンバー名を含むチーム・Issue・Journalエントリを作成し、`/api/issues`・`/api/journal`から取得したデータに対してこのフィルタ条件（タイトル文字列一致・`people`配列一致）が実際にマッチすることをAPIレスポンス上で確認。ブラウザでのクリック操作自体は今回も未検証（Claude in Chrome未接続のため）。

### チームの組織階層（`/`区切り）

`docs/memo.md`のTODO「チームの組織階層を入力できるようにする（チーム名で `/` をつけると組織階層をつけられるようにする。`/` の前後の空白は名前として無視するようにする）」への対応。独立した親子フィールドは持たせず、**チーム名自体を`/`区切りのパスとして解釈する**軽量な設計にしている。

- `web/src/lib/types.ts`に`teamPathSegments`（`"Engineering / Team A"` → `["Engineering", "Team A"]`、区切り前後の空白は無視）、`normalizeTeamName`（保存用の正規形、区切りは`/`）、`teamDisplayName`（表示用、`" / "`区切り）を追加。純粋関数なのでクライアント（`/org`）・サーバー（`org-context-store.ts`, `agent-runtime.ts`, `vitals.ts`）の両方から利用できる。
- `addTeam`/`updateTeam`は保存時に`normalizeTeamName`を通すため、`"Engineering / Team A"`と`"Engineering/Team A"`は同じチーム名として保存される。`/`だけ・空白だけなど正規化すると空になる名前は`POST /api/teams`・`PATCH /api/teams/[id]`の両方で400エラーとして拒否する。
- `/org`のTeamsツリーは、共通の先頭セグメントを持つチームを再帰的にネストしたフォルダとして表示する（`TeamTreeView`）。パスの末尾に一致するチームだけがクリック可能な葉ノードで、途中のセグメントは選択できないフォルダ見出しとして表示する。
- Agent Runtimeへの注入（`buildOrgContextBlock`）とTeam Vitals（`teamName`）は`teamDisplayName`で`" / "`区切りの読みやすい形に統一。
- 実機検証: `"Engineering / Team A"`と`"Engineering/Team B"`を作成したところ、両方とも正規化されて`/api/teams`上は`"Engineering/Team A"`のような`/`区切りの正規形で保存されることを確認。`/api/vitals`と、その2チーム名に一切触れないAgent Runのタスク（「登録チーム名を一言で列挙して」）の両方で`"Engineering / Team A"`のように読みやすい形で表示・回答されることを確認。`"   /   "`のような名前はAPIレベルで400エラーになることを確認。

### Issueのタグ付け

`docs/memo.md`のTODO「Issue にカテゴリ・タグ付けをしたい」への対応。

- `Issue.tags: string[]` を追加（`web/src/lib/issue-store.ts`の`setIssueTags`、Journalのtagsと同じくtrim・空文字除去・重複除去を行う`normalizeTags`を適用）。`POST /api/issues`の起票時、`PATCH /api/issues/[id]`の更新時の両方でタグを指定できる。
- Issue一覧の起票ダイアログとIssue詳細のWhy/What/How欄にタグ入力（カンマ区切り）を追加。一覧・詳細ともにタグは`#タグ名`のチップ（`tagTopic`スタイル、Journal本文中のトピックタグと同じ見た目）で表示する。
- `buildIssueContextBlock`（`agent-runtime.ts`）はWhy/What/Howが全て空でも**タグが1件以上あれば**Issueコンテキストを注入するよう条件を修正し、タグ一覧も「絶対の前提」として渡す。
- 実機検証: charterを空のままタグ`["秘密タグXYZ99"]`だけを設定したIssueに紐づくAgent Runへ、タグに一切触れない質問（「このタスクに紐づくIssueに設定されているタグを教えてください」）を送ったところ、正しく「秘密タグXYZ99」と回答し、proposalのfactsにもタグが引用されることを確認。

### リストのフィルタ・ページネーション

`docs/memo.md`のTODO「リストにおける、フィルタ機能の拡充、ページネーションの追加を行う」への対応。

- `web/src/components/Pagination.tsx` — `usePagination(items, pageSize)`（現在ページのスライス・総ページ数・件数レンジを計算するだけの汎用フック。フィルタ自体は各画面側でitems配列を絞り込んでから渡す）と、その結果を表示する`PaginationControls`（前へ/次へ＋件数表示）を追加。フィルタで件数が減ってページが範囲外になっても、内部stateを書き換えずに表示側で最終ページへ丸める。
- Issue一覧（`/issues`）: 「アーカイブ済みも表示する」に加えて、「タグで絞り込み」（登録済みタグのプルダウン）と「Why/What/How未整理のみ」チェックボックスを追加。Issue一覧・Issue未起票のAgent Run一覧の両方に8件/5件単位でページネーションを適用。
- Dashboard: Quick Journalのエントリ一覧（5件単位）とInboxのAgent Run一覧（状態（Active/Yield/Idle/Error）での絞り込み＋5件単位のページネーション）に適用。
- ページネーションのコントロールは、スクロール領域（`.runList`のmax-height）の**外側**に配置し、ページを切り替えても常に見える位置にしている。
- 実機検証: タグ`検証用ページネーション`を持つIssueを12件作成し、`/api/issues`で実際に12件（うち`tags`に指定タグを含む）が存在することを確認。フィルタ・ページ送り自体はクライアント側の純粋なJS計算（`usePagination`）であり、型チェック・lint・ビルドは通過。ブラウザでのページ送りクリック操作自体は今回も未検証（Claude in Chrome未接続のため）。

### ワイヤーフレームのスタイルテーマ適用: Agent Fleetの信号機表示

`docs/memo.md`のTODO「ワイヤーフレームのスタイルテーマを適用する」への対応。色トークン（`--green-bg`等）自体は以前のUI改修で`docs/first_implession/em_ui_wireframe_v5.html`と一致していたが、比較の結果**Agent Fleet（画面上部の4枚のカード）だけが未適用**だった——ワイヤーフレームはカード全体を状態色で塗る「信号機」表現（`.fleet-badge.active`等）だが、実装はカードを常に白背景のままにし、中に小さな色付きバッジを置くだけだった。

- `page.module.css`に`.fleetBadge.active/.yield/.idle/.error`を追加し、`.badge.active`等と同じ状態クラス名をカード自体にも適用できるようにした（`STATUS_META[status].cls`を流用、二重定義を避けている）。
- DashboardのAgent Fleet行を、アイコン+エージェント名（太字）／状態ラベル（小さめ、カード地色を継承）という、ワイヤーフレームと同じ2行構成に変更。
- 実機検証: `computeFleetStatus`が返す状態に応じて`fleetBadge`へ正しいクラス（例: 直近runが`yield`のPeople Agentには`fleetBadge yield`）が付与されるロジックをAPIレスポンス側のstatusと突き合わせて確認、コンパイル後のCSSに`.fleetBadge.active/.yield/.idle/.error`の各ルールが生成されていることを確認。ブラウザでの実際の色の見た目自体は今回も未検証（Claude in Chrome未接続のため）。
- 他の主要な見た目（タグ・チャット吹き出し・Yieldブロック・Option選択・ボタン形状など）は既存の実装がワイヤーフレームの配色・形状と既に一致していることを再確認済みで、変更していない。

### Dashboard「次にすべきこと」パネル

`docs/memo.md`のTODO「ダッシュボードで『人間のEMが次になにをするべきか？』がすぐに分かり、詳細に遷移できる状態にする」への対応。既存の4つのシグナル（Yield待ち・エラー・Issue charter未整理・Team Vitals不調）はそれぞれ別々の場所（Inbox、Issue一覧、Team Vitals）に散らばっており、EMが「今何をすべきか」を把握するには複数箇所を見て回る必要があった。

- Dashboard最上部（Agent Fleetより上）に新しいパネルを追加し、以下を集約して表示する。優先度は**urgent（赤）→warn（黄）**の順。
  - Agent Runが「応答なし」（後述の無応答検知、urgent。最優先）
  - `status === "yield"` のAgent Run（判断待ち、urgent）
  - `status === "error"` のAgent Run（urgent）
  - トップレベル・未アーカイブでWhy/What/Howが3/3未満のIssue（`issueNeedsCharter`、warn）
  - Team Vitalsが`bad`（urgent）または`warn`（warn）のチーム、および1on1 Coverageが`bad`/`warn`の場合
- 各項目はクリックすると該当の詳細画面へ直接遷移する（Agent Run→紐づくIssue詳細または新規Issue化、Issue charter→Issue詳細、Team Vitals→Organization Context）。「対応不要」の場合は✅の空メッセージを表示し、0件を「評価不能」側へ寄せない（他の三値表示と同じ考え方）。
- 最大6件まで表示し、超過分は「他X件」という件数だけ示す（一覧としての網羅性はIssue一覧・Organization Context側に譲り、このパネルは「今すぐ見るべき上位」に絞ったトリアージ用途に限定している）。
- 実機検証: 開発中に自然に発生していたYield 2件・Error 1件・Why/What/How未整理Issue 24件・1on1 Coverage `bad`のデータに対し、`/api/agents`・`/api/issues`・`/api/vitals`から集計した件数・優先度と、`nextActions`のロジック（urgent 4件・warn 24件、6件表示+他22件）が一致することを手計算で確認。コンパイル後のCSSに`.runItem.nextActionUrgent`/`.nextActionWarn`が生成されていることも確認。ブラウザでのクリック遷移自体は今回も未検証（Claude in Chrome未接続のため）。

### Agent Runの無応答検知（「動いていると思ったら止まっていた」対策）

`docs/memo.md`のTODO「動いていると思ったら止まっていた、を防ぐ」への対応。従来は`claude` CLIの子プロセスがハングして標準出力が止まっても、runは`status: "active"`（🟢）のまま何も変化せず、EMが気づく手段が無かった。この問題を「表示上の早期警告」と「実プロセスの自己修復」の2段構えで解決する。

- **設定**（`/settings`）に2つの閾値を追加。`agentStaleAfterSeconds`（既定120秒）: この秒数statusが`active`のままログ更新（`updatedAt`）が無ければ、まだ実プロセスは生かしたまま「応答なし」として警告表示する。`agentKillAfterSeconds`（既定600秒）: この秒数を超えたら、ハングした子プロセスとみなして実際に`kill()`し、既存の`child.on("close")`ハンドラに任せて`status: "error"`へ確定させる（二重に状態を書き換えない）。
- `web/src/lib/agent-runtime.ts`に子プロセスを`run.id`で引ける`liveProcesses`マップと、30秒間隔のwatchdog（`checkStaleRuns`）を追加。相談（consult）で生成される専門エージェントのrunも同じ`runClaudeTurn`を通るため、自動的に監視対象になる。
- 表示側は`isRunStale()`（`@/lib/types`、純粋関数）で「`active`のままN秒ログ更新が無い」かどうかを判定し、Team Vitalsの「評価不能」と同じ破線ストライプの見た目（❔ 応答なし）でオーバーライドする。**実データ（status）は書き換えず、あくまで表示のオーバーレイ**という点はTeam Vitalsと同じ設計思想。適用箇所: Dashboard（Agent Fleetカード、次にすべきことパネル、Inbox一覧）、Issue一覧、Issue詳細（タイトル横のバッジ、サブIssue一覧、Execution State）。
- 実機検証: `agentStaleAfterSeconds`/`agentKillAfterSeconds`を両方1秒に設定した状態でAgent Runを起動したところ、約4秒後にログへ`⚠️ 1秒間ログの更新が無いため、応答なしとみなして強制終了します。`→`プロセスが結果を返さずに終了しました (exit code: 143)`と記録され、`status`が`error`に確定することを確認（watchdogが実際に子プロセスをkillし、既存のclose処理へ正しく引き継がれている証拠）。閾値を既定値に戻した後、通常のタスクが誤って強制終了されず`idle`まで正常完了することも確認済み。

### 永続化

- 小さく低頻度更新なストア（teams, issues, org-strategy, settings-rules, people-directory）は引き続き`web/src/lib/persistence.ts`の`loadJSON`/`saveJSON`で`.data/*.json`へベタ書きする。複数ワーカーや同時書き込みは想定しない、シングルプロセス前提の最小実装。
- `.data/people-directory.json`には実名⇔`PERSON_n`の対応表が保存される。これはローカルディスク上のファイルであり、外部LLMには一切送信されないので、memo.mdが要求する「ローカルのみが読める場所」という条件は保ったままである。
- `.data/`は`.gitignore`済み（ジャーナルの生テキストや実名を含みうるため、コミット対象にしない）。

### 永続化データモデルの再設計 Phase 1（イベントソーシング＋バイテンポラル、SQLite移行）

`docs/memo.md`のTODO（優先度再検討の議論より、「H」として着手）。単調に増え続けるデータ（Journal、Agent Runの実行ログ）を、書き込みのたびにファイル全体を書き直すJSON配列でずっと持ち続けるのは半年〜1年単位の運用で破綻すると判断し、以下の設計に更新した。

- **ストレージ**: Node 22+に組み込まれている`node:sqlite`（`DatabaseSync`）を採用。追加npm依存はゼロ。単一ローカルユーザー・単一プロセス前提で、数百万レコード規模に達するには何年もかかる想定のため、分散DBや専用サーバープロセスは導入しない（`web/src/lib/db.ts`）。`.data/app.db`（WAL）に、`agent_runs`/`agent_run_logs`と`knowledge_events`の3テーブルを持つ。
- **ファクトと解釈の分離＋バイテンポラル**: `web/src/lib/knowledge-store.ts`に`KnowledgeEvent`を新設。`kind: "fact"`（起きた出来事そのもの、例:「Aさんが『辞めたい』と言った」）と`kind: "interpretation"`（そこから導いた長期的な解釈、例:「Aさんはリーダー志向がある」）を明確に分け、`occurredAt`（実世界でその内容が真だった時点）と`recordedAt`（システムが記録した時点）の2軸を持つ。`context`（official/observation/casual/complaint/profile）と`ttlDays`（現在の判断にどれだけの期間重みを持たせるか、未指定＝長期有効）も全イベントに付与する。**イベントは削除しない**——TTLは「重み」の話であり「履歴からの消去」の話ではない。
- **Journalの統合**: `journal-store.ts`は`journal.json`という別ファイルを持たず、Journal投稿はそのまま`kind: "fact", entityType: "journal"`のKnowledgeEventとしてSQLiteに記録される（二重管理をしない）。`JournalEntry`型・`listJournalEntries()`/`addJournalEntry()`のシグネチャは変更していないため、UI・Agent Runtime側は無改修。TTLは`Settings`の`journalFactTtlDays`（既定90日）から適用される。
- **長期プロファイルの記録口**: `POST /api/knowledge/interpretations`（`{person, text}`）で「Aさんはリーダー志向がある」のような長期的な解釈を記録できる。Dashboard Quick Journalパネル下部に専用の小さな入力欄を追加した（Journalとは別枠、TTLなし）。
- **Agent Runtimeへの反映**: `buildJournalContextBlock`を「長期的なプロファイル・解釈（TTLなし）」と「直近の一時的な状況（Journal、有効期限内のみ）」の2ブロックに分けて注入するよう変更（`listActiveFactsForPerson`/`listInterpretationsForPerson`）。TTLを過ぎたファクトは注入されない（履歴としてはSQLiteに残り続ける）。
- **Agent Runの永続化最適化**: 以前は標準出力1行ごと（`appendLog`呼び出しごと）に全run・全ログを含む`agent-runs.json`全体を書き直していた。SQLiteでは`agent_runs`（runメタデータ）と`agent_run_logs`（ログ行）を分離し、1回の更新につき対象run 1件・ログ1行だけを書き込む。呼び出し側（`runClaudeTurn`/`handleStreamEvent`/`handleConsult`等）はメモリ上の`AgentRun`オブジェクトをこれまで通り操作するだけで、変更は永続化層のみに閉じている。
- **ビルド時のロック競合対策**: `next build`のページデータ収集は動的ルートであってもモジュール評価のため`db.ts`をimportし、開発サーバーが同じ`.data/app.db`を開いたままの状態と鉢合わせして`database is locked`になることがあったため、`PRAGMA busy_timeout`を設定して一時的な競合はリトライで解決するようにした。
- **副次的に発見・修正したバグ**: `people-directory.ts`の`unmaskNames()`が、ID文字列の前方一致衝突（例: `"PERSON_1"`が`"PERSON_11"`の文字列としてのprefixになる）を考慮しておらず、登録人数が増えると表示名が破損するケースがあった（`maskNames()`側は名前の長さ降順で既に対策済みだったが、逆方向の`unmaskNames()`には同じ対策が無かった）。ID文字列の長さ降順で処理するよう修正。
- **既知の制約**: 移行前の`.data/journal.json`・`.data/agent-runs.json`（現在は未使用）は新スキーマへ自動移行していない。実運用データがまだ無い開発段階であるため許容している判断で、実データが乗った後に同様の変更をする場合は移行スクリプトが必要になる。
- 実機検証: Journal投稿→SQLiteへの書き込み・`listJournalEntries()`での読み出しを確認。Agent Runをcreate→yield→decide（`--resume`）→idleまでの一連のライフサイクルと、Lead Agentからの相談（consult）による専門エージェントrunの生成の両方がSQLite永続化で正しく機能することを確認。長期プロファイル（「Zさんはリーダー志向が強く...」）とJournalファクト（「Zさんが最近元気がなさそうだった...」）をそれぞれ登録した上で、どちらにも一切触れないタスクをAgent Runで実行したところ、Lead Agentが両方を区別して引用し、People Agentへの相談でも「恒久的な志向性」と「一時的な状態」を区別して扱う応答を確認（ファクトと解釈の分離が実際に効いている証拠）。`journalFactTtlDays`を一時的に`0`に設定してから新しいJournalファクトを投稿したところ、そのファクトだけがAgent Runtimeへの注入から除外され、既存の（TTL90日の）ファクトと長期プロファイルは注入され続けることを確認（TTLによる重み付けが実際に効いている証拠）。`next build`を開発サーバー起動中に実行してもロックエラーが起きないことを確認。

### 永続化データモデルの再設計 Phase 2（Issue/Teamの変更履歴のイベント化）

Phase 1で導入した`knowledge_events`テーブルを、Issue/Teamの構造変更の監査証跡としても使う。「現在状態」（`issues.json`/`teams.json`）はこれまで通りだが、その変更のたびに`entityType: "issue"|"team"`のKnowledgeEvent（`kind: "fact", context: "official"`、TTLなし＝恒久的な監査証跡）を追記する。

- `web/src/lib/knowledge-store.ts`に`entityId`列を追加（Issue/TeamのIDで1件を特定するため。人物についてのイベントは引き続き`people`配列で管理し、両者は直交する）。既存DBへは`ALTER TABLE`で追加する。`next build`のページデータ収集は複数ワーカー（別プロセス）が並行して同じ`.data/app.db`をマイグレーションしようとするため、`ALTER TABLE`が「duplicate column name」で失敗する競合が実際に発生した——事前のカラム存在チェックにはTOCTOUの隙が残るため、ALTER自体をtry/catchして「既に存在する」エラーを無視する形にして冪等性を確保した。
- `recordChangeEvent(entityType, entityId, text, tags?)`という薄いヘルパーを追加し、`issue-store.ts`（起票、Why/What/How更新、タグ更新、Action Itemの追加・完了切替、アーカイブ、親子再編）と`org-context-store.ts`（作成、名前・メンバー変更、アーカイブ、削除）の各更新関数から呼ぶ。値が実際に変わった場合のみ記録し（無変化の保存操作や既にアーカイブ済みへの再アーカイブ等はイベントを増やさない）、charter更新は変更されたフィールド名だけを、チーム更新は変更前後の値を含めて記録する。
- `GET /api/knowledge/events?entityType=issue|team&entityId=...`で履歴を取得できる。Issue詳細ページとOrganization Contextのチーム詳細に「変更履歴（N件）」という折りたたみセクションを追加した。
- チームを削除してもイベント自体は残る（実体が無くなった後も監査証跡として参照できる、イベントソーシングの前提通り）。
- 実機検証: Issueを起票→Why更新＋タグ更新→Action Item追加→アーカイブの一連の操作で、`GET /api/knowledge/events`から5件の履歴（起票・タグ更新・Why更新・Action Item追加・アーカイブ）が正しい順序で取得できることを確認。同じ値でのタグ更新・既にアーカイブ済みへの再アーカイブでは履歴が増えない（no-opガードが機能している）ことも確認。チームでも作成→メンバー変更→アーカイブ→削除の履歴が正しく記録され、削除後も履歴が参照可能なことを確認。`next build`を`.next`キャッシュ削除・DBファイル削除の両方の状態から複数回実行し、マイグレーションの競合が再発しないことを確認。

### 永続化データモデルの再設計 Phase 3（ローカル完結のベクトル検索）

名前の完全一致では拾えない「意味的に関連しそうな過去の情報」（例: 特定の名前を出さずに「最近誰か疲れていそうな人は？」と聞かれた場合）を拾えるようにする。埋め込み生成・検索とも外部送信は一切しない。

- `web/src/lib/embeddings.ts` — `@huggingface/transformers`で文埋め込み専用モデルをロードする`embedText()`と`cosineSimilarity()`。モデルは`Xenova/paraphrase-multilingual-MiniLM-L12-v2`（量子化q8で約118MB）を採用。英語専用の`Xenova/all-MiniLM-L6-v2`を最初に試したが、日本語の類似/非類似ペアをほぼ区別できなかった（関連ペア0.67 vs 非関連ペア0.72で逆転）ため、多言語対応モデルに切り替えた（関連0.66〜0.67 vs 非関連0.23〜0.26まで改善し、実用に足る区別ができることを確認）。チャット用ローカルモデル（0.5B）と両方ロードした状態でRSS約2GBに収まることも確認済み。
- `knowledge_events`に`embedding_json`列を追加（`db.ts`、既存の冪等なALTER方式を再利用）。Journal投稿（`journal-store.ts`）と長期プロファイル記録（`POST /api/knowledge/interpretations`）で、それぞれのテキストから埋め込みを生成して保存する。埋め込み生成に失敗しても本体の保存は諦めない（意味的検索はあくまで補助機能）。Issue/Teamの変更履歴（Phase 2）には埋め込みを付けない（監査ログであり意味検索の対象ではないため）。
- `searchSimilarEvents(queryEmbedding, opts)`（`knowledge-store.ts`）— 埋め込みを持つイベントに対してブルートフォースでコサイン類似度を計算し上位を返す。単一ローカルユーザー規模では十分高速なため、専用のベクトルインデックス（sqlite-vec等）は導入しない。TTL切れのfactは既定で除外する。
- `agent-runtime.ts`の`buildJournalContextBlock`が非同期になり、名前の完全一致による抽出に加えて、タスク本文を埋め込んで類似度0.4以上の過去のfact/interpretationを追加で注入するようになった。名前一致より確度が低いことを明示するため、「意味的に関連する可能性のある過去の情報（ベクトル検索による推測...参考程度に留めること）」という別ラベル・類似度スコア付きで提示し、名前一致で既出のものは重複させない。
- **副次的に発見・修正した重大なバグ**: `people-directory.ts`の`maskNames`/`unmaskNames`が、逐次`split/join`による置換だったため、後から置換した短い名前・ID（例: ローカルモデルの抽出ミスで登録されてしまった1文字の名前`"P"`）が、直前までに挿入済みの置換後文字列（例: `"PERSON_10"`）の内部に部分一致し、自己破壊的に文字列を破損させる不具合があった。Phase 1で見つけた`unmaskNames`の前方一致衝突（`PERSON_1`が`PERSON_11`のprefixになる）の修正だけでは不十分で、実際にPhase 3の実機検証中に別パターンの破損が再発したため、根本原因（逐次置換そのもの）を修正した。`String.replace()`とマッチする候補すべてを1本の正規表現（長い候補を先に評価）にまとめ、**元のテキストに対する1回のスキャンだけ**で全置換を終える方式に変更し、置換後文字列が再スキャンされることによる自己破壊を構造的に無くした。
- 実機検証: Journal本文の埋め込みが実際にDBへ保存されることを確認。「Wさんが最近残業が多く疲れているようだった」というJournalを、"Wさん"という名前に一切触れないタスク（「最近誰かが働きすぎで疲れていそうだという情報はありますか」）で問い合わせたところ、意味的検索によって正しくこのファクトを拾い上げ（類似度0.67）、かつ「確度は低め（参考程度）」「類似度0.67は名前の完全一致ではなく推測に基づくため断定はできない」と、名前一致の情報より慎重に扱う応答を確認（意味的検索が実際に機能し、かつ過信を防ぐ表現になっていることの証拠）。マスキングの自己破壊バグは、修正前後で同じ操作を再現し、修正後は文字列破損が発生しないことを確認。

### Gemini CLI（agy経由）フォールバック

`docs/memo.md`のTODO「Claude Codeが使えない場合にGemini CLIを使うようにする」への対応。トリガー条件はEMの指示により「claude CLIの実行失敗・予算/レート制限超過の両方」で、対象は「Settingsで明示的にONにしたエージェント種別のみ」（既定は全エージェントOFF）。

実装当初は生の`gemini` CLIを直接呼ぶ設計で、このサンドボックスには認証情報が無いため実際の成功応答は検証できず、セッション継続もインデックス指定のみで不可という制約があった。その後「gemini-cliではなくagyに変えてください」との指示を受け、複数モデル（Gemini/Claude/GPT-OSS）に対応した`agy` CLIを経由する方式に変更した——このサンドボックスには`agy`の認証情報があり、**実際の成功応答・複数ターンの会話継続まで含めて実機で検証できた**。

- `/settings`に「Gemini CLI（agy経由）フォールバック」セクションを追加し、`AGENT_OPTIONS`（Lead/People/Process/Tech Agent）ごとにON/OFFできるチェックボックスを設置（`agyFallbackAgents: string[]`）。
- `agent-runtime.ts`の`runClaudeTurn`を、claude呼び出し部分（`runClaudeCliAttempt`）とその結果テキスト処理（`applyAssistantResultText`、consult/yield/proposal抽出とrun状態確定の共通ロジック。元の"result"ケースから抽出しただけなので成功時の挙動は無変更）に分割。`runClaudeCliAttempt`が失敗（`run.status`が`"error"`で終了、起動失敗・プロセス無応答終了・`is_error`を含む）を返し、かつそのエージェント種別でフォールバックが有効な場合のみ、`runAgyCliAttempt`で同じターンを`agy`（Geminiモデルを指定）に再実行する。
- `agy`の`--output-format stream-json`は選択肢名こそclaudeと同じだが、実際のイベント構造は別物（`{"event": "result", "result": {"status": "SUCCESS"|"ERROR", "response": "...", "conversation_id": "...", ...}}`等）であることを実機で確認し、専用のパーサーを実装した。
- **会話継続が実際に機能する**: `agy`の`--conversation <uuid>`はclaudeの`--resume <uuid>`と同様に実際のUUID指定に対応している（生の`gemini` CLIはインデックス/「latest」指定のみで不可だった）。`run.agyConversationId`（claudeの`sessionId`とは別のID空間、`agent_runs`テーブルに新設した`agy_conversation_id`列で永続化）に`result.conversation_id`を保存し、次ターン以降のフォールバックで引き継ぐ。
- ツール無効化に相当する明示フラグは`agy`に見当たらなかったが、非対話（`-p`）実行中のツール承認はヘッドレスでは自動拒否されることを実機で確認済み（`permission check failed ... headless mode cannot prompt`）——claudeの`--tools ""`ほど構造的に厳格ではないが、実質的にツールが実行されることはない。`--append-system-prompt`相当のフラグも無いため、システムプロンプトをプロンプト本文の先頭に連結して渡す。
- モデルは`gemini-3.6-flash-medium`を固定で使用（`agy models`で確認できる一覧はバージョン付きの名前のみで、汎用エイリアスは無いことを実機で確認済み）。予算上限（`--max-budget-usd`相当）は`agy`側に見当たらないため設定していない。
- 実機検証: `PER_TURN_BUDGET_USD`を一時的に極小値に変更し、claude CLIを実際に予算超過（`subtype: "error_max_budget_usd"`）で失敗させた上で、(1) `agyFallbackAgents`が空（既定）の場合はフォールバックが一切試行されずそのまま`error`になること、(2) 対象エージェントを有効化すると実際に`agy`が起動され、Geminiモデルから本物の応答（proposal形式に正しく従った回答）が返り`run.status`が`idle`まで正常完了することを確認。さらに`decideRun`で追加のメッセージを送り、`agyConversationId`を使って会話が再開され、**直前のターンでのみ与えられた情報（「先ほど回答した数値」）を正しく参照した応答**が返ることを確認——会話継続が実際に機能している証拠。設定・予算を既定値に戻した後、通常のタスク（claudeのみ）が従来通り正常完了する（リファクタによる回帰が無い）ことも確認した。

## 実行方法

```bash
npm install
npm run dev
```

`http://localhost:3000` を開く。ローカルの `claude` CLI（サブスクリプション認証済みのもの）を利用するため、追加のAPIキー設定は不要。

## 課金に関する注記

`claude -p`（非対話モード）を使っている。「サブスクリプション範囲内か、別課金か」は一度認識が入れ替わった経緯があるため、コスト最適化を本格的に詰める前に現状の課金条件を再確認すること。`--bg`（バックグラウンドセッション）への切り替えも試したが、このセッションが動く検証環境固有と思われるグローバルフック起因で`state: "blocked"`のまま進まなくなる不具合が複数パターンで再現し、断念した経緯がある。

## 既知のスコープ外（今後の拡張ポイント）

- Journal・Agent Runの実行ログ・Issue/Teamの変更履歴はSQLite（イベントソーシング＋バイテンポラル）で管理しているが、Teams/Issues/Org Strategy/Settingsの「現在状態」自体はフラットJSONのまま（規模・更新頻度が小さいため意図的に据え置き）。複数プロセス/ワーカー間の整合性は引き続き想定していない（単一ローカルユーザー前提）。
- Journal・長期プロファイルについてはローカル完結のベクトル検索（Phase 3）を実装済み。ただしIssue/Teamの変更履歴（Phase 2のイベント）やAgent Runの実行ログには埋め込みを付けていないため、それらに対する意味的検索はまだできない。類似度の足切り閾値（現在コード直書き0.4）もEMが調整できるようにはなっていない。
- 現在はポーリング（1.5秒間隔）でActivity Streamを更新している。SSE/WebSocketへの置き換えは今後の課題。
- エージェントはツール利用を無効化（`--tools ""`）した「テキスト推論のみ」の存在として動作する。Organization Context（チーム名簿）・Issue charter（Why/What/How）・関連するJournalエントリは注入しているが、いずれも「今回登場した名前」ベースの単純な文字列一致で選んでいるだけで、意味的な関連度判定はしていない。
- Quick Journalのサニタイズ（マスキング、docs 3.2）は未実装。生のメモがそのまま画面にも表示される（推論自体はローカル完結になったが、表示上のマスキングは別課題として残っている）。
- ローカルモデルの初回ロードは重み（0.5B・q4で数百MB）のダウンロード＋ONNX Runtime初期化を含み、リクエストが数十秒ブロックする。2回目以降はプロセス内キャッシュにより数秒程度。
- Organization Contextはチーム名簿＋MVV/OKR（自由記述テキスト）を持つが、v5設計書が想定するツリー型ディレクトリ・チームごとのMVV・JSON/YAMLファイル群は未実装（フラットな構造化データに簡略化）。Team Vitalsの閾値（Rules_and_Constraints）は「アプリの設定値」として`/settings`画面に分離して持つ。
- Team Vitalsの判定閾値はOrganization Context（`/org`のStrategyノード）からEMが調整できるようになった。ただし「今期目標 15/33」のようなOKR進捗バイタルは未実装（進捗率だけでは良悪判定できない＝評価不能にすべきケースだと考えており、期限に対する期待値をどう持つかを未決定のまま保留している）。OKR自体は自由記述テキストとしてAgent Runtimeへ注入されるのみで、進捗の構造化・バイタル化はしていない。
- Issueの親子分解（1階層）はEMが手動で行うだけで、AIが「このIssueは大きすぎるので分解しては」と提案することはない。AIによる自動ドラフトIssue（異常検知経由の起票）も未実装。今のIssueはEMが手動で作る（既存Agent Runへの紐付けを含む）だけ。
- 階層型マルチエージェントは「Lead Agentが1ターンにつき1つの専門エージェントに1回だけ相談できる」という最小限のもの。専門エージェント同士の相談、複数エージェントへの並行相談、相談の連鎖（相談された専門エージェントがさらに別の専門エージェントに相談する等）はできない。
- Gemini CLI（agy経由）フォールバックは成功パス・会話継続とも実機検証済みだが、予算上限（`--max-budget-usd`相当）はagy側に設定していない。使用モデル（`gemini-3.6-flash-medium`固定）もEMが`/settings`から選べるようにはなっていない。
