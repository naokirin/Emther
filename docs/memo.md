# MEMO

## 大規模改善
### 改善方針

前回の15点を、**今すぐ効く**／**中期で効く**に振り分けます。基準は「上位レイヤーの課題を人間＋AIチームで解く」体験が、どれだけ早く一本の線になるかです。

---

### 今すぐ効く（ストーリーの途切れを塞ぐ）

優先度は上から。小さく入れて、日常フローの「朝→メモ→壁打ち→判断」を組織課題向けに寄せるもの。

| # | ギャップ | なぜ今すぐ効くか | 最小のプロダクト形 |
|---|---|---|---|
| **A** | Inbox を「組織リスクのトリアージ」にする | 朝の最初の行動が「Run応答」から「何が起きているか」に変わる | カード種別を明示（異常検知ドラフト／Yield判断／ピボット提案／情報不足）。結論・根拠・次アクションを1カードで見せる |
| **B** | 「何でも相談」↔ Issue の昇格物語をはっきりさせる | モヤモヤが散逸せず、組織課題バックログになる | 相談スレッドに「Issue化する／様子見／却下」と、Issue側からの「壁打ちに戻す」を定型化。ダッシュボード案内文でも使い分けを一言示す |
| **C** | センシング→行動の導線を一本化 | Journal が「書いただけ」で終わらない | 抽出結果のその場微修正＋、タグ／人物クリックで関連 Issue・相談へ。urgency 以外の「要注目」も Inbox に載せる |
| **D** | 「評価不能」→観測アクション | Vitals が診断で止まらず、EMの次の一手になる | 評価不能カードに「誰の1on1を取る／どのチームのログを増やす」を次アクションとして出す |
| **E** | 横断 Activity Stream（簡易版で可） | 「AIチームが今何をしているか」が見え、ブラックボックス感が消える | Dashboard 右に直近 N 行の横断ログ。詳細は既存 Run 画面へ |
| **F** | Product Agent の追加（役割定義だけでも） | 4象限の欠けを埋め、課題の切り口が実装偏りから戻る | エージェント選択肢＋「プロダクト／顧客価値／優先順位の組織障害」向けプロンプト。高度なオーケストレーションは後回しでよい |
| **G** | Issue に「介入の型」を足す | 実装タスク箱から「仕組み・人・組織の介入」へ寄せる | カテゴリ／テンプレ程度で可（役割明確化、意思決定、依存関係、1on1設計、プロセス変更など）。Why/What/How の初期文面を型で埋める |

この7つまで入ると、**「見つけて → 相談して → 課題化し → 判断する」** が組織課題向けに繋がります。閉ループや深い Org 憲法はまだ無くても、日常の物語は成立します。

---

### 中期で効く（プロダクトの核を厚くする）

基盤や設計判断が要るが、無いと「相談ツール」から「組織課題の実行基盤」に上がりきれないもの。

| # | ギャップ | なぜ中期か | 目指すストーリー |
|---|---|---|---|
| **H** | 戦略 → Issue → 結果の一本線 | OKR を構造化し、Issue 紐付けと進捗バイタルが必要 | 「今期ミッションのために何を解いているか」が一目で分かる |
| **I** | チーム単位の憲法（ミッション／制約） | Org Context の情報モデル拡張が要る | Issue ごとに関連チーム前提だけを載せて考える、という境界が成立する |
| **J** | People を第一級ハブに | 画面・導線・データ集約の設計が要る | 人を軸に傾向・Issue・介入を辿れる |
| **K** | ズームイン／ズームアウトの協働計画 | AI 分解提案＋ロードマップ State の UX | 抽象課題 ↔ 具体介入を行き来して計画が育つ |
| **L** | 介入の閉ループ（やった→組織が変わったか） | Vitals／Journal／人物変化を Issue に結ぶ | ピボット判断が「感覚」ではなく観測に基づく |
| **M** | AIエージェント“チーム”の本格協働 | 並行・連鎖・合議のオーケストレーション | Fleet が「状態灯」ではなく「分業するチーム」になる |
| **N** | 時系列変化を EM が読む物語に | 差分／タイムライン UX | 「昨日と今日で組織理解がどう変わったか」が読める |
| **O** | 期初の憲法づくりオンボーディング | セットアップウィザード的な導線 | 空の前提のままエージェントが走らない |

---

### 進め方の提案（ストーリー優先）

1. **今スプリント相当:** A → B → C → D（トリアージと昇格と観測。既存画面の延長で効く）  
2. **その直後:** E → F → G（透明性・4象限・介入の言語）  
3. **次のマイルストーン:** H → I → J（戦略・チーム・人を第一級に）  
4. **その先:** K → L → M（計画の深さ・閉ループ・チーム協働）  
5. **横断で随時:** N・O（履歴の可読性と冷スタート。H/I と一緒にやると無駄が少ない）

---

### 一言で言うと

