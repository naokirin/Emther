import { randomUUID } from "node:crypto";
import { loadJSON, saveJSON } from "@/lib/persistence";
import { maskForStorage, unmaskNames } from "@/lib/people-directory";

// docs/memo.md TODO「人間EM自体の成長に対する向き合いを作る。EM本人のバイタル、週次振り返りの
// 入力・改善方針機能を作る」対応。Team Vitals等、他者についての状態は「感覚」で埋めず観測
// （Journal集計）から機械的に算出する方針だが、これはEM自身が自分自身について申告する値
// であり、推測ではなく本人の自己申告そのものが根拠になるため、他のVitalsとは異なり
// 自己申告の数値をそのまま記録する（アルゴリズムによる良好/要注意判定は行わない）。
// 件数・更新頻度ともに単一ユーザーの手入力程度の規模のため、Issue/Team等と同じ
// loadJSON/saveJSON（`.data/*.json`）で十分と判断し、SQLiteへは寄せない。

export type EmCheckin = {
  id: string;
  mood: number; // 1(悪い)〜5(良い)
  energy: number; // 1(低い)〜5(高い)
  stress: number; // 1(低い)〜5(高い)
  note: string;
  createdAt: number;
};

export type EmReflection = {
  id: string;
  periodStart: number;
  periodEnd: number;
  keep: string;
  problem: string;
  tryNext: string;
  createdAt: number;
};

const checkins: EmCheckin[] = loadJSON<EmCheckin[]>("em-checkins.json", []);
const reflections: EmReflection[] = loadJSON<EmReflection[]>("em-reflections.json", []);

function persistCheckins(): void {
  saveJSON("em-checkins.json", checkins);
}

function persistReflections(): void {
  saveJSON("em-reflections.json", reflections);
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

export function toReflectionView(r: EmReflection): EmReflection {
  return {
    ...r,
    keep: unmaskNames(r.keep),
    problem: unmaskNames(r.problem),
    tryNext: unmaskNames(r.tryNext),
  };
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

export function listReflections(): EmReflection[] {
  return [...reflections].sort((a, b) => b.periodEnd - a.periodEnd);
}

export async function addReflection(input: {
  periodStart: number;
  periodEnd: number;
  keep: string;
  problem: string;
  tryNext: string;
}): Promise<EmReflection> {
  const reflection: EmReflection = {
    id: randomUUID(),
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    keep: input.keep.trim() ? await maskForStorage(input.keep.trim()) : "",
    problem: input.problem.trim() ? await maskForStorage(input.problem.trim()) : "",
    tryNext: input.tryNext.trim() ? await maskForStorage(input.tryNext.trim()) : "",
    createdAt: Date.now(),
  };
  reflections.push(reflection);
  persistReflections();
  return reflection;
}
