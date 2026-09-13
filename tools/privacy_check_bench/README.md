# privacy_check_bench

ローカルで人名・機微検知を同じフィクスチャ／評価サンプルで比較する。

## セットアップ（初回・Python 側）

```bash
# Python 3.12 推奨（3.14 では spaCy/GiNZA 未対応のことが多い）
MISE_PYTHON_GITHUB_ATTESTATIONS=false mise install python@3.12.8
mise exec python@3.12.8 -- python -m venv tools/privacy_check_bench/.venv
tools/privacy_check_bench/.venv/bin/pip install 'ginza>=5.2' 'ja-ginza>=5.2'
```

`.venv` と `out_*.json` は gitignore。

## 実行

```bash
# GiNZA 単体
tools/privacy_check_bench/.venv/bin/python tools/privacy_check_bench/run_ginza.py

# Emther（web の mask-check）
cd web && npx tsx ../tools/privacy_check_bench/run_emther.mts

# CORE vs TUNING キーワード
cd web && npx tsx ../tools/privacy_check_bench/run_core_vs_tuning.mts

# 人名エンジン比較（敬称ルール / Sudachi POS / GiNZA / 併用）
cd web && npx tsx ../tools/privacy_check_bench/emit_emther_names.mts
tools/privacy_check_bench/.venv/bin/python tools/privacy_check_bench/compare_name_detectors.py

# security_check_samples.md の機微評価
cd web && npx tsx ../tools/privacy_check_bench/eval_security_samples.mts
```

解釈は `docs/privacy_check_research.md` §5–8。