- **今すぐ:** 「何が起きているか見つけ、相談し、課題にし、次の観測を決める」線を通す  
- **中期:** 「戦略と人を前提に、介入を計画し、組織の変化で振り返る」線を通す  

前者だけで日常は回ります。後者が無いと、ビジョンの「組織設計・ミッション実現へ関心上げる」までは届きにくい、という切り分けです。

「今すぐ」A〜Gを、**既存のどの画面・どのブロックに何を足すか**まで落とします。新規画面は原則増やさず、いまの5画面の延長です。

---

### 全体の載せ先マップ

```
Dashboard `/`
├─ 時間帯バナー          → B（使い分け一言）
├─ 次にすべきこと        → A・D の主戦場
├─ Agent Fleet           → E（簡易ストリームの入口）／F（Product追加）
├─ Team Vitals           → D（評価不能の次アクション）
├─ Quick Journal         → C
└─ Inbox                 → A（カード化）／E（直近ログ要約）／F

何でも相談 `/chat`       → B（昇格・様子見・却下）
Issue 一覧／詳細         → B（逆方向）／G（介入の型）
```

---

### A. Inbox を組織リスクのトリアージにする

**置き場所:** `web/src/app/page.tsx` の「次にすべきこと」＋右カラム「Inbox」

いま「次にすべきこと」はテキスト1行、「Inbox」は Run 一覧です。ここを **カード種別付きトリアージ** に寄せます。

| 種別 | 既存シグナル | カードに出す | クリック先 |
|---|---|---|---|
| 異常検知ドラフト | `origin === "auto-anomaly" && !reviewed` | 結論（`proposal.conclusion`）・参照ファクト先頭2件 | `/chat?runId=`（既定どおり） |
| 朝サマリー | `auto-summary` | 同上（短く） | `/chat?runId=` |
| Yield（判断待ち） | `status === "yield"` | `yieldRequest.reason` ＋選択肢ラベル | Issue紐付きなら `/issues/[id]`、未紐付きなら `/chat` |
| リスク（Vitals） | `warn`/`bad` | チーム名＋label | `/org`（後述 D で観測アクションへ） |
| 実行異常 | stale / error | エージェント名＋タスク要約 | 既存どおり |

**実装の寄せ方（ストーリー優先）**
- 新規エンティティは不要。`NextAction` に `kind` と任意で `summary`（proposal から）を足す程度。
- Inbox の Run 行も同種ラベル（`異常検知` / `Yield` / `手動`）を左に出し、「次にすべきこと」と語彙を揃える。
- 「エージェントを起動」フォームは Inbox 下部に残す（トリアージと起票を混ぜない）。

**やらないこと:** ピボット提案を別データモデルにするのは中期。今は Yield / proposal を「判断待ち」「提案」として見せるだけでよい。

---

### B. 「何でも相談」↔ Issue の昇格物語

**置き場所:** `/chat` が主、Dashboard バナーと Issue 詳細が補助。

#### `/chat`（いま足りない穴）
現状、**Issue化／却下は自動起動 Run だけ**。手動相談は「Issue一覧から紐づけて」と書いてあるだけでボタンがありません。

足すもの（選択中スレッドの上部、自動起動ブロックと同じ位置）:

| アクション | 意味 | 既存API |
|---|---|---|
| 📌 Issueにする | 追跡する組織課題にする | 既存 `POST /api/issues`（`handlePromoteToIssue` を手動にも開放） |
| 👀 様子見 | 相談履歴に残し、Inbox緊急度から外す | `POST .../review` を「確認済み」として流用、または手動相談用の軽いフラグ |
| 却下する | 対応不要で閉じる | 既存 dismiss |

新規相談フォームの subtitle を例えば次のように固定する:

> まだ Issue にしないモヤモヤ・仮説検証はここ。追跡・計画が必要になったら「Issueにする」。実行中の介入の壁打ちは Issue Workspace。

#### Dashboard バナー
`DAY_PHASE_GUIDANCE` に1行足すだけでよい。例（朝）:

> モヤモヤは「何でも相談」、決まった介入は Issue Workspace。

#### Issue 詳細 `/issues/[id]`
Agent Run 未紐付け時の文言を、「Dashboardで起票」だけでなく:

> 横断相談から続けたい場合は「何でも相談」へ → `/chat`

紐付き Run がある場合は「この Issue の壁打ちはここで行う」と明示（既存 Copilot の上に1行）。

**ストーリーとして揃える導線**

```
モヤモヤ → /chat →（Issue化）→ /issues/[id]
自動検知 → /chat（確認）→ Issue化 or 却下
実行中介入 → /issues/[id] のみ（/chat に戻さない）
```

---

### C. Journal センシング → 行動

**置き場所:** Dashboard 左「Quick Journal」ブロック（`page.tsx` 約456–508行）

#### 1) 抽出のその場微修正
いまは POST 後すぐカード表示のみ。`PATCH`（または再保存 API）が無いので、最小は:

