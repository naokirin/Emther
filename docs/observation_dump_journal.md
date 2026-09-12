# Observation Dump → Journal（外部ログ取り込み）

作成日: 2026-09-12  
最終更新: 2026-09-12（初回実装: Dump 永続・種別別 parse・`/journal` UI・採用→Journal）  
性質: **実装方針メモ**（決定済みの前提を固定。細部の API／ファイル名は実装時に調整可）  
関連:

- `docs/value_hierarchy_and_flow.md`（記録と構造化の分離・Journal 一括）
- `docs/issue_tracker_contract.md`（分割 ≠ Issue 化。Intake は明示起票）
- `docs/em_human_story_and_ux.md`（感知ストーリー・朝キューを汚さない）
- 既存: Quick Journal／`POST /api/journal/bulk`（1行＝1件）／OKR `parse`→preview→`import`

---

## 0. 目的

Slack チャット・MTG ログなど、**EM が自分で書いたメモとは性質の違う観測テキスト**を取り込み、AI が意味のある事実かたまりに分けたうえで、採用分だけ通常の Journal にする。

価値:

- 感知コストを下げ、Journal／評価ログ／蒸留の材料を厚くする
- 構造化作業を AI に寄せ、EM は例外レビューに留める
- 朝の「次の1手」を増やさない

非目的（初期〜本スコープ）:

- Slack API 常時同期・チャンネル購読
- 分割結果の自動 Issue 起票
- Dashboard への入口追加（需要が見えてから）

---

## 1. 決定事項（2026-09-12）

| # | 決定 | 内容 |
|---|---|---|
| 1 | Journal 本文 | **原文抜粋中心（A）**。要約を本文にしない。短い整形のみ可。`summary` は既存のローカル抽出に任せる |
| 2 | UI 置き場 | **`/journal` の新セクションのみ**。Dashboard 追加は必須と見えてから |
| 3 | ソース種別 | **初回から `sourceType` を必須選択**し、種別ごとに分割プロンプト・残す／捨てる基準を変える（チャット／MTG／その他で意味合いが違うため） |
| 4 | 永続化 | **最初から薄い `ObservationDump` エンティティ**を持つ（再分割・監査・トレース用） |
| 5 | クラウド送信 | **マスク後のみ**（`maskForStorage`／既存の PERSON_n 方針）。生の実名テキストは外部 AI に渡さない |

---

## 2. 既存機能との役割分担

| 経路 | 向き | 分割 |
|---|---|---|
| Quick Journal（単発） | EM がその場で書く短文 | 不要（1件） |
| まとめて記録（bulk） | EM が既に **1行＝1出来事** に切ったメモ | ルールベース（行） |
| **Observation Dump（本機能）** | チャット／MTG／その他の **未分割の長い観測** | AI（種別別）→ プレビュー → 採用 |

採用後の Journal は既存モデルに乗る（未確認 → 校正 → 必要なら自動分析）。Dump 段階では自動分析を起動しない。

---

## 3. ソース種別（`sourceType`）

投入時に EM が必ず選ぶ。種別はプロンプトと UI 文言の分岐に使い、長期的にパーサを足してもよい。

| `sourceType` | 想定入力 | 残すもの（優先） | 捨てる／弱めるもの |
|---|---|---|---|
| `chat_log` | Slack 等の会話ログ | 合意・依頼・懸念・エスカレーション・人の状態に触れる発言、スレッド結論 | 雑談、スタンプのみ、ボット通知の羅列、重複リアクション |
| `meeting_log` | 議事メモ・文字起こし | 議題ごとの決定・未決・アクション・空気／リスクの感知 | アジェンダ読み上げ、相槌、議題と無関係な脱線（必要なら1チャンクに圧縮可） |
| `other_log` | 上記以外（メール要約、インシデントメモ、週報の切り出し等） | EM が組織感知として残すべき事実・揺らぎ | 手続き通知のみ、重複する定型文 |

共通ルール:

- チャンク単位は **事実・感知**（誰が／何が起きた／どんな空気・リスクか）
- 1チャンクはおおよそ 1〜5 文、または「議題1つ／スレッド結論1つ」
- **本文は原文抜粋**（マスク対象名は保存時に PERSON_n。表示は既存どおり unmask）
- AI が言い換えて「きれいにした要約」を Journal 本文にしてはならない

---

## 4. データモデル

### 4.1 `ObservationDump`（薄いエンティティ）

