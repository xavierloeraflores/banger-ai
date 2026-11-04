/** Visit every available song before repeating, including songs added mid-cycle. */
export class LibraryShuffle {
  private played = new Set<string>();

  next(ids: readonly string[], current?: string): string | undefined {
    const available = [...new Set(ids)];
    this.played = new Set([...this.played].filter(id => available.includes(id)));
    if (current) this.played.add(current);
    let candidates = available.filter(id => !this.played.has(id));
    if (!candidates.length) {
      this.played.clear();
      candidates = available.filter(id => id !== current);
      if (!candidates.length) candidates = available;
    }
    const next = candidates[Math.floor(Math.random() * candidates.length)];
    if (next) this.played.add(next);
    return next;
  }
}
