#!/usr/bin/env python3
"""
人名検出の比較: Emtherルール / Sudachi人名POS / GiNZA Person / 併用

使い方:
  tools/privacy_check_bench/.venv/bin/python tools/privacy_check_bench/compare_name_detectors.py

Emther 側は先に out_emther_names.json を生成しておくか、
同ディレクトリの emit_emther_names.mts を実行する。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
FIXTURES = ROOT / "fixtures"
SAMPLES_MD = REPO / "docs" / "security_check" / "security_check_samples.md"
OUT = ROOT / "out_name_detector_compare.json"

HONORIFIC_RE = re.compile(r"(さん|くん|ちゃん|様|氏)$")


def normalize(name: str) -> str:
    return HONORIFIC_RE.sub("", name.strip())


def score(pred: list[str], gold: list[str]) -> dict:
    pred_n = {normalize(p) for p in pred if normalize(p)}
    gold_n = {normalize(g) for g in gold if normalize(g)}
    tp = sorted(pred_n & gold_n)
    fp = sorted(pred_n - gold_n)
    fn = sorted(gold_n - pred_n)
    p = len(tp) / len(pred_n) if pred_n else 0.0
    r = len(tp) / len(gold_n) if gold_n else 0.0
    f1 = (2 * p * r / (p + r)) if (p + r) else 0.0
    return {
        "precision": round(p, 3),
        "recall": round(r, 3),
        "f1": round(f1, 3),
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "pred_raw": pred,
    }


def extract_blockquote_texts(md: str) -> list[str]:
    blocks: list[str] = []
    cur: list[str] = []
    for line in md.splitlines():
        if line.startswith(">"):
            cur.append(re.sub(r"^>\s?", "", line))
        elif cur:
            blocks.append("\n".join(cur).strip())
            cur = []
    if cur:
        blocks.append("\n".join(cur).strip())
    return blocks


# ゴールドは「検知されるべき個人名」（敬称あり優先。セット7は裸姓も含む）
GOLD: dict[str, dict] = {
    "sec1": {
        "title": "セット1 個人名・連絡先",
        "gold": ["田中さん", "佐藤さん", "山本一郎さん", "鈴木さん"],
    },
    "sec2": {
        "title": "セット2 個人情報＋顧客",
        "gold": ["高橋美咲さん"],
    },
    "sec3": {
        "title": "セット3 認証",
        "gold": ["山田さん"],
    },
    "sec5": {
        "title": "セット5 個人情報大量",
        "gold": ["伊藤健一さん", "森彩さん"],
    },
    "sec7": {
        "title": "セット7 人名誤検知（裸姓含む）",
        "gold": ["田中さん", "佐藤さん", "山田さん", "鈴木さん", "山本", "伊藤", "渡辺"],
    },
    "sec9": {
        "title": "セット9 人事",
        "gold": ["高橋直樹さん"],
    },
    "sec10": {
        "title": "セット10 混在",
        "gold": ["田中さん", "佐々木花子さん"],
    },
    "incident_mtg": {
        "title": "fixture incident_mtg",
        "file": "incident_mtg.txt",
        "gold": ["高井さん", "大岩さん", "東郷さん", "ただとしさん", "田中さん", "友瀬さん", "トニーさん", "佐伯さん"],
    },
    "release_standup": {
        "title": "fixture release_standup",
        "file": "release_standup.txt",
        "gold": ["田中さん", "山田太郎さん", "佐藤さん", "鈴木さん", "高橋さん", "中村一郎さん"],
    },
}


def sudachi_person_names(text: str) -> list[str]:
    from sudachipy import Dictionary, tokenizer

    tok = Dictionary().create()
    mode = tokenizer.Tokenizer.SplitMode.C
    out: list[str] = []
    seen: set[str] = set()
    morphs = list(tok.tokenize(text, mode))
    i = 0
    while i < len(morphs):
        m = morphs[i]
        pos = m.part_of_speech()
        # ('名詞', '固有名詞', '人名', '姓'|'名'|'一般', ...)
        if len(pos) >= 4 and pos[0] == "名詞" and pos[1] == "固有名詞" and pos[2] == "人名":
            parts = [m.surface()]
            j = i + 1
            # 姓＋名の連続を結合
            while j < len(morphs):
                nj = morphs[j]
                pj = nj.part_of_speech()
                if len(pj) >= 4 and pj[0] == "名詞" and pj[1] == "固有名詞" and pj[2] == "人名":
                    parts.append(nj.surface())
                    j += 1
                    continue
                break
            # 直後の敬称接尾を付けてもよい（評価は正規化で吸収）
            surface = "".join(parts)
            if j < len(morphs) and morphs[j].surface() in ("さん", "くん", "ちゃん", "様", "氏"):
                surface_h = surface + morphs[j].surface()
                if surface_h not in seen:
                    seen.add(surface_h)
                    out.append(surface_h)
                i = j + 1
                continue
            if surface not in seen and len(surface) >= 2:
                seen.add(surface)
                out.append(surface)
            i = j
            continue
        i += 1
    return out


def ginza_person_names(nlp, text: str) -> list[str]:
    doc = nlp(text)
    out: list[str] = []
    seen: set[str] = set()
    for ent in doc.ents:
        if ent.label_ in ("Person", "PERSON"):
            t = ent.text.strip()
            if t and t not in seen:
                seen.add(t)
                out.append(t)
    return out


def merge_unique(*lists: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for lst in lists:
        for x in lst:
            n = normalize(x)
            # 同一正規化は長い表記（敬称あり）を優先
            existing = next((o for o in out if normalize(o) == n), None)
            if existing:
                if len(x) > len(existing):
                    out[out.index(existing)] = x
                continue
            if n in seen:
                continue
            seen.add(n)
            out.append(x)
    # 短い方が長い方に含まれるなら長い方だけ
    kept: list[str] = []
    for a in sorted(out, key=lambda s: len(normalize(s)), reverse=True):
        na = normalize(a)
        if any(normalize(b).startswith(na) and normalize(b) != na for b in kept):
            continue
        kept.append(a)
    return kept


def load_texts() -> dict[str, str]:
    texts: dict[str, str] = {}
    md = SAMPLES_MD.read_text(encoding="utf-8")
    blocks = extract_blockquote_texts(md)
    # セット番号とブロック対応（1-indexed block for each set that has text）
    # 10 sets in order
    sec_keys = ["sec1", "sec2", "sec3", "sec4", "sec5", "sec6", "sec7", "sec8", "sec9", "sec10"]
    for i, key in enumerate(sec_keys):
        if i < len(blocks) and key in GOLD:
            texts[key] = blocks[i]
        elif i < len(blocks):
            texts[key] = blocks[i]
    for key, meta in GOLD.items():
        if "file" in meta:
            texts[key] = (FIXTURES / meta["file"]).read_text(encoding="utf-8")
    return texts


def main() -> int:
    texts = load_texts()
    emther_path = ROOT / "out_emther_names.json"
    emther_map: dict[str, list[str]] = {}
    if emther_path.exists():
        emther_map = json.loads(emther_path.read_text(encoding="utf-8"))
    else:
        print("WARN: out_emther_names.json なし。emther 列は空になります。", file=sys.stderr)

    print("Loading ja_ginza...", file=sys.stderr)
    import spacy

    nlp = spacy.load("ja_ginza")

    engines = ["emther_rules", "sudachi_pos", "ginza_ner", "rules+sudachi", "all_three"]
    results: dict = {"engines": engines, "samples": {}}

    for key, meta in GOLD.items():
        text = texts.get(key)
        if not text:
            continue
        gold = meta["gold"]
        emther = emther_map.get(key, [])
        sudachi = sudachi_person_names(text)
        ginza = ginza_person_names(nlp, text)
        combo_rs = merge_unique(emther, sudachi)
        combo_all = merge_unique(emther, sudachi, ginza)

        sample_result = {
            "title": meta["title"],
            "gold": gold,
            "emther_rules": score(emther, gold),
            "sudachi_pos": score(sudachi, gold),
            "ginza_ner": score(ginza, gold),
            "rules+sudachi": score(combo_rs, gold),
            "all_three": score(combo_all, gold),
        }
        results["samples"][key] = sample_result

        print(f"\n== {key}: {meta['title']} ==")
        print(f"gold: {gold}")
        for eng in engines:
            s = sample_result[eng]
            print(
                f"  {eng:16s} P={s['precision']:.2f} R={s['recall']:.2f} F1={s['f1']:.2f}  "
                f"FP={s['fp']} FN={s['fn']} pred={s['pred_raw']}"
            )

    # micro average over samples with gold
    print("\n=== micro-average (normalize) ===")
    summary = {}
    for eng in engines:
        tps = fps = fns = 0
        for s in results["samples"].values():
            sc = s[eng]
            tps += len(sc["tp"])
            fps += len(sc["fp"])
            fns += len(sc["fn"])
        p = tps / (tps + fps) if (tps + fps) else 0
        r = tps / (tps + fns) if (tps + fns) else 0
        f1 = 2 * p * r / (p + r) if (p + r) else 0
        summary[eng] = {
            "precision": round(p, 3),
            "recall": round(r, 3),
            "f1": round(f1, 3),
            "tp": tps,
            "fp": fps,
            "fn": fns,
        }
        print(f"  {eng:16s} P={p:.3f} R={r:.3f} F1={f1:.3f}  (tp={tps} fp={fps} fn={fns})")

    results["micro"] = summary
    OUT.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote {OUT}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