```text
ObservationDump
  id
  sourceType: chat_log | meeting_log | other_log
  title?                 // 任意（「9/10 週次」「#team-foo スレッド」）
  rawText                // 原文（マスク前はメモリ上のみ。永続はマスク済み）
  rawTextMasked          // 永続正本（クラウド・再分割の入力もこれ）
  status: received | parsing | draft_ready | partially_accepted | done | discarded | failed
  createdAt / updatedAt
  occurredRangeHint?     // 任意（開始日・終了日のヒント）
  parseError?
  chunkDrafts: ChunkDraft[]
```

永続時の本文は **必ずマスク済み**。UI 表示時のみ unmask。

### 4.2 `ChunkDraft`（未確定の提案）

```text
ChunkDraft
  id
  textMasked             // 原文抜粋（マスク済み）。採用時に Journal.rawText へ
  suggestedOccurredAt?   // 日粒度で可
  people[] / tags[]      // 提案。確定は Journal 校正に委ねてよい
  confidence             // 0..1
  disposition: pending | accept | edit | merge_into | drop
  dropReason?
  acceptedJournalId?     // 採用後
```

### 4.3 Journal 側の弱いリンク

採用して作った Journal に `sourceDumpId`（と任意で `sourceChunkId`）を保持する。

- `/journal` や詳細から「どの取り込み由来か」を辿れる
- 蒸留・評価の主材料は **採用後 Journal**。Dump 生文は直接蒸留しない（ノイズ・未レビューのため）

---

## 5. フロー

```text
[/journal 「観測を取り込む」]
  ① sourceType 選択（必須）＋ raw 貼り付け（＋任意 title / 日付範囲）
       ↓
  ② Dump 作成: raw をマスクして永続（status=received）。ここまで同期で完了してよい
       ↓
  ③ 非同期 parse: マスク済み本文のみを外部 AI へ。sourceType 別プロンプトで ChunkDraft[] 生成
       ↓ 失敗時
         - status=failed、またはフォールバック案「長文1チャンク（全文抜粋）」を draft に載せる
       ↓
  ④ status=draft_ready → プレビュー UI
       - 結合 / 分割し直し指示 / 捨て / 日付修正 / 本文の軽微編集（抜粋の範囲修正）
       ↓
  ⑤ 採用: disposition=accept のものだけ既存 Journal 作成経路へ
       - confirmed:false（現行 bulk と同じ。偽緊急の自動分析連鎖を避ける）
       - sourceDumpId を付与
       ↓
  ⑥ Dump status を partially_accepted または done
       ↓
  ⑦ 以降は既存: 校正 →（設定に応じ）自動分析 → Issue は明示起票のみ
```

朝キュー:

- Dump／ChunkDraft の全件は載せない
- 任意の将来拡張: 「未レビューの取り込み N 件」バナー → `/journal` の当該セクションへ（本スコープでは必須にしない）

---

## 6. AI 分割（マスク後・種別別）

### 6.1 送信ポリシー

1. 受信テキストに対し既存の名前候補確認（`ensureNameCandidatesAllowed`）を必要なら実施
2. `maskForStorage`（または同等）で PERSON_n 化
3. **そのマスク済み文字列だけ**をクラウド chat に渡す（OKR parse と同系統）
4. モデル出力のチャンク文もマスク済み前提で保存。表示前に unmask

ローカル小モデルでの長文分割は品質不足が見込まれるため、**本線は外部 AI（Settings の CLI 優先順）**。失敗時はヒューリスティック（段落／タイムスタンプ境界）または「1チャンク全文」へフォールバック。

### 6.2 出力スキーマ（案）

```json
{
  "chunks": [
    {
      "text": "原文からの抜粋（要約しない）",
      "occurredAtHint": "2026-09-10",
      "people": ["PERSON_1"],
      "tags": ["handoff"],
      "confidence": 0.8,
      "dropReason": null
    }
  ],
  "droppedNotes": ["雑談のみの区間 …"]
}
```

`sourceType` ごとに system 指示を差し替える（残す／捨てる表は §3）。

### 6.3 サイズ制限

- 1 Dump あたり提案チャンク上限（例: 30）。超過は「続きを生成」
- 極端に長い文字起こしは、マスク後に位置ベースで分割して再帰的に parse（実装詳細）
- 一度に Journal 化する件数も上限を置き、プレビューで選ばせる

