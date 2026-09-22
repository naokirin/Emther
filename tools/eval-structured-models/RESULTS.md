# Phase1 / Phase2 軽量検証結果

実行日: 2026-09-22  
ハーネス: `tools/eval-structured-models/`  
フィクスチャ: 匿名の EM ドメイン寄り日本語（pairs 24 / search 6×14 / urgency・recommendation・themeLink 各 24）

## 判定サマリー

| 項目 | 判定 | 根拠 |
|------|------|------|
| **Phase1 rerank** (`japanese-reranker-tiny-v2`) | **GO（弱い〜本番検討可）** | 検索 MRR 改善、紐づけスコアが強い。本フィクスチャでは Recall@5 は既に天井 |
| **Phase2 ゼロショット urgency** | **NO-GO** | Acc ≈ 0.25–0.46（ランダム近い〜弱い） |
| **Phase2 ゼロショット recommendation** | **NO-GO** | Acc ≈ 0.29–0.33 |
| **Phase2 ゼロショット themeLink** | **NO-GO** | 常に `link` 寄り（Acc 0.5） |
| **テーマ紐づけ（cosine / rerank スコア）** | **GO** | Acc 0.83 / **0.92**、link Precision 0.83 / **0.86** |

結論: **自動紐づけ・関連順位は Phase1 系（既存 MiniLM + tiny rerank）で進める。固定ラベル判断（urgency / recommendation）に mDeBERTa ゼロショットは使わない。** 後者は SetFit やルール／既存ローカル LLM を別途検討。

---

## Phase1 詳細

モデル: `hotchpotch/japanese-reranker-tiny-v2`（Transformers.js / q8 でロード成功）  
ベースライン: 既存 `paraphrase-multilingual-MiniLM-L12-v2` cosine

| 指標 | cosine | tiny rerank |
|------|--------|-------------|
| ペア best Accuracy | 0.958 | 0.958 |
| ペア related−unrelated gap | 0.311 | 3.37（生 logit、スケール別） |
| 閾値 0.4 Accuracy（cosine のみ） | 0.792 | — |
| 検索 Recall@5 | **1.00** | **1.00** |
| 検索 MRR | 0.889 | **1.000**（Δ+0.111） |
| top-5 Jaccard（同士） | — | 0.37（順位は実質変化） |
| ペア Spearman(cosine, rerank) | — | 0.733 |
| レイテンシ目安 | pairs 〜0.3s / search 〜0.1s | pairs 〜0.07s / search 〜0.3s（候補再スコア） |

特記:

- 本フィクスチャは related/unrelated の差がはっきりしており、**cosine だけでも Recall 天井**。rerank の価値は **順位（MRR）と top の入れ替え**に出た（例: q05 で正解が 3位→1位）。
- 本番の関連束・link-suggest はノイズが多く Recall 天井になりにくい想定。次は実データ匿名サンプルで再測が望ましい。
- 現行閾値 0.4 はペア Acc 0.79。最適閾値は約 0.22（このセット上）。rerank 導入時は **cosine は recall 用に緩め、rerank 後に切る**二段が自然。

---

## Phase2 詳細

モデル: `Xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7`（q8）

### ゼロショット分類

| タスク | 仮説言語 | Accuracy | メモ |
|--------|----------|----------|------|
| urgency (`high/mid/low`) | ja / en | 0.25–0.46 | ドメイン語彙に弱い |
| recommendation (`suggestion/watch/dismiss`) | ja / en | ≈0.29–0.33 | ほぼチャンスレベル |
| themeLink (`link/no_link`) | ja / en | 0.50 | `no_link` をほぼ出せない |

### ペアスコアによるテーマ紐づけ（こちらが本命）

| 手法 | Accuracy | link Precision | link Recall |
|------|----------|----------------|-------------|
| cosine | 0.833 | 0.833 | 0.833 |
| tiny rerank | **0.917** | **0.857** | **1.000** |

→ **テーマ紐づけ判断はゼロショットではなく Phase1 と同じスコアリングでよい。**

---

## 推奨ネクストステップ

1. ~~**製品組み込み候補**: `related-context` / `link-suggest` heuristic に MiniLM top-K → japanese-reranker-tiny-v2 を opt-in~~ → **実装済み**（設定「ローカル再ランキング」、`localRerankEnabled`、既定 OFF）
2. **閾値**: フィクスチャ最適値をそのまま使わず、実データで再キャリブレーション。
3. **urgency / recommendation**: ゼロショットは見送り。必要なら少数ラベル SetFit、または現行ローカル LLM 抽出のまま。
4. **評価拡張**: 実 Journal/テーマの匿名 50 件程度で Phase1 を再実行（Recall 天井を避ける）。

### 製品 opt-in（実装メモ）

- 設定: `RulesAndConstraints.localRerankEnabled`（UI: 設定 → ローカルAI）
- 効果: 関連束・人物ファクト並び・lookup similar・紐づけ heuristic の候補順
- 非効果: urgency / recommendation 自動判定、Vitals、HITL 採用フロー
- 失敗時: cosine / overlap にフォールバック（黙って劣化）

---

## 再実行

```bash
# 引数は npm に吸われないよう `--` の後に書く
npm exec tsx -- tools/eval-structured-models/run.mts
npm exec tsx -- tools/eval-structured-models/run.mts --phase2-en
npm exec tsx -- tools/eval-structured-models/run.mts --with-bge
```

生レポートは `tools/eval-structured-models/out/report-*.json`（gitignore）。