- Submit 直後に **編集モード**（tags / people / urgency を chip＋入力で直せる）
- 「この内容で確定」で保存（API 追加が必要なら journal-store の更新口を1つ）

ストーリー上は「AI抽出を EM が校正してから組織の事実になる」が重要。

#### 2) タグ／人物から次へ
いまの `@人` `#タグ` は装飾だけ。クリックで:

| クリック | 行き先 |
|---|---|
| `@Aさん` | `/chat` に「Aさんについて最近の懸念を整理して」をプリフィル、または長期プロファイル欄に名前セット＋スクロール |
| `#1on1` 等 | Issues 一覧を `?tag=` で開く（一覧は既にタグフィルタあり） |
| Urgency High の確定エントリ | 「次にすべきこと」に warn カード「要注目 Journal: …」→ `/chat?runId=` または新規相談プリフィル |

異常検知（high→自動 Lead）は既にあるので、**mid＋ネガティブ＋特定タグ**など「要注目だが自動起動しない」層を Inbox／次にすべきことに載せるのが C の本丸。

---

### D. 「評価不能」→ 観測アクション

**置き場所:** Team Vitals カード（`page.tsx` 約419–442）＋「次にすべきこと」

いま `unknown` は Vitals には出るが、「次にすべきこと」には **warn/bad だけ** 入り、unknown は入っていません。

足すもの:

1. **次にすべきこと**に `severity: "warn"` で  
   `⚪️ Team C は評価不能（情報不足）— 観測を増やす`
2. カード内「根拠を見る」の下に CTA:
   - `Quick Journalにメモする` → `focusJournalInput()`（既存）
   - メンバーが分かるなら `〇さんの1on1を記録` → Journal に `#1on1 @名前` をプリフィル
3. 1on1 Coverage の warn/bad も、`/org` 遷移だけでなく **未カバーメンバー名が reason に出るなら** Journal プリフィルへ

`/org` 遷移は「体制を直す」用に残し、「見えていない」系は Journal へ寄せると物語が分かれる。

---

### E. 横断 Activity Stream（簡易）

**置き場所:** Dashboard。理想は右ペインだが、現状は `dashColumns` が Journal｜Inbox の2列なので、**Fleet の直下に横長パネル**が最小コスト。

```
[次にすべきこと]
[Fleet]
[Activity Stream ← 新規・高さ固定・最新が上]
[Vitals]
[Journal | Inbox]
```

中身は既存 `runs[].log`（または Run の末尾数行）を時刻順にマージしただけ。

- 行例: `[People] 📖 …` / `[Process] 🟡 Yield: …`
- 行クリック → 紐付き Issue or `/chat?runId=`
- ポーリングは既存 `useRuns` のまま

「ターミナル風ストリーム」の体験を、**新基盤なしで Dashboard に常設**するのが目的。本格 SSE は後回し。

---

### F. Product Agent

**置き場所:** ほぼ設定・選択肢のみ。

| 箇所 | 変更 |
|---|---|
| `AGENT_OPTIONS`（`types.ts`） | `"Product Agent"` を追加 |
| Dashboard Inbox の select | 自動で出る |
| Fleet 行 | 自動で5つ目の灯が出る |
| `agent-runtime` の専門エージェント説明 | Product 向け1段落（優先順位・顧客価値・ロードマップと組織の齟齬） |
| Lead の consult 先候補 | Product を含める |

UI 新規画面は不要。ストーリー上は Inbox／相談起票時に「プロダクト側の組織障害」を選べるようになれば十分。

---

### G. Issue に「介入の型」

**置き場所:** Issue 起票 Modal（`issues/page.tsx`）と詳細の tags（`issues/[id]/page.tsx`）

`tags` は既にあるので、**自由タグの前にプリセット型**を置くのが最小。

例プリセット（チップで複数可）:

- `役割明確化`
- `意思決定プロセス`
- `依存関係の切り方`
- `1on1設計`
- `プロセス変更`
- `優先順位／スコープ`
- `心理的安全性`
- `採用・オンボーディング`

起票時に型を選ぶと、Why/What/How の placeholder を差し替える:

| 型 | Why の例 |
|---|---|
| 役割明確化 | 誰が何に責任を持つか曖昧で、手戻り／待ちが発生している |
| 意思決定プロセス | 決まる場所が無く、現場が止まったりエスカレーションが遅れる |

詳細画面のタグ欄の上に同じチップ列を置き、「介入の型」として見せる（保存は既存 `tags`）。

フィルタは既存タグフィルタのまま「型で絞る」体験になる。

---

### 画面別・作業順（実装イメージ）

