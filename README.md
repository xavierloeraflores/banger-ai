# banger-ai

pnpm + Turborepo workspace. Requires Node.js 22.12+ and pnpm 11.9.0.

```sh
pnpm install
pnpm dev:www
pnpm dev:desktop
```

`pnpm dev` starts both apps. The web client runs at http://localhost:3000. The desktop client compiles and opens a blank Electron window. Restart the desktop command after source changes.

| Workspace | Purpose |
| --- | --- |
| `apps/www` | Empty Next.js App Router client |
| `apps/desktop` | Empty Electron client |
| `packages/compiler` | Empty compiler module |
| `packages/engine` | Empty engine module |
| `packages/eslint-config` | Shared ESLint configs |
| `packages/shadcn` | Empty shared UI module, ready for components |
| `packages/typescript-config` | Shared TypeScript configs |

```sh
pnpm lint
pnpm typecheck
pnpm fullbuild
```

`pnpm build` runs workspace builds with the current environment. `pnpm fullbuild` sets `NODE_ENV=production`, including on machines that default to development. Desktop builds emit runnable files in `apps/desktop/dist`; installer packaging is not configured.

After building, use `pnpm --filter @banger/www start` or `pnpm --filter @banger/desktop start`.