---

## 7. UI（`/journal` のみ）

新セクション案（ページ上部または折りたたみ）:

1. **観測を取り込む**  
   - sourceType（チャットログ / MTGログ / その他）  
   - textarea、任意タイトル・日付範囲  
   - 「取り込む」（raw 保存＋ parse 開始）
2. **取り込み一覧**  
   - status、sourceType、作成日時、未処理チャンク数  
   - 行クリックでプレビュー
3. **プレビュー**  
   - チャンクカード: 抜粋本文、日付、confidence、accept / drop / 編集  
   - 「選択したものを Journal にする」  
   - 「再分割」／「Discard Dump」
4. 既存の Journal 一覧・検索はそのまま（採用分が通常エントリとして並ぶ）

Dashboard・今日タブへの導線は **本スコープ外**。

---

## 8. Issue／朝との境界（再掲）

| 段階 | 自動 | EM |
|---|---|---|
| Dump 受信・チャンク提案 | 可 | — |
| Journal 化 | 不可（明示採用） | プレビューで採用 |
| Journal 校正 | — | 既存 |
| 自動分析 → 候補 | 校正後・設定どおり | トリアージ |
| Issue 起票 | 不可 | 明示のみ（`issue_tracker_contract`） |

「高信頼一括採用」は任意の後続改善。初回は個別（または複数チェック）採用でよい。

---

## 9. 実装フェーズ（本決定に合わせた順序）

決定により、以前案の「MVP → +3」ではなく、**初回から sourceType 分岐と Dump エンティティを含む**。

| 順 | 内容 |
|---|---|
| 1 | `ObservationDump` / `ChunkDraft` 永続、マスク保存 |
| 2 | `sourceType` 別 parse（クラウド・マスク後のみ）、失敗フォールバック |
| 3 | `/journal` 取り込み UI ＋ プレビュー ＋ 採用 → Journal（`sourceDumpId`） |
| 4 | 巨大テキストの分割キュー、再分割、結合／捨て、トレース表示の磨き |
| 5 | （需要後）Dashboard 導線、未レビューバナー、高信頼一括採用 |
| 6 | （需要後）Slack export ファイル等の専用パーサ |

成功条件:

- sourceType を選んで貼るだけで Dump が残り、マスク済みで分割提案が来る
- 採用 Journal は原文抜粋で、通常の校正・検索・People に乗る
- 朝の「次の1手」件数がこの機能だけで増えない
- クラウド経路に実名が乗らない（既存 assert と整合）

---

## 10. 実装時の主なタッチポイント（目安）

- 新規: dump store（JSON または既存 persistence 流儀に合わせる）
- 新規: `parseObservationDump(sourceType, maskedText)`（`okr-parse.ts` 類似）
- API: dump CRUD / parse / accept-chunks
- UI: `web/src/app/journal/page.tsx` にセクション追加
- Journal 作成: 既存 `addJournalEntry` 系を再利用し `sourceDumpId` を拡張
- 自動分析: Dump／未採用チャンクからは呼ばない（採用 Journal の確認後のみ）

### 10.1 初回実装（2026-09-12）

| パス | 役割 |
|---|---|
| `web/src/lib/observation-dump-types.ts` | 共用型 |
| `web/src/lib/observation-dump-store.ts` | `observation-dumps.json` |
| `web/src/lib/observation-dump-parse.ts` | 種別別クラウド分割＋ヒューリスティック |
| `web/src/lib/observation-dump-actions.ts` | parse / accept |
| `web/src/app/api/journal/dumps/**` | API |
| `web/src/components/ObservationDumpSection.tsx` | `/journal` UI |
| KnowledgeEvent `source_dump_id` / `source_chunk_id` | Journal 弱いリンク |

未実装（メモ §9 の後半）: Dashboard 導線、専用ファイルパーサ。

実装済み（追記）: 巨大テキストの窓分割キュー、チャンク本文・日付のインライン編集、Journal カードからの取り込み元リンク（`/journal?dump=`）。
Slack JSONL（`ts` / `channel` / `sender` / `text` / `permalink` / `thread`）の自動検出・平文化（`observation-dump-normalize.ts`）。

---

## 11. 一言

**種別付きの Observation Dump をマスクして残し、種別別 AI が原文抜粋のチャンクを提案し、`/journal` で採用した分だけ通常 Journal になる。Issue 化と朝キューには載せない。**