| 順 | 項目 | 主ファイル | 依存 |
|---|---|---|---|
| 1 | **B** 相談の Issue化を手動にも開放＋案内文 | `chat/page.tsx`, `page.tsx` バナー | ほぼ UI |
| 2 | **A** NextAction に kind／proposal要約、Inbox にラベル | `page.tsx`, 型は `RunDetail` の Proposal | UI中心 |
| 3 | **D** unknown を次にすべきこと＋Journal CTA | `page.tsx` | UI中心 |
| 4 | **C** 抽出編集＋タグクリック導線 | `page.tsx` ＋ journal API 更新 | 小さな API |
| 5 | **G** 介入型プリセット | `issues/page.tsx`, `issues/[id]/page.tsx` | UI中心 |
| 6 | **F** Product Agent | `types.ts` ＋ runtime プロンプト | 小 |
| 7 | **E** Fleet 下に横断ログ | `page.tsx` | UI中心 |

B→A→D が先なのは、**朝開いた瞬間の物語**が「組織課題のトリアージ」になるからです。E/F/G は体験の厚み、C はデータの質を上げるレイヤです。

---

### 触らなくてよい境界（今すぐスコープ外）

- Org Context のデータモデル拡張（チーム別ミッション）→ 中期 I  
- People 専用ページ → 中期 J  
- OKR 構造化 → 中期 H  
- 本格マルチエージェント合議 → 中期 M  
- Journal 表示マスキング → memo 保留のまま

---

### 実装前のコード照合・決定事項（確定）

着手前に現行コードと突き合わせた結果、方針・優先順位（B→A→D→E→F→G）はそのまま進めてよいことを確認。以下、認識合わせが必要だった点と決定事項。

**A. Inboxトリアージ化（部分一致）**
`NextAction`（`web/src/lib/types.ts`）は「テキスト1行」ではなく、既に `severity`(urgent/warn)・`icon`・`onSelect` を持ち、`isUnreviewedAuto`/`autoLabel` で origin 別の文言分岐まで実装済み（`web/src/app/page.tsx:251-330`）。カード種別化は「新規追加」というより「既存分岐のリファクタ」に近い作業になる。

**B. 相談↔Issue昇格（一致＋要決定）**
`handleDismiss`（`web/src/app/chat/page.tsx:89-102`）は `reviewed=true` をセットするだけで、`isUnreviewedAuto = !run.reviewed` の判定にしか使われていない。つまり**現状の `reviewed` は bool 一つで「様子見」と「却下」を区別できない**。そのまま流用すると様子見＝却下と同じ挙動（Inboxから完全に消える）になる。
→ **決定: `reviewed` とは別に独立フラグ（`triageStatus: "watching" | "dismissed"` 相当）を新設し、様子見と却下を区別する。**

**C. Journal編集導線（一致）**
journal-store には POST（`addJournalEntry`）しか無く、更新系APIは皆無。memoの「小さなAPI追加が必要」という見積もりは正確。

**D. 評価不能→観測アクション（一致＋補足）**
`TeamVital.reason`（`web/src/lib/types.ts:100`）は自由文字列で構造化されておらず、「未カバーメンバー名を reason から取り出して Journal にプリフィル」は文字列パースが必要になり脆い。実装時は vitals 計算側にメンバー名の構造化フィールドを足すか検討する。

**E. Activity Stream（一致）**
`dashColumns`（`web/src/app/page.tsx:455`）は Journal｜Inbox の2カラム構成のみで memo の記述と一致。

**F. Product Agent（一致＋変更範囲拡大＋要決定）**
`AGENT_OPTIONS`（`web/src/lib/types.ts:145`）に Product Agent 無しは事実だが、`web/src/lib/agent-runtime.ts` 側には独立した `SPECIALIST_AGENTS` 配列（45行目）があり、さらに Lead Agent への consult プロンプト文言中に専門エージェント名がリテラルで2箇所埋め込まれている（`agent-runtime.ts:446-451`）。「types.ts と runtime の説明1段落」だけでなく、この配列とプロンプト文言、`extractConsult` のバリデーション（581行目）も同時に直す必要がある。
→ **決定: Product Agent は Lead の consult 先候補に含める（`AGENT_OPTIONS`・`SPECIALIST_AGENTS`・consultプロンプト文言・`extractConsult` の4箇所を同時変更）。**

**G. 介入の型（一致）**
`tags` は `Issue` 型に既存（`web/src/lib/types.ts:136`）で、`PATCH /api/issues/[id]` も既に why/what/how/tags を受け付けているため、新規API不要というmemoの判断は正確。

---

