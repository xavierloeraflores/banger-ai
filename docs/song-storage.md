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

## Project agent lyrics access

The project agent discovers current `<song>.lyrics.json` documents and
`.banger/history/<song>/lyrics/lyrics-vNNN.json` revisions, including songs in
visible subfolders. `list_lyrics` lists those paths; `read_lyrics` reads either
kind and returns `null` for missing lyrics. Discovery does not create storage
folders. The studio song picker and the existing `.banger` tools remain music-only.

`edit_lyrics` replaces one exact match, and `write_lyrics` saves a complete JSON
document. Both require reading the existing current lyrics in that task. Saves
use the same workflow as desktop music generation: append an immutable revision,
then replace the current file. Historical revisions cannot be edited. The agent
preserves metadata, timing and styles unless the user requests changes.

Lyrics access retains the harness's 64 KiB UTF-8 limit, project boundary checks,
symlink and hard-link rejection, and stale-edit protection. JSON must contain
`plan.chunks` with string `text` values. Hidden paths outside the lyrics history
subtree remain inaccessible. Files larger than the harness limit remain on disk
but cannot be read or edited by the agent.

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

## Vocal performance descriptions

Current `.lyric.json` documents and their history revisions store an optional
`plan.chunks[i].vocalStyle` string, up to 1,000 characters. A pre-composition
`.draft.json` can store the same field at the top level. For example:

```json
{"vocalStyle":"Warm, breathy alto, intimate delivery, restrained vibrato."}
```

Keep the description separate from chunk `text` and `positiveStyles`. Vocal
Studio can apply a description to every chunk or the selected chunks. Saving
creates a composition revision without generating audio. An empty description
clears it; changing it replaces the previous description. Lyric-only edits retain
it, including full agent document rewrites that omit the field. To clear a style
through an agent file edit, set it to an empty string explicitly.

The shared ElevenLabs adapter adds the description to each generated chunk's
`positiveStyles`, avoiding duplicate entries. It retains the separately saved
field after generation so subsequent edits cannot remove musical styles.
Full Send and WAV reanalysis transfer descriptions to the fresh composition.
When chunk boundaries change, each new chunk uses the description from the old
chunk with the greatest time overlap. A uniform song-wide style applies to all
new chunks, including any extension of the song.
