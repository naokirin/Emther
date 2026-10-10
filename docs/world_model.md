# 組織モデル（World Model）

作成日: 2026-10-10  
ステータス: **Phase 1〜4 実装済み（store・API・UI、蒸留からの差分候補、Agent 前提への注入と提案での引用、Journal 分析での食い違い検出）**  
関連: `docs/philosophy.md` / `docs/knowledge_distillation.md` / `docs/goal_policy_model.md`

## 0. 目的

Emther が観測・蒸留した情報を、提案に流すだけで終わらせず、**「EM から観測できる範囲で、対象組織が実際にどうなっているか」を表すモデル**として内部に持つ。

- Block の World Model（組織の入出力・動き方・リスク/失敗モード。人の要約ではなく一次情報から構築）の考え方を取り入れる。
- 分析・提案はこのモデルを前提に行い、モデルとの**差分**（裏付け・矛盾・新規）として新しい観測を扱う。
- ユーザーはモデルを閲覧でき、採用・却下・文言訂正・注釈・固定で手を入れられる。
- 複数 EM のモデル統合は今回スコープ外。ただし要素 ID・出典・版チェーンは将来の突き合わせに耐える形にしておく。

## 1. 位置づけ（既存との関係）

| 既存 | 性質 | モデルとの関係 |
|---|---|---|
| Goal / Policy / Theme / MVV | EM の**意図・注力**（あるべき姿） | モデルの一部ではない。ID 参照のみ。意図と実態の**ギャップ**をモデル側で表現する |
| knowledge event（fact / interpretation） | 観測の履歴（追記のみ） | モデル要素の**根拠**。モデルは events を置き換えない |
| OrgTheme（蒸留テーマ） | 週次蒸留の「解釈」成果物 | 既存のまま存続。モデル要素の生成材料の一つ |
| person-evaluation | 個人評価系 | **モデルから完全に分離**。モデルは読み書きしない |

モデルは「events の上にある、EM が確認した現在の組織像」の層。fact を消さない原則（`knowledge-types.ts`）を踏襲し、要素も削除せず版管理する。

## 2. 要素タクソノミー（案）

実態（observed）と意図（intent）を分け、両者のずれを一級の要素とする。

### 2.1 実態（observed）

| kind | 内容 | 例 |
|---|---|---|
| `structure` | チーム構成・役割・責務境界・所属（人物は PERSON_n と役割/所属のみ） | 「プラットフォームとアプリの境界が曖昧」 |
| `flow` | 仕事・意思決定・情報が実際にどう流れるか | 「仕様判断は実質 PM ではなくテックリードが行う」 |
| `dependency` | チーム間・技術・人への依存、ボトルネック、単一障害点 | 「リリースがチーム A のレビュー待ちで詰まる」 |
| `dynamic` | 繰り返し現れる力学・緊張・パターン | 「期末前に割り込み対応が集中する」 |
| `condition` | 負荷・健全性・士気などの状態と推移（チーム/組織単位） | 「オンコール負荷が3週連続で高い」 |
| `external` | 外部圧力・制約（他部署・顧客・経営・期限） | 「四半期末の監査対応が控えている」 |
| `risk` | 失敗モード・リスク | 「X さん不在時に止まる領域がある」（人物は PERSON_n・評価語なし） |

### 2.2 関係性（relationship）

チーム・人の**あいだ**にある業務的・心理的な関係は、`relationship` 要素として持つ。個人や単独チームの属性ではなく、必ず「2つの主体のあいだ」の記述にする。

```text
relationship
  parties: [ { type: team | person, id }, { type: team | person, id } ]   // person は PERSON_n
  aspect:  work | psychological
  stance:  下表の観点（固定語彙）
  statement: 現在の見立て（描写。評価語を使わない）
```

| aspect | stance（観点） | 例 |
|---|---|---|
| `work` | `collaboration`（協働の質）/ `handoff`（引き継ぎ・境界）/ `decision_rights`（決定権の所在）/ `information_flow`（情報の流れ） | 「A↔B 間は仕様変更の連絡が遅れがち」 |
| `psychological` | `trust`（信頼・安心して頼れるか）/ `tension`（緊張・摩擦）/ `psychological_safety`（意見の言いやすさ）/ `alignment`（認識・目的の一致） | 「C↔D は懸念を直接言いにくい空気がある」 |

- 方向性が意味を持つ場合のみ `parties` の順序を `from → to` として扱う
- 心理的 aspect も**関係の描写**に限る。特定個人の性格・能力・性向の断定は載せない（§4）
- 単独チーム内の雰囲気・力学は `dynamic`、チーム/組織単位の状態は `condition`。2者間の話になったら `relationship`
- 関係要素は §3 の `relation`（要素同士のリンク）とは別物。前者は「現実の主体間の関係」、後者は「モデル要素間の参照」

### 2.3 意図とのギャップ（gap）