## TODO
* 人間EM自体の成長に対する向き合いを作る。EM本人のバイタル、週次振り返りの入力・改善方針機能を作る
* Quick Journal、Issue進捗、各種イベントを週次・月次でレポーティングする機能を追加する。レポートを一過性とせず、蓄積して過去のものも参照できるようにする
* Quick Journal を人間側が後からリスト確認・検索しにくいUIになっている。ダッシュボードトップでは直近５件程度にとどめつつ、Quick Journalをリスト確認・検索できる画面を追加する
* Issue以外の組織情報や目標の不足など、明示化されていないAIエージェントチームを精度高く動かすために必要なアクションも、ダッシュボードで示すようにする
* Organization Contextの動的ロードを「対象Issueに関連するチームのみ」に絞る（docs/first_implession 3.1の要求。現状は常に全チームを無条件注入）
* ローカルNER（`people-directory.ts`の`detectAndRegisterNames`）の誤検出対策。Issue/Objective/Journal/Team等の自由記述タイトルが「NPS」のような一般名詞・短い語句・入力文全体（EMの壁打ちメッセージまるごと等）を人物名と誤認識し`people-directory`に登録してしまうことがある（H・I実装時に複数回実機確認）。**特に深刻なケース**: I実装時、Issueタイトルに含まれていた既存チーム名「検証チーム」がまるごと誤登録され、`buildOrgContextBlock`が意図的にマスクせず注入しているチーム名（`org-context-store.ts`の設計）自体が`assertNoRealNamesLeaked`に「実名漏洩」と誤判定され、そのチームに関するAgent Run送信が以後すべて止まる状態になった（EMには誤登録を確認・削除する手段が無く、直接`~/.local/state/em-ai-team-secure/people-directory.json`を編集しないと復旧できない）。対策候補: 抽出後の簡易フィルタ（極端に短い/長い候補の除外、記号・英数字のみの候補除外、既存チーム名との衝突チェック）、EMが誤登録を確認・削除できるUI、または誤登録時に安全側で無視する仕組み。**さらに深刻なケース（K実装時に実機確認）**: EMからの壁打ちメッセージ中の「Issue」「Option B」という単語自体が丸ごと人物名として誤登録され、以後「Issue」という単語がagent-runtime.ts側の**システムプロンプトのテンプレート文言そのもの**（「このタスクはIssueに紐づいています」等、action_items/sub_issuesルールに常時含まれる）と衝突。結果、そのIssue固有の話ではなく**アプリ全体のあらゆるAgent Run送信**が実名漏洩と誤判定されて止まる状態になった。テンプレート文言に含まれる汎用語（Issue/Option/Team等）がNERの誤検出候補になり得る以上、抽出後フィルタには最低限「システムプロンプトのテンプレート文言に含まれる語との衝突チェック」を含めるべき

## 保留
* CLIのインタラクティブモード（REPL）とWeb UIを標準入出力で直接ストリーム接続する設計への変更（docs/first_implession 3.4の要求。現状は非対話実行＋`--resume`によるセッション再開方式。体験は同等のため保留）
* Quick Journalの表示側サニタイズ（画面表示時のマスキング、docs/first_implession 3.2の要求。外部LLM送信前のマスキングは実装済みだが、EM自身の画面には生テキストが表示される）

