# Issue Tracker 契約（一般 Tracker 部分の状態機械）

作成日: 2026-09-09  
関連: `docs/em_human_story_and_ux.md` / `docs/em_ui_ux_issue.md` / `docs/memo.md`  
対象: プロダクト固有の「介入／AI」を除いた、Issue Tracker＋タスク管理としての骨格

---

## 1. 目的

Issue 周りが煩雑化した主因を、「Work item・Task・Inbox・Execution・終端語彙が混線していること」と定義し、一般的な Issue Tracker として読める契約に寄せる。

実装順の原則: **A Intake → B 終端語彙 → C 分解モデル**（依存はこの順）。

---

## 2. Intake → Issue（A）

| 状態 | 実体 | Issue か | 置き場 |
|---|---|---|---|
| `candidate` | 相談・自動検知・手動壁打ちの Run | いいえ | `/chat`・朝キューの判断待ち |
| `watching` | 様子見（`triageAt` 起点の再浮上あり） | いいえ | ウォッチリスト／期限切れで判断待ちへ |
| `dismissed` | 却下 | いいえ | 履歴のみ（朝キューに出さない） |
| `tracked` | 明示的に Issue 化したもの | **はい** | `/issues` |

### 操作ルール

- Inbox／手動 Lead Run の既定クリック先は **相談（`/chat`）**
- Issue 化は明示アクション（「Issue にする」）のみ。ドラフトを薄い Issue にしない
- 専門エージェントや既に紐付いた Run は Issue Workspace へ（決まった介入の作業面）
- `watching` は `reviewed=true` で緊急度から外すが、一定期間後に判断待ちへ再浮上する
- 1つの相談／Journal 分析が **別介入**（別責任・別チーム・別 KR・別 Why）を含む場合、AI は `issueCandidates` で親なしの複数候補を出してよい。EM がチェックで起票する件を選ぶ（自動一括起票しない）。Journal の `resolvedIssueId` は単数のまま（先頭に起票した1件へ紐付け）
- 同じ介入の具体化は Intake では切らず、tracked 後の子 Issue（`sub_issues`）／Action Item の役割

---

## 3. 終端語彙（B）— `done` と `archived` は別概念

| 概念 | 意味 | 一覧・朝キュー | KR・親プログレス | 介入効果 |
|---|---|---|---|---|
| `status=done` | **解決した**（Issue が目的を果たした） | 非アクティブ | **達成として数える** | 起点は `doneAt`（案α） |
| `archived=true` | **完了する必要がなくなった**（取りやめ・前提消滅・追わない） | 既定では非表示 | **分母・分子から除外** | 使わない |
| Run `triageStatus` | Intake 専用 | Issue の終端に使わない | — | — |

```text
active = !archived && status != done
```

### 禁止（以前の実装との差分）

- アーカイブ時に `status` を `done` へ自動変更しない
- アーカイブ解除時に `status` を書き換えない
- KR 進捗を `archived` 件数で算出しない

### フィールド

- `doneAt`: `status` が `done` になった時刻。`done` 以外では未定義
- `archivedAt`: アーカイブした時刻（一覧退避・監査用。効果測定には使わない）

### マイグレーション

- 読み込み時、`status === "done"` かつ `doneAt` 欠落なら `archivedAt ?? updatedAt` を `doneAt` に補完（旧「アーカイブ＝閉じる」で効果窓が消えないようにする）
- 既存の `archived && status === "done"` はそのまま残す（自動では切り離さない）

---

## 4. 進捗（B／C）

```text
KR進捗     = (status=done の紐付きIssue数) / (!archived の紐付きIssue数)
親プログレス = (親 Action の done数 + 子のうち status=done の数)
             / (親 Action 総数 + 子のうち !archived の数)
suggested* = プログレス・朝キューの「仕事」に数えない（採用前は案）
```

---

## 5. 分解モデル（C）

| もの | 役割 | やらないこと |
|---|---|---|
| Action Item | この Issue の実行チェックリスト。「次の一手」＝未完了の先頭1件 | 別責任範囲の課題にしない |
| 子 Issue | 独自 Why/What/How・status・Run を持ちうる別介入。親プログレスに参加 | 単なる ToDo の置き場にしない |
| suggestedActionItems / suggestedSubIssues | HITL 採用前の案 | 採用前に進捗へ含めない |
| Intake の `issueCandidates` | 相談／Journal 時点で親なしの独立 Issue 候補（別介入の並列） | 同じ介入の分解に使わない（それは子 Issue） |

判断の目安（UI／プロンプト共有）: 「この介入の次の一手か？」→ Action Item。「すでに tracked な介入を具体化するか？」→ 子 Issue。「最初から別介入か？」→ Intake の `issueCandidates`（親なし）。

---

## 6. 介入効果（案α）

- チーム紐付き Issue のみ算出
- **完了後:** `status=done` かつ `doneAt` あり → 介入開始前窓 vs `doneAt` 以降の窓（`inProgress: false`）
- **進行中:** 上記以外 → 介入開始前窓 vs 作成〜現在（`inProgress: true`）
- アーカイブだけでは完了扱いの効果窓に入らない

---

## 7. priority（ポートフォリオ帯）との関係

`focus` / `normal` / `parked` は status と独立した「今週〜今月の見通し」軸。  
「今やる」は focus、「進行」は status、「解決／追わない」は done／archived。語彙を混ぜない。

内部根拠として `triage`（CoD / Effort / BlastRadius / Confidence → score → suggestedPriority）を持てる。UI 主面は帯のまま。EM はマトリクス入力ではなく例外上書きだけ行う（`docs/value_hierarchy_and_flow.md` §4）。

---

## 8. 階層リンク（EM 介入線）

- `OrgTheme.objectiveIds` / `keyResultIds`: 採用テーマと OKR の明示リンク（実行時の焦点正本は採用済みテーマ）
- `Issue.themeId` / `Issue.keyResultId`: どちらも任意。未接続は警告のみ（必須にしない）
- メンバー貢献評価の主経路にはしない（Journal → 評価ログ A/B。`docs/value_hierarchy_and_flow.md` §5）
