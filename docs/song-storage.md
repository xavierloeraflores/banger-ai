# Local song storage

Desktop projects keep `name.banger` and the current `name.lyrics.json` at the
project root. Lyrics documents include `schemaVersion`, the music ID and version,
creation time, and the composition `plan`, including chunk text and timing.
Every published composition preserves a lyric snapshot in
`.banger/history/name/lyrics/lyrics-v001.json`, `lyrics-v002.json`, and so on.

Studio WAV exports, including stems and renders submitted to ElevenLabs, append
to `.banger/history/name/instrumentals/name.instrumental-v001.wav`. Returned
ElevenLabs audio appends to `vocals/name.vocals-v001.wav` when its composition
contains lyrics, or to instrumental history otherwise. Chromium decodes
compressed provider audio to PCM WAV. The provider's original bytes also remain
in the music cache. Conversion or disk failures retain the completed provider
result so recovery can retry storage without another paid request.

History names are allocated with exclusive filesystem links after the complete
file is written. Concurrent saves cannot replace an earlier version. Internal
storage directories cannot be symbolic links. The workspace file picker already
excludes hidden directories, so library copies do not appear as editable songs.

A music import persists its project location before analysis. Subsequent edits,
generations, and recovery use that location even after switching folders or
restarting the app. Existing cache songs acquire a location and copy their prior
revisions on their next edit. Songs without a selected folder use
`userData/projects/name/`. Rendering creates a missing root `.banger` from the
studio source, but does not replace an existing file with an unsaved draft.
Normal project saves continue to control changes to existing `.banger` files.
Imported WAVs without a corresponding composition do not invent a `.banger` file.

## Operations for the future library page

The sandboxed `window.bangerStorage` bridge provides:

- `prepare(name, source?)`: returns an opaque song token tied to the calling
  window and its current project. Capture it before rendering.
- `audio(token, bytes)`: appends a validated instrumental WAV and returns its
  revision filename.
- `history(token)`: lists the instrumental, vocal, and lyric revision filenames.
- `copyToLibrary(token, scope, selection)`: copies selected files into either
  `userData/library/name/` for `global`, or `.banger/library/name/` for `project`.

`selection.audio` is a history-relative name such as
`vocals/midnight.vocals-v002.wav`. `selection.instrumental` is an instrumental
filename such as `midnight.instrumental-v001.wav`. `selection.lyrics` optionally
chooses a saved lyric filename such as `lyrics-v002.json`; otherwise the current
root lyrics file is copied. A song with lyrics requires an instrumental selection.

The primary audio is copied as `name.wav`, the instrumental as
`name.instrumental.wav`, and available source and lyric files as `name.banger`
and `name.lyrics.json`. Existing library entries cause an error rather than
being replaced. A failed copy removes only its newly created destination.
Original files remain in place. No library page is included in this change.

These operations manage the desktop filesystem. Browser-only cloud music
continues to use its existing remote artifact and revision storage.

## Verification

Run the affected test runner as described in `testing.md`, then `pnpm fullbuild`
and the workspace and music smoke tests. For native storage, IPC ownership,
project switching, MP3 conversion, and library copying, run:

```sh
pnpm --filter @banger/desktop exec electron scripts/smoke-storage.mjs
```
