/**
 * Kuromoji による人名 POS 抽出（敬称なし姓・名の候補用）。
 * 辞書ロードは初回のみ。未ロード時は空配列を返す。
 */
import { createRequire } from "node:module";
import path from "node:path";

type KuromojiToken = {
  surface_form: string;
  pos: string;
  pos_detail_1: string;
  pos_detail_2: string;
  pos_detail_3: string;
};

type KuromojiTokenizer = {
  tokenize: (text: string) => KuromojiToken[];
};

const require = createRequire(import.meta.url);

let tokenizer: KuromojiTokenizer | null = null;
let loading: Promise<void> | null = null;

function dicPath(): string {
  return path.join(path.dirname(require.resolve("kuromoji/package.json")), "dict");
}

/** 初回呼び出しで辞書をロード。失敗時は形態素なしで継続。 */
export function ensureNameMorphReady(): Promise<void> {
  if (tokenizer) return Promise.resolve();
  if (loading) return loading;

  loading = new Promise<void>((resolve) => {
    try {
      const kuromoji = require("kuromoji") as {
        builder: (opts: { dicPath: string }) => {
          build: (cb: (err: Error | null, t: KuromojiTokenizer) => void) => void;
        };
      };
      kuromoji.builder({ dicPath: dicPath() }).build((err, t) => {
        if (err || !t) {
          console.warn("[mask-check-morph] kuromoji load failed:", err);
          tokenizer = null;
        } else {
          tokenizer = t;
        }
        resolve();
      });
    } catch (e) {
      console.warn("[mask-check-morph] kuromoji unavailable:", e);
      tokenizer = null;
      resolve();
    }
  });
  return loading;
}

function isPersonPos(tok: KuromojiToken): boolean {
  return tok.pos === "名詞" && tok.pos_detail_1 === "固有名詞" && tok.pos_detail_2 === "人名";
}

const HONORIFICS = new Set(["さん", "くん", "ちゃん", "様", "氏"]);

/** 人名 POS でも採用しない語（役職・修飾など）。 */
const MORPH_PERSON_STOPWORDS = new Set([
  "シニア",
  "ジュニア",
  "マネージャー",
  "マネージャ",
  "リーダー",
  "メンバー",
  "エンジニア",
  "デザイナー",
  "ディレクター",
]);

/**
 * 形態素の人名（姓・名・一般）を抽出。姓＋名は結合。直後の敬称があれば付与。
 * メールローカル風の英小文字のみは除外。
 */
export function detectMorphPersonNames(text: string): string[] {
  if (!tokenizer) return [];
  const tokens = tokenizer.tokenize(text);
  const out: string[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (!isPersonPos(tok)) {
      i += 1;
      continue;
    }
    const parts = [tok.surface_form];
    let j = i + 1;
    while (j < tokens.length && isPersonPos(tokens[j])) {
      parts.push(tokens[j].surface_form);
      j += 1;
    }
    let surface = parts.join("");
    if (j < tokens.length && HONORIFICS.has(tokens[j].surface_form)) {
      surface += tokens[j].surface_form;
      j += 1;
    }
    i = j;
    if (surface.length < 2) continue;
    if (/^[a-z0-9._%+-]+$/.test(surface)) continue;
    if (MORPH_PERSON_STOPWORDS.has(surface)) continue;
    if (seen.has(surface)) continue;
    seen.add(surface);
    out.push(surface);
  }
  return out;
}

export function isNameMorphReady(): boolean {
  return tokenizer !== null;
}
