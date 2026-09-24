// ルート validateSearch 用。未知キー（peek / focus 等）は落とさない。
import type { z } from "zod";

export function validateSearchWith<T extends z.ZodType>(schema: T) {
  return (search: Record<string, unknown>): z.infer<T> & Record<string, unknown> => {
    const parsed = schema.parse(search) as Record<string, unknown>;
    return { ...search, ...parsed } as z.infer<T> & Record<string, unknown>;
  };
}