| kind | 内容 |
|---|---|
| `gap` | 参照する Goal/Policy/Theme（ID）と、実態要素（ID）の食い違い。「前提は妥当か」を問う入口 |

## 3. 要素の共通フィールド

```text
ModelElement
  id, kind, title, statement          // statement = 現在の見立て（1〜3文）
  scope: { teamIds[], personIds[] }   // personIds は PERSON_n のみ。relationship は parties で主体を持つ
  evidence: { eventIds[], journalIds[], suggestionIds[], themeIds[] }
  confidence: low | mid | high        // AI 推定。EM 操作で上書きされない
  status: candidate | adopted | pinned | dismissed | stale
  firstObservedAt, lastConfirmedAt    // バイテンポラル（実態の時点 / 記録の時点）
  supersedes?                         // 文言訂正・再解釈の版チェーン
  userNote?                           // EM の注釈（AI 入力にも載せる）
  origin: ai | user                   // 手動追加は user
  sourceRunId?
```

要素間の参照（element relation）は `{from, to, type}` として別持ちする。type は `depends_on` / `influences` / `conflicts_with` / `explains` / `gap_between` 程度に絞る（自由記述にしない）。

### 状態遷移

- `candidate` → `adopted`（EM 採用）/ `dismissed`（却下）
- `adopted` → `pinned`（「これは正しい」と固定。AI は上書きしない）
- `adopted` / `pinned` → `stale`（一定期間確認されない。自動。pinned は stale にしない）
- 文言訂正は新版を `supersedes` で連鎖。訂正済み版は自動的に pinned 扱い
- 削除はしない

## 4. 守られるべき情報

- 人物は `PERSON_n` のまま。**個人評価・性格・能力に類する属性は載せない**（役割・所属・関与のみ）。プロンプトと生成後フィルタの両方で強制する
- 保存前の変換は既存の `maskForStorage` / `unmaskNames` を使う（`PERSON_n` 接頭辞衝突バグが既出のため自前の正規表現は書かない）
- 生成テキストは既存の mask-check / 隔離経路を通す
- `sensitiveAt` の Journal は根拠 ID としては数えてよいが、引用・要約を要素本文に出さない
- モデルは person-evaluation-store から読まない
- クラウド LLM に渡す入力は既存のマスク済みコンテキストのみ（モデル要素自体も PERSON_n でマスクされている）

## 5. 更新の仕組み

**再生成ではなく差分提案**とする。

1. 入力: 新しい events / Journal 分析 / 週次蒸留の結果 + 既存の adopted・pinned 要素
2. Agent は既存要素 ID に対する更新候補を返す: `confirm`（裏付け）/ `contradict`（矛盾）/ `refine`（精緻化）/ `new`（新規）/ `stale`（古い可能性）
3. 候補は Run → proposal block → EM 採用の既存フロー（テーマと同じ）に乗せる
4. pinned・EM 訂正済み要素は AI が直接書き換えない。`contradict` 候補が出るだけ

週次 auto-distill は置き換えず**拡張**する（`buildThemesContextBlock`・Dashboard「優先テーマ」・`autoDistillation*` 設定を壊さない）。

## 6. 活用

| 面 | 内容 |
|---|---|
| 閲覧 UI | 種別別一覧＋関係の辿り、根拠（Journal/Theme）へのリンク、「なぜこの見立てか」。閲覧と判断のみ。**タスク化・進捗管理 UI は持たない**（2nd pivot） |
| Agent 前提 | adopted/pinned 要素のうち、クエリに関連が強い最大4件だけを注入（5件以下なら全件。索引は持たない）。関連が無ければ固定済み最大3件のみ。提案は根拠にした要素 ID を `worldModelRefs` で引用 |
| Journal 差分検出 | `auto-anomaly` / `auto-journal-batch` で、新観測がモデルと食い違うとき（contradict）と、繰り返し観測された新規（最大2件）だけを更新候補として出す。confirm / refine / stale は蒸留のみ（日次の確認負荷を増やさない） |
| 週次再構築 | auto-distill の延長で差分候補を生成 |

## 7. 実装フェーズ

各フェーズは前段に依存する。

| Phase | 内容 | 完了条件 |
|---|---|---|
| 0 | 本ドキュメント＋タクソノミー確定 | EM がタクソノミーを承認 |
| 1 | store（`*-types/-domain/-repository` 分割）、API、`api-contract` 型、読み取り UI、編集操作（採用/却下/訂正/注釈/固定）、backup/restore/reset 対応 | テスト付きで UI から操作可能 |
| 2 | 週次再構築が差分候補を生成 | 既存 distill の挙動を維持 |
| 3 | Agent 前提への注入（索引＋関連取得） | 提案に要素 ID が引用される |
| 4 | Journal 差分検出 | `auto-anomaly` から更新候補が出る |

## 8. 非スコープ

- 複数 EM のモデル出力・統合
- モデルからのタスク/進捗管理
- ユーザーによるスキーマ（kind / relation type）の自由変更
