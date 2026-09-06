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

### 永続化

- `web/src/lib/persistence.ts` の`loadJSON`/`saveJSON`で、各ストア（journal, teams, issues, agent-runs, people-directory）が`.data/*.json`へ読み書きする。複数ワーカーや同時書き込みは想定しない、シングルプロセス前提の最小実装。
- 起動時に`.data/agent-runs.json`から復元する際、`status: "active"`のままのrunは実体の子プロセスがもう存在しないため、自動的に`error`へ変換する（安全側に倒す設計）。それ以外（yield/idle/error）はログ・yield内容・`sessionId`ごとそのまま復元されるため、再起動後も`--resume`は機能する。
- `.data/people-directory.json`には実名⇔`PERSON_n`の対応表が保存される。これはローカルディスク上のファイルであり、外部LLMには一切送信されないので、memo.mdが要求する「ローカルのみが読める場所」という条件は保ったままである。
- 実機検証: チーム・Issue作成→サーバー再起動→両方とも復元されることを確認。Agent Runを起動して`active`のままサーバーを強制終了→再起動後に`error`＋説明ログへ変換されることを確認。
- `.data/`は`.gitignore`済み（ジャーナルの生テキストや実名を含みうるため、コミット対象にしない）。

## 実行方法

```bash
npm install
npm run dev
```

`http://localhost:3000` を開く。ローカルの `claude` CLI（サブスクリプション認証済みのもの）を利用するため、追加のAPIキー設定は不要。

## 課金に関する注記

`claude -p`（非対話モード）を使っている。「サブスクリプション範囲内か、別課金か」は一度認識が入れ替わった経緯があるため、コスト最適化を本格的に詰める前に現状の課金条件を再確認すること。`--bg`（バックグラウンドセッション）への切り替えも試したが、このセッションが動く検証環境固有と思われるグローバルフック起因で`state: "blocked"`のまま進まなくなる不具合が複数パターンで再現し、断念した経緯がある。

## 既知のスコープ外（今後の拡張ポイント）

- 永続化は`.data/*.json`へのベタ書きのみ。Core Context DB/Daily Logs DBが想定するようなイベントソーシングや構造化スキーマ、複数プロセス/ワーカー間の整合性は無い。
- 現在はポーリング（1.5秒間隔）でActivity Streamを更新している。SSE/WebSocketへの置き換えは今後の課題。
- エージェントはツール利用を無効化（`--tools ""`）した「テキスト推論のみ」の存在として動作する。Organization Context（チーム名簿）・Issue charter（Why/What/How）・関連するJournalエントリは注入しているが、いずれも「今回登場した名前」ベースの単純な文字列一致で選んでいるだけで、意味的な関連度判定はしていない。
- Quick Journalのサニタイズ（マスキング、docs 3.2）は未実装。生のメモがそのまま画面にも表示される（推論自体はローカル完結になったが、表示上のマスキングは別課題として残っている）。
- ローカルモデルの初回ロードは重み（0.5B・q4で数百MB）のダウンロード＋ONNX Runtime初期化を含み、リクエストが数十秒ブロックする。2回目以降はプロセス内キャッシュにより数秒程度。
- Organization Contextはチーム名簿＋MVV/OKR（自由記述テキスト）を持つが、v5設計書が想定するツリー型ディレクトリ・チームごとのMVV・JSON/YAMLファイル群は未実装（フラットな構造化データに簡略化）。Team Vitalsの閾値（Rules_and_Constraints）は「アプリの設定値」として`/settings`画面に分離して持つ。
- Team Vitalsの判定閾値はOrganization Context（`/org`のStrategyノード）からEMが調整できるようになった。ただし「今期目標 15/33」のようなOKR進捗バイタルは未実装（進捗率だけでは良悪判定できない＝評価不能にすべきケースだと考えており、期限に対する期待値をどう持つかを未決定のまま保留している）。OKR自体は自由記述テキストとしてAgent Runtimeへ注入されるのみで、進捗の構造化・バイタル化はしていない。
- Issueの親子分解（1階層）はEMが手動で行うだけで、AIが「このIssueは大きすぎるので分解しては」と提案することはない。AIによる自動ドラフトIssue（異常検知経由の起票）も未実装。今のIssueはEMが手動で作る（既存Agent Runへの紐付けを含む）だけ。
- 階層型マルチエージェントは「Lead Agentが1ターンにつき1つの専門エージェントに1回だけ相談できる」という最小限のもの。専門エージェント同士の相談、複数エージェントへの並行相談、相談の連鎖（相談された専門エージェントがさらに別の専門エージェントに相談する等）はできない。
