'use client';
import { useCallback, useEffect, useState } from 'react';
import type { MusicProgram } from '@banger/compiler';
import type { PerformanceSnapshot, VocalWord } from '@banger/stage';

export interface StageRecording {
  id: string;
  element: HTMLAudioElement;
  words: readonly VocalWord[];
  vocals: boolean;
  /** Clear a Vocal Studio chunk-preview boundary before full-song playback. */
  prepare?: () => void;
}

/** The media clock drives both the score and singer. Never play a second synthesized beat over the recording. */
export function useRecordedStage(program: MusicProgram, recording: StageRecording | null) {
  const [playing, setPlaying] = useState(false), [starting, setStarting] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const element = recording?.element;
    const update = () => setPlaying(Boolean(element && !element.paused && !element.ended));
    const failure = () => { setError('The recording could not be played. Select it again to retry.'); update(); };
    queueMicrotask(() => { update(); setError(null); setStarting(false); });
    element?.addEventListener('play', update); element?.addEventListener('pause', update); element?.addEventListener('ended', update); element?.addEventListener('error', failure);
    return () => { element?.removeEventListener('play', update); element?.removeEventListener('pause', update); element?.removeEventListener('ended', update); element?.removeEventListener('error', failure); };
  }, [recording]);
  const readPerformance = useCallback((): PerformanceSnapshot => {
    const element = recording?.element;
    const position = Math.max(0, element?.currentTime ?? 0), beat = position * program.tempo / 60;
    const audible = Boolean(element && !element.paused && !element.ended && !element.seeking && element.readyState >= 2);
    return { program, fill: false, state: { playing: audible, bar: Math.floor(beat / 4) + 1, phase: beat / 4 % 1, step: Math.floor(beat * 4) % 16, tempo: program.tempo, hasPendingUpdate: false },
      ...(recording?.vocals ? { vocals: { words: recording.words, positionMs: position * 1000, playing: audible && !element!.muted && element!.volume > 0 } } : {}) };
  }, [program, recording]);
  // This is an imperative media element, not React state. Reset the shared transport.
  // eslint-disable-next-line react-hooks/immutability
  const stop = useCallback(() => { const element = recording?.element; if (element) { element.pause(); element.currentTime = 0; } }, [recording]);
  const play = useCallback(async () => {
    if (!recording) return;
    setStarting(true); setError(null);
    try { recording.prepare?.(); await recording.element.play(); }
    catch { setError('Audio playback could not start. Try again.'); }
    finally { setStarting(false); }
  }, [recording]);
  return { readPerformance, stop, play, state: { playing, tempo: program.tempo }, starting, error };
}
