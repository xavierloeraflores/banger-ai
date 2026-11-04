# Shared shadcn UI

The shadcn registry components live in `src/components`, with their dependencies,
hooks and blue theme owned by `@banger/shadcn`. The web and hosted API apps use
matching `components.json` files, following the [shadcn monorepo setup](https://ui.shadcn.com/docs/monorepo).

Add or update registry components from the web workspace:

```sh
pnpm dlx shadcn@latest add button --cwd apps/www
pnpm --filter @banger/shadcn build
```

All components from the configured `new-york` registry were installed with
`add --all`. Import them by subpath, for example
`@banger/shadcn/components/dialog`. The root exports preserve the studio's
existing Button, IconButton, Input, Select, Panel and Field APIs by composing
registry components. Select uses shadcn NativeSelect to preserve native option,
keyboard and form behavior. Panel uses Card with `asChild` to retain section
semantics. The installed utilities and hooks are also exported by subpath.

`src/theme.css` compiles Tailwind v4 utilities into `dist/styles.css`, imported
by both app layouts. Its color tokens preserve the dark backgrounds and blue
primary/focus colors. Preflight is intentionally excluded to avoid resetting
the sequencer, piano roll, waveform and Muse Hero canvases. App-sized controls
and existing layout styles remain in `src/styles.css` and the producer CSS.

`Modal` composes shadcn Dialog and exposes `showModal`, `close` and `open` through
a typed React ref for asynchronous app workflows. React Activity retains child
state across closing while suspending hidden effects. The studio owns the cloud
draft unload guard, so it stays active while the project dialog is hidden. Dialogs keep their theme
ancestor, use focus trapping and restoration, and support cancel prevention for
required project prompts. Use `data-state` and `aria-modal` in UI checks, rather
than native dialog `.open` or `:modal`.

StepButton and Range remain custom musical controls. Sequencer steps, piano
keys/notes, synthesis sliders, waveforms, source-editor highlighting and Muse
Hero gameplay are outside this migration. Expanders inside musical editors
also retain their existing behavior.
