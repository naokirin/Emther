import { randomUUID } from "node:crypto";
import { loadJSON, saveJSON } from "@/lib/persistence";
import { maskForStorage, unmaskNames } from "@/lib/people-directory";

// docs/memo.md TODO「人間EM自体の成長に対する向き合いを作る。EM本人のバイタル、週次振り返りの
// 入力・改善方針機能を作る」対応。Team Vitals等、他者についての状態は「感覚」で埋めず観測
// （Journal集計）から機械的に算出する方針だが、これはEM自身が自分自身について申告する値
// であり、推測ではなく本人の自己申告そのものが根拠になるため、他のVitalsとは異なり
// 自己申告の数値をそのまま記録する（アルゴリズムによる良好/要注意判定は行わない）。
// 件数・更新頻度ともに単一ユーザーの手入力程度の規模のため、Issue/Team等と同じ
// loadJSON/saveJSON（データディレクトリ配下の`*.json`）で十分と判断し、SQLiteへは寄せない。

export type EmCheckin = {
  id: string;
  mood: number; // 1(悪い)〜5(良い)
  energy: number; // 1(低い)〜5(高い)
  stress: number; // 1(低い)〜5(高い)
  note: string;
  createdAt: number;
};

// 改修依頼「週次振り返りを『思いついたときに書き込み、レポートの週次で振り返る』
// 仕組みに」対応。以前はKeep/Problem/Tryを3つとも一度に書いて「週の振り返り」を
// 1件記録する形だった（＝週次でまとめて時間を取る前提）が、スキマ時間に1つずつ
// 気づきをメモしておき、週単位はあくまで「後から眺める集計軸」にする方が書く負担が
// 小さい。そのため「1回の投稿＝1件のKeep/Problem/Tryメモ」というイベント単位の
// モデルに変更し、週ごとのグルーピングは表示側（growth/page.tsx）で行う。
export type ReflectionNoteType = "keep" | "problem" | "try";

export type EmReflectionNote = {
  id: string;
  type: ReflectionNoteType;
  text: string;
  createdAt: number;
};

const checkins: EmCheckin[] = loadJSON<EmCheckin[]>("em-checkins.json", []);
const reflectionNotes: EmReflectionNote[] = loadJSON<EmReflectionNote[]>("em-reflection-notes.json", []);

function persistCheckins(): void {
  saveJSON("em-checkins.json", checkins);
}

function persistReflectionNotes(): void {
  saveJSON("em-reflection-notes.json", reflectionNotes);
}

function clampScale(v: number): number {
  return Math.min(5, Math.max(1, Math.round(v)));
}

// 個人情報の分離（ユーザー指摘対応）: 自由記述欄（note/keep/problem/tryNext）には
// メンバーの名前が書かれ得るため、他のストアと同じくmaskForStorageで保存し、
// EM向け表示の境界（toXxxView）で実名へ復元する。
export function toCheckinView(c: EmCheckin): EmCheckin {
  return { ...c, note: unmaskNames(c.note) };
}

export function toReflectionNoteView(n: EmReflectionNote): EmReflectionNote {
  return { ...n, text: unmaskNames(n.text) };
}

export function listCheckins(): EmCheckin[] {
  return [...checkins].sort((a, b) => b.createdAt - a.createdAt);
}

export async function addCheckin(input: { mood: number; energy: number; stress: number; note: string }): Promise<EmCheckin> {
  const checkin: EmCheckin = {
    id: randomUUID(),
    mood: clampScale(input.mood),
    energy: clampScale(input.energy),
    stress: clampScale(input.stress),
    note: input.note.trim() ? await maskForStorage(input.note.trim()) : "",
    createdAt: Date.now(),
  };
  checkins.push(checkin);
  persistCheckins();
  return checkin;
}

export function listReflectionNotes(): EmReflectionNote[] {
  return [...reflectionNotes].sort((a, b) => b.createdAt - a.createdAt);
}

export async function addReflectionNote(input: { type: ReflectionNoteType; text: string }): Promise<EmReflectionNote> {
  const note: EmReflectionNote = {
    id: randomUUID(),
    type: input.type,
    text: await maskForStorage(input.text.trim()),
    createdAt: Date.now(),
  };
  reflectionNotes.push(note);
  persistReflectionNotes();
  return note;
}
