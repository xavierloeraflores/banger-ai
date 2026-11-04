// Claims cover agent writes only. Readers and manual project operations do not consult them.
export class FileClaims {
  private readonly claims = new Map<string, { owner: string; expires: number }>();
  constructor(private readonly lifetimeMs = 10 * 60_000, private readonly now = Date.now) {}

  claim(project: string, path: string, owner: string): void {
    const key = JSON.stringify([project, path.toLowerCase()]);
    const current = this.claims.get(key);
    if (current && current.expires > this.now() && current.owner !== owner)
      throw new Error(`${path} is being edited in another chat.`);
    this.claims.set(key, { owner, expires: this.now() + this.lifetimeMs });
  }

  release(owner: string): void {
    for (const [key, claim] of this.claims) if (claim.owner === owner) this.claims.delete(key);
  }
}

export const desktopFileClaims = new FileClaims();
