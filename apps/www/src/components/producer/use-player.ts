"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MusicProgram } from "@banger/compiler";
import { BangerPlayer } from "@banger/engine";

const idle = { playing: false, bar: 0, step: -1, phase: 0, tempo: 120, hasPendingUpdate: false };

export function usePlayer(program: MusicProgram) {
  const player = useRef<BangerPlayer | null>(null);
  const latestProgram = useRef(program);
  const generation = useRef(0);
  const pending = useRef(false);
  const audioError = useRef<string | null>(null);
  const [state, setState] = useState(idle);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const instance = new BangerPlayer();
    player.current = instance;
    const timer = window.setInterval(() => {
      const current = instance.state;
      setState(previous => {
        const next = { ...current, tempo: current.tempo ?? latestProgram.current.tempo };
        return previous.playing === next.playing && previous.bar === next.bar && previous.phase === next.phase && previous.tempo === next.tempo && previous.hasPendingUpdate === next.hasPendingUpdate ? previous : next;
      });
      setError(audioError.current);
    }, 25);
    return () => {
      generation.current += 1;
      pending.current = false;
      window.clearInterval(timer);
      player.current = null;
      instance.stop();
      void instance.dispose().catch(() => {});
    };
  }, []);

  useEffect(() => {
    latestProgram.current = program;
    const instance = player.current;
    if (!instance?.state.playing) return;
    try {
      instance.update(program);
      audioError.current = null;
    } catch (cause) {
      audioError.current = cause instanceof Error ? cause.message : "Could not update playback.";
    }
  }, [program]);

  const play = useCallback(async () => {
    const instance = player.current;
    if (!instance || pending.current || instance.state.playing) return;
    const request = ++generation.current;
    const requestedProgram = latestProgram.current;
    pending.current = true;
    setStarting(true);
    audioError.current = null;
    try {
      await instance.start(requestedProgram);
      if (request !== generation.current || player.current !== instance) {
        instance.stop();
        return;
      }
      if (latestProgram.current !== requestedProgram) instance.update(latestProgram.current);
      setState({ ...instance.state, tempo: instance.state.tempo ?? requestedProgram.tempo });
    } catch (cause) {
      if (request === generation.current) {
        audioError.current = cause instanceof Error ? cause.message : "Could not start audio.";
      }
    } finally {
      // Keep Play locked until a cancelled start has actually settled.
      if (player.current === instance) {
        pending.current = false;
        setStarting(false);
      }
    }
  }, []);

  const stop = useCallback(() => {
    generation.current += 1;
    player.current?.stop();
    setState({ ...idle, tempo: latestProgram.current.tempo });
  }, []);

  return { state, starting, error, play, stop };
}
