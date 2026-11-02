export class AudioClock {
  static readonly lookahead = .1;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private readonly context: AudioContext, private readonly tick: () => void) {}
  start(): void {
    this.stop();
    this.timer = setInterval(() => {
      if (this.context.state === 'running') this.tick();
    }, 25);
  }
  stop(): void { if (this.timer !== undefined) clearInterval(this.timer); this.timer = undefined; }
}
