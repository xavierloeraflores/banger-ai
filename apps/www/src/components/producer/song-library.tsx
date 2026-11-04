'use client';

import './audio-worklet';
import './song-library.css';
import { browserLibrarySongs } from '@/lib/browser-library';
import { useEffect, useRef, useState } from 'react';
import { compileMusic } from '@banger/compiler';
import { renderWav } from '@banger/engine';



import { clockTime } from './music-audio';

type SavedSong = { id: string; name: string; kind: 'audio' | 'beat'; scope: string; artwork?: string };
type Song = SavedSong & { load(): Promise<string> };
declare global {
  interface Window {
    bangerLibrary?: {
      list(): Promise<SavedSong[]>;
      read(id: string): Promise<{ source?: string; bytes?: Uint8Array; contentType?: string }>;
    };
  }
}
const message = (error: unknown) => error instanceof Error ? error.message : 'The song could not be loaded.';
const audioUrl = (bytes: ArrayBuffer | Uint8Array, type = 'audio/wav') => URL.createObjectURL(new Blob([new Uint8Array(bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer)], { type }));
async function beatUrl(source: string) { return audioUrl((await renderWav(compileMusic(source))).wav); }

export function SongLibrary() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<Song | null>(null), [pending, setPending] = useState(false), [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0), [duration, setDuration] = useState(0);
  const player = useRef<HTMLAudioElement>(null), generation = useRef(0), url = useRef('');
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setError('');
      const sources: Promise<Song[]>[] = [];
      if (window.bangerLibrary) {
        const library = window.bangerLibrary;
        sources.push(library.list().then(items => items.map(item => ({ ...item, id: `saved:${item.id}`, load: async () => {
          const file = await library.read(item.id);
          if (file.source !== undefined) return beatUrl(file.source);
          if (!file.bytes) throw new Error('This song has no audio.');
          return audioUrl(file.bytes, file.contentType);
        } }))));
      }
      sources.push(browserLibrarySongs().then(items => items.map(item => ({ id: item.id, name: item.name, kind: 'audio' as const, scope: 'Library', load: async () => audioUrl(item.wav) }))));
      const results = await Promise.allSettled(sources);
      if (cancelled) return;
      const items = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
      setSongs(items); setLoading(false);
      const failures = results.filter(result => result.status === 'rejected');
      if (failures.length) setError(`Some songs could not be loaded. ${message(failures[0]!.reason)}`);
    }
    void load();
    return () => { cancelled = true; };
  }, [refresh]);
  useEffect(() => {
    const element = player.current, requests = generation;
    return () => { requests.current++; element?.pause(); if (url.current) URL.revokeObjectURL(url.current); };
  }, []);
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
    setSelected(song); setPending(true); setPlaying(false); setPosition(0); setDuration(0); setError('');
    try {
      const next = await song.load();
      if (generation.current !== ticket) { URL.revokeObjectURL(next); return; }
      url.current = next; element.src = next;
      await element.play();
    } catch (cause) { if (generation.current === ticket) setError(message(cause)); }
    finally { if (generation.current === ticket) setPending(false); }
  }
  return <section className="song-library" aria-labelledby="library-title">
    <header className="library-heading"><div><p>Your collection</p><h1 id="library-title">Library</h1><span>{loading ? 'Loading songs…' : `${songs.length} ${songs.length === 1 ? 'song' : 'songs'}`}</span></div><div><button disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh</button></div></header>
    {error && <p className="library-error" role="alert">{error}</p>}
    <div className="library-grid" aria-label="Songs" aria-busy={loading}>
      {songs.map((song, index) => <button key={song.id} className="library-card" aria-label={`${selected?.id === song.id && playing ? 'Pause' : 'Play'} ${song.name}`} aria-pressed={selected?.id === song.id} onClick={() => void choose(song)}>
        <span className={`library-art library-art-${index % 4}`}>
          <span className="library-art-fallback" aria-hidden="true">♫</span>
          {/* Covers are local data URLs; keep their original dimensions and avoid an image proxy. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {song.artwork && <img src={song.artwork} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} />}
          <span className="library-card-play" aria-hidden="true">{selected?.id === song.id && pending ? '…' : selected?.id === song.id && playing ? 'Ⅱ' : '▶'}</span>
        </span><strong>{song.name}</strong><span className="library-card-detail">{song.scope}</span>
      </button>)}
    </div>
    {!loading && songs.length === 0 && <p className="library-help">No songs added yet. Choose Export and save to library in Beat Studio or Vocal Studio.</p>}
    <footer className="library-player" aria-label="Library player">
      <audio ref={player} aria-label="Library song preview" preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onTimeUpdate={event => setPosition(event.currentTarget.currentTime)} onLoadedMetadata={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onError={() => { setPending(false); setError('This song could not be played. Select it again to retry.'); if (url.current) URL.revokeObjectURL(url.current); url.current = ''; }} />
      <div className="library-now-playing"><strong>{selected?.name ?? 'Pick a song'}</strong><span>{pending ? 'Preparing audio…' : playing ? 'Now playing' : selected ? 'Paused' : 'Select a cover to play'}</span></div>
      <button aria-label={playing ? 'Pause library song' : 'Play library song'} disabled={!selected || pending} onClick={() => { if (selected) void choose(selected); }}>{playing ? 'Ⅱ' : '▶'}</button>
      <time>{clockTime(position)}</time><input type="range" aria-label="Seek library song" min={0} max={duration || 1} step={.1} value={Math.min(position, duration)} disabled={!duration || pending} onChange={event => { if (player.current) { player.current.currentTime = Number(event.target.value); setPosition(Number(event.target.value)); } }} /><time>{clockTime(duration)}</time>
    </footer>
  </section>;
}