## DONE
* 個人名は人間に見せるときは実名（特定できる名前）で表示したいが、LLMに渡すときにはマスクしたい。ただし、マスクした後で誰のことを指しているか不明になるのは避けたい。そこでスクリプトやローカルLLMのみ読める場所にID:名前の組み合わせをデータベースとして持ち、インプット時はIDに置き換えてから外部LLMに送信、ダッシュボード等への表示時にはプログラムでID→名前に戻して表示するといったことをする。
* Issueのアーカイブなどができないのでできるようにする
* チームの編集・アーカイブができるようにする
* チームや、メンバーごとの関連するIssueおよびIssueではない特性や問題などについて、Organization Context から確認できるようにする
* チームの組織階層を入力できるようにする（チーム名で `/` をつけると組織階層をつけられるようにする。`/` の前後の空白は名前として無視するようにする）
* Issue にカテゴリ・タグ付けをしたい
* リストにおける、フィルタ機能の拡充、ページネーションの追加を行う
* ワイヤーフレームのスタイルテーマを適用する
* ダッシュボードで「人間のEMが次になにをするべきか？」がすぐに分かり、詳細に遷移できる状態にする
* Agent Runが「動いていると思ったら止まっていた」を防ぐ無応答検知（応答なしの警告表示＋一定時間超過後の子プロセス強制終了による自己修復）
* 永続化データモデルの再設計 Phase 1（イベントソーシング＋バイテンポラル＋ファクト/解釈分離のKnowledgeEventモデルを導入し、Journal・Agent Runの実行ログをSQLiteへ移行。TTLによる重み付けをAgent Runtimeへの注入に反映）
* 永続化データモデルの再設計 Phase 2（Issue/Teamの変更履歴もKnowledgeEventとしてイベント化する）
* 永続化データモデルの再設計 Phase 3（ローカル完結のベクトル検索。埋め込みはtransformers.jsでローカル生成し、ブルートフォースのコサイン類似度検索を実装。副次的にmaskNames/unmaskNamesの自己破壊バグも修正）
* Claude Code が使えない場合に、Gemini CLI を使うようにする（Settingsでエージェント種別ごとにON/OFF可能。トリガーは実行失敗・予算/レート制限の両方。実装は生の`gemini` CLIではなく`agy`経由に変更——実際のGemini応答成功・複数ターンの会話継続まで実機で検証済み）
* AIエージェントが権限制約でファイル更新できないパターンなどの例外に対しての扱いと解決方針を決めておく（claudeは`--tools ""`で構造的に発生しない。agyフォールバックのみ発生し得るが、既存のエラー処理・無応答検知にそのまま乗せる方針とし、自動リトライはしない）
* 初回に組織情報やMVV、目標等の情報を大量に投入する必要があるため、その方法を検討しておく（MVVは既存のStrategy自由記述で対応可能、チームは`POST /api/teams/bulk`で1行1チームの簡易フォーマットによる一括登録に対応）
* 一時的なエラー等で止まった場合の再開させるボタンの追加をする（Issue詳細のExecution Stateに「同じ内容で再試行する」ボタンを追加。既存の`decideRun`をそのまま利用）
* 人間EMからのインプットパターン（始業時・随時・終業時など）を設計してダッシュボードに組み込む（時間帯に応じた1行案内バナーをDashboardに追加。朝は「次にすべきこと」確認、日中・終業時はQuick Journalへの誘導）
* これまでに収集された事実等をベースにIssue等と関係なく横断的な相談、質問ができるチャットを用意する（`/chat`を新設。Issue未起票のLead Agent runを相談スレッドとして扱い、既存のAgent Runtime/ExecutionState/CopilotChatをそのまま流用）
* 人から「〇〇の指示があった」「〇〇と伝えられた」などをもとにその人の志向性、認知傾向、パーソナリティを整理する（Dashboardの長期プロファイルフォームに「AIに下書きを提案してもらう」ボタンを追加。People Agentへ通常のタスクとして投げるだけで、既存のファクト注入・匿名化がそのまま働く。下書きのまま自動保存はせずEMの「記録」操作を必須にする）
* サポートするAIエージェント CLI に Cursor CLI を追加する（claude→agyに続く3段目のフォールバックとして`cursor-agent`を追加。`--mode ask`でも読み取り専用ツールは自動実行してしまうことを実機発見し、`--workspace`で空の専用ディレクトリに隔離することで対処。実際のGPT-5応答成功・`--resume`による会話継続まで実機で検証済み）
* AIによる異常検知経由のドラフトIssue起票を実装する（Journalの緊急度がhighになったらLead Agentが自動分析し、結論でIssue化を検討する旨を示す。Issue作成自体は既存のInbox→Issue化フローを流用。EMが「Issueにする」/「却下する」を選ぶまでDashboardに残り続ける）
* エージェントの起動トリガーにイベント駆動・バッチ駆動を追加する（イベント駆動は上記の異常検知と共通実装。バッチ駆動は毎朝指定時刻に1回だけ「朝のサマリー」runを自動起動。どちらもSettingsで既定OFF）
* 壁打ちチャットのAI提案からIssueのState（Action Items）を直接・動的に更新できるようにする（Issue紐づきのタスクに限り`action_items`ブロックでの提案を許可し、Execution Stateに「採用してAction Itemsに追加」/「却下する」ボタンを追加。EMが選ぶまでIssue本体は変化しない）
* 【大規模改善B】「何でも相談」↔Issueの昇格物語をはっきりさせる（`reviewed`とは別に`triageStatus`（"watching"|"dismissed"）を追加し、様子見と却下を区別。`/chat`の選択中スレッド上部に「Issueにする／様子見／却下する」を常設し、手動相談にも開放。Dashboard朝バナーとIssue詳細の未紐付け／紐付き文言も更新）
* 【大規模改善A】Inboxを組織リスクのトリアージにする（`NextAction`に`kindLabel`を追加し「次にすべきこと」の各カードに種別チップ（異常検知／朝のサマリー／Yield／実行異常／Issue未整理／チームリスク／1on1不足）を表示。Inbox一覧にも同じ語彙のラベルを追加して語彙を統一。異常検知ドラフトはtask要約より`proposal.conclusion`を優先表示）
* 【大規模改善D】「評価不能」→観測アクション（`TeamVital`に`members`、`CoverageVital`に`uncoveredMembers`を構造化フィールドとして追加し、`reason`の自由文からのパースを回避。評価不能チームを「次にすべきこと」にも表示し、Team Vitalsカードと1on1 Coverageカードに「Quick Journalにメモする」「〇さんの1on1を記録」CTAを追加してQuick Journal欄へプリフィル。`/api/vitals`側でPERSON_n IDをunmaskNamesして実名化）
* 【大規模改善C】Journalセンシング→行動（イベントソーシングの不変性を保ったまま、`supersedes`で新イベントを繋いで「その場微修正」を実現。`PATCH /api/journal/[id]`と`journal-store.ts`の`updateJournalEntry`を追加し、Submit直後は自動で人物/タグ/Urgencyの編集モードに入る。既存エントリにも「編集」ボタンを追加。Quick Journalの`@人物`クリックで`/chat?prefill=`へ、`#タグ`クリックで`/issues?tag=`へ遷移する導線を追加。urgency:mid＋sentiment:negativeの直近24時間以内のエントリを「次にすべきこと」に「要注目Journal」カードとして表示）
* 【大規模改善G】Issueに「介入の型」を足す（`types.ts`に8種類の`INTERVENTION_TYPES`プリセットを追加。起票モーダル・詳細画面の両方にチップ列を表示し、選択すると既存の`tags`へ追加/削除、Why/What/Howのplaceholderを型に応じて差し替え。新規フィールドは増やさず保存は既存tagsのまま。実装中、詳細画面でissueが非同期取得のため初回チップハイライトが同期しないバグを発見・修正（useEffectでのsetStateはこのプロジェクトのlintで禁止されているため、レンダー中に前回issueIdと比較して同期する方式で対応））
* 【大規模改善F】Product Agentの追加（`AGENT_OPTIONS`・`SPECIALIST_AGENTS`（Leadのconsult先候補）・consultプロンプト文言2箇所にProduct Agentを追加。実装前の調査では「専門エージェントごとの説明1段落」が別途存在する想定だったが、実際にはPeople/Process/Techも含めエージェント名以外の役割ペルソナ記述はagent-runtime.tsに存在せず、モデルがagentNameだけから役割を推論する設計だったため、Product Agentも同じ方式に揃え追加の説明文は書かなかった。実機でRunを起動しproposalブロックまで正常応答することを確認）
* 【大規模改善E／TODO「Agent Activity Streamパネル」】横断Activity Stream（新規パネルはFleetの直下・Vitalsの上に配置。既存`runs[].log`を時刻順にマージして表示するだけで新基盤は導入せず、ポーリングも既存`useRuns`のまま。行は`[エージェント名] アイコン テキスト`形式、クリックで紐付くIssueがあればそこへ、無ければLead Agentの場合は`/chat?runId=`へ、それ以外は既存の`goToRunIssue`と同じくその場でIssue化して遷移する）
* 【大規模改善H】戦略→Issue→結果の一本線（自由記述1本だった`OrgStrategy.okr`を廃止し、Objective（目標）ごとにKeyResult（主要な結果）を持つ最小構造へ置き換え。`org-context-store.ts`にObjective/KeyResultのCRUDと、KeyResultへ紐付いたIssueの完了（archived）件数から進捗を自動算出する`listObjectivesWithProgress`を追加（手動での進捗入力はしない）。Issueに`keyResultId`を追加し、起票モーダル・詳細画面の両方でKey Resultへ紐付け可能に。`/org`にObjectivesツリー・エディタパネルを追加（Strategyと同じUIパターン）。Agent Runtimeのプロンプトにも`buildObjectivesBlock`でObjective/KR一覧を絶対の前提として注入。検証中、ローカルNER（`maskForStorage`内の`detectAndRegisterNames`）がObjective/Issueタイトルの一部やタグ的な短い語（例:「NPS」「H項目」等）を人物名と誤検出して`people-directory`に登録し、その後の`assertNoRealNamesLeaked`が正当なテキストを実名漏洩と誤判定してAgent Run送信を止める事象を複数回確認——H機能自体のバグではなく、Journal/Issue/Strategy等あらゆる自由記述に共通する既存のローカルモデル精度の課題）
* 【大規模改善I】チーム単位の憲法（ミッション／制約）（`Team`に`charter: {mission, constraints}`を追加（`org-context-store.ts`、既存teams.jsonへのマイグレーションも対応）。`/org`のチーム編集画面にMission/制約欄を追加。IssueにH同様の`teamId`を追加し、起票モーダル・詳細画面で関連チームを紐付け可能に。Agent Runtimeに`buildTeamCharterBlock`を追加し、そのRunが紐づくIssueにteamIdがある場合だけ、そのチームのMission/制約を絶対の前提として動的に注入（docs/memo.md TODO「Organization Contextの動的ロードを対象Issueに関連するチームのみに絞る」に対応する部分。全チームの名簿一覧`buildOrgContextBlock`は従来通り常時注入のまま維持し、チーム憲法の方だけ紐づくIssue単位でスコープする設計）。検証中、Issueタイトルに含まれていた既存チーム名「検証チーム」がまるごとローカルNERに誤検出され、`buildOrgContextBlock`が意図的にマスクせず注入しているチーム名と衝突して`assertNoRealNamesLeaked`が誤発火し、そのチームに関するAgent Run送信が止まる状態を実機確認——上記NER誤検出TODOに詳細を追記済み）
* 【大規模改善J】Peopleを第一級ハブに（新規の永続化エンティティは持たず、既存のpeople-directory（誰がいるか）・knowledge-store（Journal fact・長期解釈）・org-context-store（チーム所属）・issue-store（関連Issue、名前一致の簡易抽出）を人物軸で束ねる集約レイヤー`people-hub.ts`を新設。`/people`（一覧）・`/people/[id]`（詳細：長期プロファイル・直近Journal・関連Issueを横断表示、傾向はJournalのsentiment集計から機械的に算出）を追加し、`TopNav`に新規タブを追加。詳細ページはPERSON_n IDだけでなく実名でもアクセス可能にし（`getPersonProfile`が両対応）、Organization ContextのMembers_Profileチップから直接遷移できるようにした。実ブラウザ確認で花子さんの既存の長期プロファイル「花子さんはリーダー志向がある」と関連Issue「花子さんのオンボーディング改善」が実データのまま正しく横断表示されることを確認——テストデータを一切作らずに実データだけで検証できた数少ない項目）
* 【大規模改善K】ズームイン／ズームアウトの協働計画（既存のaction_items提案の仕組み（AIが下書きを提案し、EMが「採用」するまでIssue本体は変化しないHuman-in-the-Loop）を子Issue分解へ横展開。トップレベルのIssue（1階層制限のため子Issueはさらに分解できない）に紐づくRunに限り、system promptへ`sub_issues`ブロックのルールを追加し、AIが「このIssueは抽象的すぎる」と判断した場合に具体的な子Issue案を提案できるようにした。`AgentRun`に`suggestedSubIssues`を追加（DB永続化・unmask含めaction_itemsと同じ配線）、`RunDetail.tsx`に採用/却下UIを追加、採用時は既存の`POST /api/issues`（parentId指定）を複数回叩くだけで新しい起票経路は増やしていない。実機のLead Agent runで実際に「新機能のリリースプロセス全体を整備する」というIssueに対し、proposal・action_items・sub_issues（5件の具体的な子Issue案）が同時に生成されることを確認。Playwright検証で採用ボタンから5件すべての子IssueがparentId付きで正しく作成され、提案ブロックが消え、独立して残るAction Items提案には影響しないこと、既に子Issueを持つIssueでは「上位Issueを作る」ボタンが自動的に非表示になる（既存の1階層制限ロジックが正しく反応する）ことまで、実ブラウザで最後まで完走させて確認した。却下（`/api/agents/[id]/sub-issues/dismiss`）が提案を正しくクリアすることもAPIレベルで確認。検証中、EMからの壁打ちメッセージに含まれていた「Issue」「Option B」という単語がまるごとローカルNERに誤登録され、agent-runtime.ts側のシステムプロンプトのテンプレート文言そのもの（「このタスクはIssueに紐づいています」等）と衝突して**アプリ全体のAgent Run送信が止まる**という、上記NER誤検出問題の中でも最も深刻な事例を実機確認——TODOに追記済み）
* 【大規模改善L】介入の閉ループ（やった→組織が変わったか）（新しいVitalsロジックは作らず、既存のcomputeTeamVital（直近teamWindowDays日間のJournal sentiment集計）と同じ考え方を「アーカイブ前のteamWindowDays日間」「アーカイブ後のteamWindowDays日間」の2つの窓に分けて適用する`computeIssueImpact`を`vitals.ts`に追加。Issueに`archivedAt`を追加（`updatedAt`は他の編集でも動くため、いつアーカイブされたかを正確に知るための専用フィールドとして分離）。`GET /api/issues/[id]/impact`を新設し、アーカイブ済み・チーム紐付き済みのIssueに限り介入前後比較を返す（それ以外はnull）。Issue詳細画面に「介入の効果」パネルを追加し、観測データがまだ無い場合は「感覚」で埋めず「しばらく経ってから確認してください」と明示（Team Vitalsの評価不能と同じ設計思想）。実機確認でAPIが正しい形状のレスポンス（アーカイブ・チーム紐付き双方の条件を満たさない場合はnull）を返すこと、UI上でパネルの出し分けと表示内容が正しく機能することを確認）
* 【大規模改善M】AIエージェント“チーム”の本格協働（並列相談を採用。`ConsultRequest`を`{agent: string}`から`{agents: string[]}`へ変更し、Lead Agentが1ターンで複数の専門エージェントに同時に相談できるようにした。`extractConsult`は`agents`配列（SPECIALIST_AGENTSに無い値は除外、重複除去、後方互換で単数`agent`も受理）をパースし、`handleConsult`は`Promise.all`で全専門エージェントのrunを並行実行、全員の回答をラベル付きでLead Agentに返して統合結論を出させる（連鎖相談は無限ループリスクのため引き続き禁止＝specialistRunはallowConsult=false）。新しいデータモデル・APIは増やさず、既存のFleet/Inbox/Activity Streamが複数run同時activeをそのまま表示するため、UI側の変更は不要だった。実機のLead Agent runで「メンバーのモチベーション低下とリリース遅延」という人材面・プロセス面にまたがるタスクを与え、実際にPeople Agent・Process Agentへ同時相談→両者の回答をLead Agentが統合し、見解の一致点・相違点を踏まえた上で本当に必要な追加情報（対象者の特定）をyieldで求めるところまで実機確認。Fleet・Inboxに両専門エージェントが同時に表示されることも確認）
