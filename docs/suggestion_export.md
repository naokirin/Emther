# 提案の外部エクスポート（Issue 管理ツールへの受け渡し）

関連: [`philosophy.md`](philosophy.md) §5.1（Issue を中心概念にしない）

## 1. 目的

Emther は Suggestion（提案）までとし、実際の Issue / タスク管理は Notion・Linear・GitHub・Sheets 等に委ねる。  
妥当と判断した提案を外部へ移す摩擦を下げ、**Emther 内で進捗管理を増やさない**出口を用意する。

成功条件は「Suggestion 管理時間の削減」ではなく、**Decide → Intervene の受け渡しコスト削減**である。

## 2. 対象ツール（優先）

| 優先 | ツール | 主な受け口 |
| --- | --- | --- |
| 高 | Notion | ページ本文（Markdown）／既存 DB（表） |
| 高 | Linear / GitHub Issues | Issue 本文（Markdown） |
| 高 | Excel / Google Sheets | 表（TSV / CSV） |
| 後回し | Jira | 組織依存の必須列が多い |

MCP / API による直接作成は将来（一方向・明示操作のみ）。双方向同期は持たない。

## 3. 運用パターン

日次は 1 件ずつ、週次・テーマ単位・focus・任意選択では複数件をまとめて渡す（混在 = パターン C）。

## 4. フェーズ

| Phase | 内容 | 状態 |
| --- | --- | --- |
| A | 1 件 Markdown コピー（詳細パネル） | 実装済み |
| B | 選択範囲の表コピー。列の表示オン／オフと並び替え（β） | 実装済み |
| C | 同範囲の `.md` / `.csv` ファイルダウンロード | 実装済み |
| D | MCP 等で外部へ 1 件 create（一方向） | 後回し |

### β（列設定）の意味

- Emther 内部フィールドは固定（title / conclusion / theme 等）
- ユーザーは **どの列を出すか** と **列順** だけ指定できる
- 列名のリネームや外部 DB プロパティへの本格マッピング（γ）は後続
- 設定は端末の `localStorage` に保存（サーバー設定は増やさない）

既存 Notion DB への貼り付けは、列順が相手スキーマと一致している必要がある。βはその最低ラインを Emther 側で満たすためのもの。

## 5. 人名（実名）

API 経由の Suggestion 表示は既に実名（`unmaskNames` 後）である。  
エクスポートも **実名のまま** を既定とする（社内 Tracker へ渡す用途）。  
マスク維持の切替は需要が出てからでよい。

## 6. 出力仕様

### 6.1 1 件 Markdown（Phase A）

```markdown
# {title}

## 結論
{conclusion}

## 根拠
- {facts…}

## 判断ロジック
{logic}

## 視点の広がり（Expand）
- …

## 前提への問い（Challenge）
- …

## 進め方のアドバイス
{advice}

## メモ
- {memos…}

---
Theme: {themeTitle}
Team: {teamName}
Confirm: {confirmPriorityLabel} / {reviewStatusLabel}
Emther ID: {id}
Emther URL: {origin}/suggestions/{id}

## 参照: AI出力（判断・提案（Agent） | 元の相談）
> 提案の詳細は後から編集されている場合があります。以下は紐づく Agent Run 側の出力です。

### 判断・提案
（proposal の結論・根拠・判断ロジック・Expand/Challenge・アドバイス・棄却案）

### 壁打ち
（EM / Agent の対話。構造化ブロックは除く）
```

欠落セクションは省略する。AI 参照は紐づく Agent Run（専用 Run が無ければ元の相談）があるときだけ末尾に付ける。
URL の origin はブラウザの `location.origin`（例: `http://127.0.0.1:3000`）。

### 6.2 表（Phase B）

- 形式: **TSV**（Sheets / Excel / 多くの表貼り付け）と **Markdown 表**
- 行の対象: チェック選択。未選択時は「いまのフィルタ結果」全体
- 利用可能な列（初期セット）:

| id | ヘッダー（日本語） |
| --- | --- |
| `title` | タイトル |
| `conclusion` | 結論 |
| `facts` | 根拠 |
| `logic` | 判断ロジック |
| `advice` | 進め方のアドバイス |
| `memos` | メモ |
| `theme` | テーマ |
| `team` | チーム |
| `confirmPriority` | 確認優先度 |
| `reviewStatus` | 確認状態 |
| `reviewDueAt` | 確認期日 |
| `id` | Emther ID |
| `url` | Emther URL |
| `aiConclusion` | AI結論 |
| `aiFacts` | AI根拠 |
| `aiLogic` | AI判断ロジック |
| `aiAdvice` | AI進め方のアドバイス |
| `aiChat` | AI壁打ち |

既定の有効列と順: `title`, `conclusion`, `theme`, `confirmPriority`, `id`

AI* 列は紐づく Agent Run（専用 Run が無ければ元の相談）の proposal／壁打ちログから埋める。無い場合は空欄。
セル内の改行・タブは TSV 用に空白へ正規化する。複数項目（根拠・メモ等）は ` / ` 区切り。

### 6.3 ファイル出力（Phase C）

コピーと同じ選択範囲（チェック／未選択時はフィルタ結果）を対象にする。

| 形式 | 内容 | 用途 |
| --- | --- | --- |
| `.csv` | 列設定どおりの CSV（UTF-8 BOM・CRLF） | Excel / Sheets / Notion DB インポート |
| `.md` | 各提案を Phase A 形式で連結（`---` 区切り、AI 参照含む） | Notion ページ・文書としての取り込み |

ファイル名例: `emther-suggestions-YYYYMMDD-HHmmss.csv` / `.md`  
提案詳細からは 1 件の `.md`（`emther-suggestion-{id先頭8桁}.md`）も保存できる。

## 7. やらないこと

- Emther 上の「エクスポート済み」必須フラグや外部ステータス同期
- Issue Tracker 機能の再発明（担当・進捗・サブタスク管理）
- 依頼なしの自動エクスポート

## 8. UI 配置

- **A**: 提案詳細に「Markdown をコピー」「Markdown を保存」
- **B**: 提案一覧に行チェック・列設定・「表をコピー（TSV / Markdown）」
- **C**: 提案一覧に「CSV を保存」「Markdown を保存」

整形ロジックは `@emther/core`（`suggestion-export`）に置き、UI はクリップボード／ダウンロードのみ担う。
