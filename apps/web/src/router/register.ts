// TanStack Router の Register。`from: '/suggestions'` 等のパス型推論を有効にする。
// main.tsx から一度だけ import する（副作用で module augmentation が載る）。
import type { createAppRouter } from "./appRouter";

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
