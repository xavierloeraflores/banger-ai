'use client';
import { Button } from "@banger/shadcn";


import { useEffect, useMemo, useRef } from 'react';
import { currentLyricLine, type SingAlongData } from '@/lib/sing-along';
import { clockTime } from './music-audio';
import './sing-along.css';

type Props = { name: string; data: SingAlongData; position: number; duration: number; pending: boolean; onSeek(seconds: number): void };

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

export function SingAlong({ name, data, position, duration, pending, onSeek }: Props) {
  const active = currentLyricLine(data.lines, position * 1000);
  const next = data.lines.findIndex(line => line.startMs > position * 1000);
  const focused = active >= 0 ? active : next;
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = transcript.current;
    const line = container?.querySelector<HTMLElement>(`[data-line="${focused}"]`);
    if (container && line) container.scrollTo({ top: line.offsetTop - container.offsetTop - container.clientHeight / 2 + line.clientHeight / 2, behavior: 'instant' });
  }, [focused]);
  const windowStart = Math.max(0, Math.min(position - 4, duration - 8));
  const windowEnd = Math.min(duration || 8, windowStart + 8);
  return <section className="sing-along" id="library-sing-along" aria-label={`Sing along to ${name}`} aria-busy={pending}>
    <div className="sing-along-title"><div><p>Sing along</p><h2 id="sing-along-title">{name}</h2></div><span>{data.lines.length ? 'Word-synced lyrics' : 'Lyrics'}</span></div>
    <div className="sing-along-body">
      <div className="sing-along-performance">
        <div className="sing-along-cue"><span className="sing-along-dot" />{pending ? 'Preparing audio…' : active >= 0 ? 'Sing along' : next >= 0 ? `Vocals in ${Math.ceil((data.lines[next]!.startMs / 1000) - position)}s` : data.lines.length ? 'Let it ring out' : 'Listen along'}</div>
        <div className="sing-along-current" aria-label="Current lyric">
          {focused >= 0 ? data.lines[focused]!.words.map((word, index) => <span key={index} data-state={position * 1000 >= word.endMs ? 'sung' : position * 1000 >= word.startMs ? 'singing' : 'upcoming'}>{word.word}{' '}</span>) : <span>{data.lines.length ? '♪' : 'Find your voice'}</span>}
        </div>
        <p className="sing-along-next">{focused >= 0 && data.lines[focused + 1] ? data.lines[focused + 1]!.words.map(word => word.word).join(' ') : data.lines.length ? ' ' : 'This song has no saved word timings.'}</p>
        <div className="sing-along-detail"><div><span>In the moment</span><time>{clockTime(position)}</time></div>
          {data.waveform.length ? <Waveform samples={data.waveform} start={windowStart} end={windowEnd} position={position} detail /> : <p className="sing-along-empty">No waveform saved for this song.</p>}
          <div><time>{clockTime(windowStart)}</time><time>{clockTime(windowEnd)}</time></div>
        </div>
      </div>
      <div className="sing-along-transcript"><h3>Lyrics <span>{data.lines.length ? 'Click a line to jump' : 'Without timing'}</span></h3>
        <div ref={transcript} className="sing-along-lines" tabIndex={0} aria-label="Song lyrics">
          {data.lines.length ? data.lines.map((line, index) => <Button type="button" key={index} data-line={index} aria-current={index === active ? 'true' : undefined} disabled={pending || !duration} onClick={() => onSeek(line.startMs / 1000)}><time>{clockTime(line.startMs / 1000)}</time><span>{line.words.map(word => word.word).join(' ')}</span></Button>) : <p className="sing-along-empty">{data.lyrics || 'No lyrics saved for this song. Songs exported from Vocal Studio can include lyrics and word timings.'}</p>}
        </div>
      </div>
    </div>
    <div className="sing-along-overview"><div><span>Full song</span><span>Drag to find your place</span></div>
      <div className="sing-along-seek">
        {data.waveform.length ? <Waveform samples={data.waveform} start={0} end={duration || data.waveform.length / 4} position={position} /> : <div className="sing-along-empty">Waveform unavailable</div>}
        <input type="range" aria-label="Seek sing-along waveform" min="0" max={duration || 1} step="0.01" value={Math.min(position, duration)} disabled={!duration || pending} onChange={event => onSeek(Number(event.target.value))} />
      </div><div><time>0:00</time><time>{clockTime(duration)}</time></div>
    </div>
  </section>;
}
