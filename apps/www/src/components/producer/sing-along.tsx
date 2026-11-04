'use client';
import { Button } from "@banger/shadcn";


import { useEffect, useMemo, useRef } from 'react';
import { currentLyricLine, type SingAlongData } from '@/lib/sing-along';
import { clockTime } from './music-audio';
import './sing-along.css';

type Props = { artwork?: string; playing: boolean; name: string; instrumental: boolean; data: SingAlongData; position: number; duration: number; pending: boolean; onSeek(seconds: number): void };

function Waveform({ samples, start, end, position, detail = false }: { samples: number[]; start: number; end: number; position: number; detail?: boolean }) {
  const peak = useMemo(() => samples.reduce((max, value) => Math.max(max, Math.abs(value)), 1), [samples]);
  const span = Math.max(.25, end - start);
  const first = Math.max(0, Math.floor(start * 4));
  const last = Math.min(samples.length, Math.ceil(end * 4));
  const stride = Math.max(1, Math.ceil((last - first) / 420));
  const bars = [];
  for (let i = first; i < last; i += stride) {
    const amplitude = Math.max(...samples.slice(i, Math.min(last, i + stride)).map(Math.abs));
    const height = Math.max(2, amplitude / peak * 88);
    bars.push(<rect key={i} x={(i / 4 - start) / span * 1000} y={50 - height / 2} width={Math.max(1, stride / 4 / span * 1000 * .7)} height={height} rx={1.5} fill={i / 4 <= position ? '#75b5ff' : detail ? '#637a96' : '#445366'} />);
  }
  const playhead = Math.max(0, Math.min(1000, (position - start) / span * 1000));
  return <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 50H1000" stroke="#ffffff12" />{bars}
    <path d={`M${playhead} 0V100`} stroke="#dcebff" strokeWidth="2" />
  </svg>;
}

export function SingAlong({ artwork, playing, name, instrumental, data, position, duration, pending, onSeek }: Props) {
  const active = currentLyricLine(data.lines, position * 1000);
  const next = data.lines.findIndex(line => line.startMs > position * 1000);
  const focused = active >= 0 ? active : next;
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = transcript.current;
    const line = container?.querySelector<HTMLElement>(`[data-line="${focused}"]`);
    if (container && line) container.scrollTo({ top: line.offsetTop - container.offsetTop - container.clientHeight / 2 + line.clientHeight / 2, behavior: 'instant' });
  }, [focused]);
  return <section className="sing-along" id="library-sing-along" aria-label={`Lyrics for ${name}`} aria-busy={pending}>
    <div className="sing-along-title"><h2 id="sing-along-title">{name}</h2>{instrumental && <span className="library-song-tag" data-song-type="instrumental">Instrumental</span>}</div>
    <div className="sing-along-body">
      <div className="sing-along-performance">
        <div className="sing-along-art" data-playing={playing && !pending} role="img" aria-label={`${name} cover art`}>
          <span aria-hidden="true">♫</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {artwork && <img key={artwork} src={artwork} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} />}
        </div>
      </div>
      <div className="sing-along-transcript"><h3>Lyrics {!data.lines.length && <span>Without timing</span>}</h3>
        <div ref={transcript} className="sing-along-lines" tabIndex={0} aria-label="Song lyrics">
          {data.lines.length ? data.lines.map((line, index) => <Button type="button" key={index} data-line={index} aria-current={index === active ? 'true' : undefined} disabled={pending || !duration} onClick={() => onSeek(line.startMs / 1000)}><time>{clockTime(line.startMs / 1000)}</time><span>{line.words.map((word, wordIndex) => <span key={wordIndex} data-state={position * 1000 >= word.endMs ? 'sung' : position * 1000 >= word.startMs ? 'singing' : 'upcoming'}>{word.word}{' '}</span>)}</span></Button>) : <p className="sing-along-empty">{data.lyrics || 'No lyrics saved for this song. Songs exported from Vocal Studio can include lyrics and word timings.'}</p>}
        </div>
      </div>
    </div>
    <div className="sing-along-overview">
      <div className="sing-along-seek">
        {data.waveform.length ? <Waveform samples={data.waveform} start={0} end={duration || data.waveform.length / 4} position={position} /> : <div className="sing-along-empty">Waveform unavailable</div>}
        <input type="range" aria-label="Seek lyrics waveform" min="0" max={duration || 1} step="0.01" value={Math.min(position, duration)} disabled={!duration || pending} onChange={event => onSeek(Number(event.target.value))} />
      </div><div><time>0:00</time><time>{clockTime(duration)}</time></div>
    </div>
  </section>;
}
