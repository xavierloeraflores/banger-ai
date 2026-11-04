"use client";

import { useSyncExternalStore } from 'react';

export const HERO_DIFFICULTIES = [
  { value: 'very-easy', label: 'Very easy', lanes: 2 },
  { value: 'easy', label: 'Easy', lanes: 3 },
  { value: 'normal', label: 'Normal', lanes: 4 },
  { value: 'hard', label: 'Hard', lanes: 5 },
] as const;
export type HeroDifficulty = typeof HERO_DIFFICULTIES[number]['value'];
const storageKey = 'banger:muse-hero-difficulty';
const changeEvent = 'banger:muse-hero-difficulty-changed';
let sessionDifficulty: HeroDifficulty | undefined;

function readDifficulty(): HeroDifficulty {
  if (sessionDifficulty) return sessionDifficulty;
  try {
    const value = localStorage.getItem(storageKey);
    return HERO_DIFFICULTIES.find(option => option.value === value)?.value ?? 'normal';
  } catch { return 'normal'; }
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(changeEvent, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(changeEvent, onChange);
  };
}

export function setHeroDifficulty(value: HeroDifficulty) {
  try { localStorage.setItem(storageKey, value); sessionDifficulty = undefined; }
  catch { sessionDifficulty = value; }
  window.dispatchEvent(new Event(changeEvent));
}

export function useHeroDifficulty() {
  return useSyncExternalStore(subscribe, readDifficulty, () => 'normal' as const);
}
