# Structured-model lightweight eval (Phase1 / Phase2)

製品コードに接続しないオフライン検証。詳細方針は会話メモ / `docs/knowledge_distillation.md` §6.1 と同型。

## 実行

リポジトリルートから（**引数は `tsx --` の後ろ**）:

```bash
# Phase1 (cosine + japanese tiny rerank) + Phase2 (mDeBERTa)
npm exec tsx -- scripts/eval-structured-models/run.mts

# rerank を試さず cosine / Phase2 のみ
npm exec tsx -- scripts/eval-structured-models/run.mts --skip-rerank

# Phase1 をスキップ
npm exec tsx -- scripts/eval-structured-models/run.mts --skip-phase1

# Phase2 仮説を英語テンプレに
npm exec tsx -- scripts/eval-structured-models/run.mts --phase2-en

# tiny に加えて bge-reranker-v2-m3 ONNX も比較
npm exec tsx -- scripts/eval-structured-models/run.mts --with-bge

# Phase2 をスキップ
npm exec tsx -- scripts/eval-structured-models/run.mts --skip-phase2
```

初回はモデルダウンロードが発生します（XDG キャッシュ: `~/.cache/emther/transformers` 等）。

計測結果の解釈は [`RESULTS.md`](./RESULTS.md) を参照。

## 成果物

- `fixtures.json` … 匿名の EM ドメイン寄りサンプル
- `out/report-*.json` … 計測結果（gitignore 推奨）

## Go 基準（スクリプト末尾でも表示）

- Phase1: Recall@5 が cosine より改善（目安 +0.1）またはペア分離が明確に改善
- Phase2 urgency: Accuracy ≳ 0.7
- Phase2 recommendation: Accuracy ≳ 0.65
- Phase2 themeLink: `link` Precision ≳ 0.8 かつ Accuracy ≳ 0.7
