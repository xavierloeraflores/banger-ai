'use client';
import { Button, Select } from "@banger/shadcn";


import './audio-worklet';
import { librarySongType, type LibrarySongType } from '@banger/elevenlabs/protocol';
import './song-library.css';
import { getProjectWorkspace } from '@/lib/browser-workspace';
import { RecordOptions } from './record-options';
import { browserLibrarySongs, renameBrowserRecord, regenerateBrowserArtwork, renameBrowserSong, addBrowserSongToRecord, editBrowserRecordSongs, regenerateBrowserSongArtwork } from '@/lib/browser-library';
import { readSingAlong, type SingAlongData } from '@/lib/sing-along';
import type { StageRecording } from './recorded-stage';
import { SingAlong } from './sing-along';
import { useEffect, useRef, useState } from 'react';
import { compileMusic } from '@banger/compiler';
import { renderWav } from '@banger/engine';



import { clockTime } from './music-audio';

type SavedSong = { id: string; name: string; kind: 'audio' | 'beat'; scope: string; songType: LibrarySongType; projectId?: string; recordPosition?: number; recordId?: string; recordName?: string; artworkAttempts?: number; artworkPending?: boolean; artworkError?: boolean; artwork?: string };
type Beat = { name: string; source: string };
type LoadedSong = { url: string; beat?: Beat; lyrics?: unknown };
type Song = SavedSong & { storage: 'saved' | 'browser'; renameSong?(name: string): Promise<void>; addToRecord?(id: string, name?: string): Promise<void>; editRecordSongs?(ids: string[]): Promise<void>; regenerateSongArtwork?(): Promise<void>; recordKey?: string; renameRecord?(name: string): Promise<void>; regenerateArtwork?(): Promise<void>; load(): Promise<LoadedSong> };
declare global {
  interface Window {
    bangerLibrary?: {
      list(): Promise<SavedSong[]>;
      renameSong?(id: string, name: string): Promise<void>;
      addToRecord?(id: string, recordId: string, name?: string): Promise<void>;
      editRecordSongs?(id: string, ids: string[]): Promise<void>;
      regenerateSongArtwork?(id: string): Promise<void>;
      renameRecord?(id: string, name: string): Promise<void>;
      regenerateArtwork?(id: string): Promise<void>;
      read(id: string): Promise<{ source?: string; bytes?: Uint8Array; contentType?: string; beat?: Beat; lyrics?: unknown }>;
    };
  }
}
const message = (error: unknown) => error instanceof Error ? error.message : 'The song could not be loaded.';
const audioUrl = (bytes: ArrayBuffer | Uint8Array, type = 'audio/wav') => URL.createObjectURL(new Blob([new Uint8Array(bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer)], { type }));
async function beatUrl(source: string) { return audioUrl((await renderWav(compileMusic(source))).wav); }

