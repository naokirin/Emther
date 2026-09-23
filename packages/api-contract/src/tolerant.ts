import { z } from "zod";

// 入力検証の既定方針（journal / settings/rules 等の既存 PATCH・POST）:
// 「型が違う値は黙って undefined（＝未指定）扱いにする」。
// 厳格化（400）は明示テストで寛容さが固定されているため、移行コストが高く初手では採用しない。
// 単純な GET（health / timeline）はリクエスト body が無いのでこのヘルパーは使わない。

export const optionalString = z.string().optional().catch(undefined);
export const optionalStringArray = z.array(z.string()).optional().catch(undefined);
export const optionalFiniteNumber = z.number().finite().optional().catch(undefined);
export const optionalBoolean = z.boolean().optional().catch(undefined);
export const optionalNullableString = z.string().nullable().optional().catch(undefined);
