# privacy_check_bench

ローカルで GiNZA（`ja_ginza`）と Emther ルール人名検出を、同じフィクスチャで比較する。

## セットアップ（初回）

```bash
# Python 3.12 推奨（3.14 では spaCy/GiNZA 未対応のことが多い）
MISE_PYTHON_GITHUB_ATTESTATIONS=false mise install python@3.12.8
mise exec python@3.12.8 -- python -m venv tools/privacy_check_bench/.venv
tools/privacy_check_bench/.venv/bin/pip install 'ginza>=5.2' 'ja-ginza>=5.2'
```

`.venv` は gitignore 想定（コミットしない）。

## 実行

```bash
# GiNZA
tools/privacy_check_bench/.venv/bin/python tools/privacy_check_bench/run_ginza.py

# Emther（web の mask-check）
cd web && npx tsx ../tools/privacy_check_bench/run_emther.mts

# CORE vs TUNING キーワード（同一フィクスチャ）
cd web && npx tsx ../tools/privacy_check_bench/run_core_vs_tuning.mts
```

結果: `out_ginza.json` / `out_emther.json` / `out_core_vs_tuning.json`（gitignore）。
ゴールド: `fixtures/gold.json`。
解釈は `docs/privacy_check_research.md` §5–7。
