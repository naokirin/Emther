#!/usr/bin/env python3
"""GiNZA Person NER vs gold names for privacy_check fixtures."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import spacy

ROOT = Path(__file__).resolve().parent
FIXTURES = ROOT / "fixtures"
HONORIFIC_RE = re.compile(r"(さん|くん|ちゃん|様|氏)$")


def normalize(name: str) -> str:
    n = name.strip()
    n = HONORIFIC_RE.sub("", n)
    return n


def collapse_subset(names: list[str]) -> list[str]:
    """Prefer longer forms when one normalized name contains another."""
    norms = [(n, normalize(n)) for n in names]
    kept: list[str] = []
    for n, nn in sorted(norms, key=lambda x: len(x[1]), reverse=True):
        if any(nn and kn.startswith(nn) or nn and nn.startswith(kn) for _, kn in [(None, normalize(k)) for k in kept] if kn):
            # keep if not a strict subset of an already kept longer form
            if any(kn.startswith(nn) and kn != nn for k in kept for kn in [normalize(k)]):
                continue
        if any(normalize(k) == nn for k in kept):
            continue
        kept.append(n)
    # simpler: drop if bare is prefix/equal of longer kept
    out: list[str] = []
    for n in sorted(names, key=lambda s: len(normalize(s)), reverse=True):
        nn = normalize(n)
        if any(normalize(k).startswith(nn) and normalize(k) != nn for k in out):
            continue
        if any(normalize(k) == nn for k in out):
            continue
        out.append(n)
    return out


def score(pred: list[str], gold: list[str]) -> dict:
    pred_n = {normalize(p) for p in pred if normalize(p)}
    gold_n = {normalize(g) for g in gold if normalize(g)}
    tp = pred_n & gold_n
    fp = pred_n - gold_n
    fn = gold_n - pred_n
    precision = len(tp) / len(pred_n) if pred_n else 0.0
    recall = len(tp) / len(gold_n) if gold_n else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    return {
        "precision": round(precision, 3),
        "recall": round(recall, 3),
        "f1": round(f1, 3),
        "tp": sorted(tp),
        "fp": sorted(fp),
        "fn": sorted(fn),
        "pred_raw": pred,
    }


def ginza_persons(nlp, text: str) -> list[str]:
    doc = nlp(text)
    raw = [ent.text for ent in doc.ents if ent.label_ == "Person"]
    # also try PERSON if model uses that
    raw += [ent.text for ent in doc.ents if ent.label_ == "PERSON"]
    # unique preserve order
    seen: set[str] = set()
    out: list[str] = []
    for r in raw:
        if r in seen:
            continue
        seen.add(r)
        out.append(r)
    return collapse_subset(out)


def main() -> int:
    gold = json.loads((FIXTURES / "gold.json").read_text(encoding="utf-8"))
    print("Loading ja_ginza...", file=sys.stderr)
    nlp = spacy.load("ja_ginza")
    results = {"engine": "ginza/ja_ginza", "samples": {}}
    for key, meta in gold["samples"].items():
        text = (FIXTURES / meta["file"]).read_text(encoding="utf-8")
        pred = ginza_persons(nlp, text)
        # dump all entity labels for inspection
        doc = nlp(text)
        ents = [(e.text, e.label_) for e in doc.ents]
        s = score(pred, meta["gold_names"])
        s["all_ents"] = ents
        results["samples"][key] = s
        print(f"\n== {key} ==")
        print(f"pred: {pred}")
        print(f"P/R/F1: {s['precision']}/{s['recall']}/{s['f1']}")
        print(f"FP: {s['fp']}  FN: {s['fn']}")
        print(f"ents: {ents}")
    out_path = ROOT / "out_ginza.json"
    out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
