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

## Piano rolls

Instrument tracks accept either an existing `notes "C2 . G2 .";` pattern or a
`piano` block. Drums continue to use `rhythm` step patterns.

```text
tempo 120;
meter 4/4;
track chords {
  instrument "synth/pluck";
  piano {
    note "C4" start 0 duration 2 velocity 0.8;
    note "E4" start 0 duration 2 velocity 0.6;
    note "G4" start 0.5 duration 3.5 velocity 0.7;
  }
  gain 0.35;
}
```

Start and duration use quarter-note beats within the four-beat loop. Start must
be at least 0 and less than 4; duration must be positive and end at or before beat
4. Velocity ranges from 0 to 1. Notes can overlap, including repeated pitches.
Pitch names cover MIDI 0 through 127. A track supports up to 128 piano notes and a
file supports 256 total. `piano {}` is a silent instrument track.

The sequencer shows a piano roll under each instrument. Click a row to add a note,
drag a note to move it, or drag its right edge to change its length. Pointer edits
use quarter-beat increments. Select a note for exact pitch, start, duration, and
velocity fields or the Delete note button. The note menu can select notes hidden
behind overlapping notes. Arrow keys move notes; Shift + left/right changes
length; Delete removes a note; Escape cancels a drag.

Existing `notes` patterns retain their syntax and playback until edited in the
piano roll. The first roll edit converts that track to explicit notes, preserving
its pitches and onsets, with one step of duration and velocity 1 for each old note.
Drum steps and other legacy tracks stay in their original pattern format.
Unapplied source drafts disable visual editing and keep the last applied sequence
playing. Valid changes take effect on the next bar during playback.

After `pnpm fullbuild`, run `pnpm --filter @banger/desktop smoke` for the desktop
checks and `pnpm --filter @banger/desktop smoke:web` for the HTTP web app in Chromium.
Both exercise real pointer edits and piano-only audio. The desktop check also
covers native save/reopen; the web check covers download and file-input reopen.