export function SongLibrary({ onBeatChange, onRecordingChange, active = true, singAlong = false, onCloseSingAlong, onOpenProject }: { onBeatChange(beat: Beat | null): void; onRecordingChange(recording: StageRecording | null): void; active?: boolean; singAlong?: boolean; onCloseSingAlong(): void; onOpenProject?(id: string): void }) {
  const [projectIds, setProjectIds] = useState<Set<string>>(new Set());
  const [lyricData, setLyricData] = useState<SingAlongData>(() => readSingAlong(null));
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<Song | null>(null), [pending, setPending] = useState(false), [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0), [duration, setDuration] = useState(0);
  const player = useRef<HTMLAudioElement>(null), generation = useRef(0), url = useRef('');
  useEffect(() => {
    let cancelled = false;
    async function load(quiet = false) {
      if (!quiet) { setLoading(true); setError(''); }
      const sources: Promise<Song[]>[] = [];
      const recent = await getProjectWorkspace().recent?.().catch(() => []) ?? [];
      if (!cancelled) setProjectIds(new Set(recent.map(project => project.id)));
      if (window.bangerLibrary) {
        const library = window.bangerLibrary;
        sources.push(library.list().then(items => items.map(item => ({
          ...item, storage: 'saved' as const, id: `saved:${item.id}`,
          recordKey: item.recordId ? `saved:${item.recordId}` : undefined,
          renameSong: library.renameSong ? (name: string) => library.renameSong!(item.id, name) : undefined,
          addToRecord: library.addToRecord ? (id: string, name?: string) => library.addToRecord!(item.id, id, name) : undefined,
          editRecordSongs: item.recordId && library.editRecordSongs
            ? (ids: string[]) => library.editRecordSongs!(item.recordId!, ids.map(id => id.replace(/^saved:/, ''))) : undefined,
          regenerateSongArtwork: library.regenerateSongArtwork ? () => library.regenerateSongArtwork!(item.id) : undefined,
          renameRecord: item.recordId && library.renameRecord ? (name: string) => library.renameRecord!(item.recordId!, name) : undefined,
          regenerateArtwork: item.recordId && library.regenerateArtwork ? () => library.regenerateArtwork!(item.recordId!) : undefined,
          load: async () => {
            const file = await library.read(item.id);
            if (file.source !== undefined) return { url: await beatUrl(file.source), beat: { name: item.name, source: file.source } };
            if (!file.bytes) throw new Error('This song has no audio.');
            return { url: audioUrl(file.bytes, file.contentType), beat: file.beat, lyrics: file.lyrics };
          },
        }))));
      }
      sources.push(browserLibrarySongs().then(items => items.map(item => ({
        storage: 'browser' as const, id: item.id, name: item.name, kind: 'audio' as const, scope: 'Library',
        projectId: item.projectId ?? undefined, recordPosition: item.recordPosition,
        recordId: item.recordId, recordName: item.recordName, recordKey: item.recordId ? `browser:${item.recordId}` : undefined,
        artwork: item.artwork, artworkPending: item.artworkPending, artworkError: item.artworkError,
        songType: item.songType ?? librarySongType(item.files['lyrics.json']),
        renameSong: (name: string) => renameBrowserSong(item.id, name),
        addToRecord: (id: string, name?: string) => addBrowserSongToRecord(item.id, id, name),
        editRecordSongs: item.recordId ? (ids: string[]) => editBrowserRecordSongs(item.recordId!, ids) : undefined,
        regenerateSongArtwork: () => regenerateBrowserSongArtwork(item.id),
        renameRecord: item.recordId ? (name: string) => renameBrowserRecord(item.recordId!, name) : undefined,
        regenerateArtwork: item.recordId ? () => regenerateBrowserArtwork(item.recordId!) : undefined,
        load: async () => ({ url: audioUrl(item.wav), beat: item.beat, lyrics: item.files['lyrics.json'] }),
      }))));
      const results = await Promise.allSettled(sources);
      if (cancelled) return;
      const items = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
      setSongs(items); setLoading(false);
      const failures = results.filter(result => result.status === 'rejected');
      if (failures.length) setError(`Some songs could not be loaded. ${message(failures[0]!.reason)}`);
    }
    let busy = false;
    const refreshSongs = async (quiet = false) => { if(busy)return; busy=true; try { await load(quiet); } finally { busy=false; } };
    void refreshSongs();
    const timer = active ? setInterval(() => { void refreshSongs(true); }, 4000) : undefined;
    return () => { cancelled = true; clearInterval(timer); };
  }, [refresh, active]);
  useEffect(() => {
    const element = player.current, requests = generation;
    return () => { requests.current++; element?.pause(); if (url.current) URL.revokeObjectURL(url.current); };
  }, []);
  useEffect(() => { if (!active) player.current?.pause(); }, [active]);
  useEffect(() => () => { onBeatChange(null); onRecordingChange(null); }, [onBeatChange, onRecordingChange]);
  useEffect(() => {
    if (!playing) return;
    let frame: number;
    const update = () => { if (player.current) setPosition(player.current.currentTime); frame = requestAnimationFrame(update); };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  function seek(seconds: number) {
    if (player.current && duration) {
      const time = Math.max(0, Math.min(duration, seconds));
      player.current.currentTime = time; setPosition(time);
    }
  }
  async function choose(song: Song) {
    const element = player.current;
    if (!element) return;
    if (selected?.id === song.id && url.current && !pending) {
      try { if (element.paused) await element.play(); else element.pause(); } catch (cause) { setError(message(cause)); }
      return;
    }
    const ticket = ++generation.current;
    element.pause(); element.removeAttribute('src'); element.load();
    if (url.current) URL.revokeObjectURL(url.current); url.current = '';
    onRecordingChange(null); onBeatChange(null); setLyricData(readSingAlong(null));
    setSelected(song); setPending(true); setPlaying(false); setPosition(0); setDuration(0); setError('');
    try {
      const next = await song.load();
      if (generation.current !== ticket) { URL.revokeObjectURL(next.url); return; }
      url.current = next.url; element.src = next.url;
      const data = readSingAlong(next.lyrics), words = data.lines.flatMap(line => line.words);
      onBeatChange(next.beat ?? null); setLyricData(data);
      onRecordingChange({ id: song.id, element, words, vocals: words.length > 0 || Boolean(data.lyrics) });
      await element.play();
    } catch (cause) { if (generation.current === ticket) setError(message(cause)); }
    finally { if (generation.current === ticket) setPending(false); }
  }
  const singles = songs.filter(song => !song.recordId);
  const records = [...songs.filter(song => song.recordId).reduce((groups, song) => {
    const id = song.recordKey!;
    const group = groups.get(id) ?? { id, name: song.recordName ?? song.name, artwork: song.artwork, songs: [] as Song[] };
    group.artwork ??= song.artwork; group.songs.push(song); groups.set(id, group); return groups;
  }, new Map<string, {id:string;name:string;artwork?:string;songs:Song[]}>()).values()];
  for (const record of records) record.songs.sort((a, b) => (a.recordPosition ?? 0) - (b.recordPosition ?? 0));
  const changed = () => setRefresh(value => value + 1);
  function projectAction(song: Song) {
    return song.projectId && (song.storage === 'saved' || projectIds.has(song.projectId)) && onOpenProject ? () => onOpenProject(song.projectId!) : undefined;
  }
  function songOptions(song: Song) {
    return song.renameSong && song.regenerateSongArtwork && <RecordOptions kind="song" name={song.name} generating={song.artworkPending} rename={song.renameSong} regenerate={song.recordId ? song.regenerateArtwork ?? song.regenerateSongArtwork : song.regenerateSongArtwork} openProject={projectAction(song)} addToRecord={song.addToRecord} records={records.filter(record => record.songs[0]?.storage === song.storage && record.id !== song.recordKey).map(record => ({ id: record.songs[0]!.recordId!, name: record.name }))} onChange={changed} />;
  }
  const currentSelected = songs.find(song => song.id === selected?.id) ?? selected;
  return <section className="song-library" data-sing-along={singAlong && !!selected} aria-labelledby={singAlong && selected ? "sing-along-title" : "library-title"}>
    {(!singAlong || !selected) && <header className="library-heading"><div><p>Your collection</p><h1 id="library-title">Library</h1><span>{loading ? 'Loading songs…' : `${records.length ? `${records.length} ${records.length === 1 ? 'record' : 'records'} · ` : ''}${songs.length} ${songs.length === 1 ? 'song' : 'songs'}`}</span></div><div><Button disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh</Button></div></header>}
    {error && <p className="library-error" role="alert">{error}</p>}
    {singAlong && <div className="library-sing-controls"><Button onClick={onCloseSingAlong}>← Collection</Button><Select aria-label="Lyrics song" value={selected?.id ?? ''} onChange={event => { const song = songs.find(item => item.id === event.target.value); if (song) void choose(song); }}><option value="" disabled>Choose a song</option>{songs.map(song => <option key={song.id} value={song.id}>{song.name}</option>)}</Select></div>}
    {singAlong && selected && <SingAlong instrumental={selected.songType === 'instrumental'} name={currentSelected!.name} data={lyricData} position={position} duration={duration} pending={pending} onSeek={seek} />}
    {singAlong && !selected && <p className="library-help">Choose a song to see its waveform and lyrics.</p>}
    {(!singAlong || !selected) && <div className="library-grid" aria-label="Songs and records" aria-busy={loading}>
      {singles.map((song, index) => <section key={song.id} className="library-single">{songOptions(song)}<Button className="library-card" aria-label={`${selected?.id === song.id && playing ? 'Pause' : 'Play'} ${song.name}`} aria-pressed={selected?.id === song.id} onClick={() => void choose(song)}>
        <span className={`library-art library-art-${index % 4}`}>
          <span className="library-art-fallback" aria-hidden="true">♫</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {song.artwork && <img key={song.artwork} src={song.artwork} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} />}
          <span className="library-card-play" aria-hidden="true">{selected?.id === song.id && pending ? '…' : selected?.id === song.id && playing ? 'Ⅱ' : '▶'}</span>
        </span>
        <strong>{song.name}</strong><span className="library-card-detail"><span>{song.scope}</span><span className="library-song-tag" data-song-type={song.songType}>{song.songType === 'vocal' ? 'Vocal' : 'Instrumental'}</span></span>
      </Button>{song.artworkPending && <p className="library-record-notice" role="status">Generating new artwork…</p>}{song.artworkError && <p className="library-record-notice" role="status">Artwork could not be regenerated. Try again from the song menu.</p>}</section>)}
      {records.map((record, index) => <section className="library-record" key={record.id} aria-label={`Record: ${record.name}`}>
        {record.songs[0]?.renameRecord && record.songs[0]?.regenerateArtwork && <RecordOptions name={record.name} generating={record.songs.some(song => song.artworkPending)} rename={record.songs[0].renameRecord} regenerate={record.songs[0].regenerateArtwork} openProject={record.songs.map(projectAction).find(Boolean)} songs={songs.filter(song => song.storage === record.songs[0]?.storage && (!song.recordId || song.recordKey === record.id))} selectedSongs={record.songs.map(song => song.id)} editSongs={record.songs[0].editRecordSongs} onChange={changed} />}
        {record.artwork && <div className={`library-art library-art-${index % 4}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={record.artwork} src={record.artwork} alt={`${record.name} record cover`} onError={event => { event.currentTarget.style.display = 'none'; }} />
        </div>}
        <h2>{record.name}</h2><p className="library-record-count">{record.songs.length} {record.songs.length === 1 ? 'song' : 'songs'}</p>
        {record.songs.some(song => song.artworkPending) && <p className="library-record-notice" role="status">Generating new artwork…</p>}
        {record.songs.some(song => song.artworkError) && <p className="library-record-notice" role="status">Artwork could not be regenerated. Try again from the record menu.</p>}
        <ol className="library-record-songs">{record.songs.map(song => <li key={song.id}>{songOptions(song)}
          <Button className="library-card" aria-label={`${selected?.id === song.id && playing ? 'Pause' : 'Play'} ${song.name}`} aria-pressed={selected?.id === song.id} onClick={() => void choose(song)}>
            <span className="library-song-play" aria-hidden="true">{selected?.id === song.id && pending ? '…' : selected?.id === song.id && playing ? 'Ⅱ' : '▶'}</span>
            <span><strong>{song.name}</strong><span className="library-card-detail"><span>{song.scope}</span><span className="library-song-tag" data-song-type={song.songType}>{song.songType === 'vocal' ? 'Vocal' : 'Instrumental'}</span></span></span>
          </Button>
        </li>)}</ol>
      </section>)}
    </div>}
    {!loading && songs.length === 0 && <p className="library-help">No songs added yet. Choose Export and save to library in Beat Studio or Vocal Studio.</p>}
    <footer className="library-player" aria-label="Library player">
      <audio ref={player} aria-label="Library song preview" preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onTimeUpdate={event => setPosition(event.currentTarget.currentTime)} onLoadedMetadata={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onError={() => { setPending(false); setError('This song could not be played. Select it again to retry.'); onRecordingChange(null); if (url.current) URL.revokeObjectURL(url.current); url.current = ''; }} />
      <div className="library-now-playing"><strong>{currentSelected?.name ?? 'Pick a song'}</strong><span>{pending ? 'Preparing audio…' : playing ? 'Now playing' : selected ? 'Paused' : 'Select a song to play'}</span></div>
      <Button aria-label={playing ? 'Pause library song' : 'Play library song'} disabled={!selected || pending} onClick={() => { if (selected) void choose(selected); }}>{playing ? 'Ⅱ' : '▶'}</Button>
      <time>{clockTime(position)}</time><input type="range" aria-label="Seek library song" min={0} max={duration || 1} step={.1} value={Math.min(position, duration)} disabled={!duration || pending} onChange={event => seek(Number(event.target.value))} /><time>{clockTime(duration)}</time>
    </footer>
  </section>;
}
