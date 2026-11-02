# banger-ai

pnpm + Turborepo workspace. Requires Node.js 22.12+ and pnpm 11.9.0.

```sh
pnpm install
pnpm dev:www
pnpm dev:desktop
```

`pnpm dev` starts both apps and prints the selected local URL, starting at port 3000. The desktop client opens the same music studio in Electron. Restart the desktop command after main-process source changes.

| Workspace | Purpose |
| --- | --- |
| `apps/www` | Next.js song studio, piano roll, mixer and audio export |
| `apps/desktop` | Electron studio with native projects and AI account integration |
| `packages/compiler` | Bounded `.banger` parser, validation, arrangement and serialization |
| `packages/engine` | Web Audio synthesis, effects, automation, meters and WAV rendering |
| `packages/agent` | Compiler-validated music generation and file revisions |
| `packages/harness` | Project-aware music agent and CLI |
| `packages/eslint-config` | Shared ESLint configs |
| `packages/shadcn` | Shared studio controls and styles |
| `packages/typescript-config` | Shared TypeScript configs |

```sh
pnpm lint
pnpm typecheck
pnpm fullbuild
```

`pnpm build` runs workspace builds with the current environment. `pnpm fullbuild` sets `NODE_ENV=production`, including on machines that default to development. Desktop builds emit runnable files in `apps/desktop/dist`; installer packaging is not configured.

After building, use `pnpm --filter @banger/www start` or `pnpm --filter @banger/desktop start`.

## Songs, mixing and export

Open [night-drive.banger](examples/night-drive.banger) for a 40-bar song with eight tracks, named patterns, sections, buses, sends, sidechain and automation. The [language reference](packages/compiler/LANGUAGE.md) covers syntax and limits. Both music agents use the same language guide.

Each track has a base pattern and optional named patterns. Choose a pattern to edit its notes and phrase length. Sections select a pattern or silence for each track; the timeline orders and repeats sections. Playback loops the complete arrangement. Without a timeline, base patterns repeat to the longest base phrase.

The mixer provides panning, audio meters, EQ, compression, delay, distortion, filtering and reverb. Tracks can output to a bus and send to other buses. Sidechain compression follows the selected track's post-gain signal before its inserts. Automation lanes edit linear or stepped curves for gain, pitch, pan, filters and effect parameters. Track curves restart with each phrase; bus curves follow song beats.

Export audio renders the applied song to stereo PCM16 WAV at 44.1 or 48 kHz, including effect tails. Choose a track to export an individual stem with its routing and sidechain inputs. Mute and solo affect listening only. Shared nonlinear bus effects are rendered for each stem's contribution, so their sum can differ from the full mix. Exports exceeding the engine's 512 MiB buffer budget report an error before allocating audio.

The instrument menu includes synthesized kick, snare, hats, clap, tom, bass, pluck, lead, pad, bell, organ and keys. Every sound is generated locally.

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

Start and duration use quarter-note beats within the phrase. A phrase defaults to
four beats; `bars 4;` gives it 16 beats. Start must be nonnegative, duration must be
positive, and notes must end within the phrase. Velocity ranges from 0 to 1. Notes
can overlap, including repeated pitches. Pitch names cover MIDI 0 through 127. A
phrase supports up to 128 piano notes and a file supports 4096 total. `piano {}` is
a silent instrument track.

The sequencer shows a piano roll under each instrument. Click a row to add a note,
drag a note to move it, or drag its right edge to change its length. Pointer edits
use the selected snap grid. Quantize notes applies that grid to note starts and
durations. Track timing controls add playback quantization, swing and seeded
humanization without changing stored notes. Select a note for exact pitch, start, duration, and
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

`pnpm --filter @banger/desktop smoke:song` and `smoke:song:web` exercise arrangement,
mixer, automation, groove, file persistence and actual WAV/stem downloads. Run
`pnpm verify:audio` for rendered DSP checks and `pnpm verify:song` for the full
40-bar example, all eight stems and measured automation changes. Build first.
