import { HERO_COLORS, type HeroRun } from '@/lib/muse-hero';

/** A clear canvas keeps the highway compositable over any Three.js scene. */
export function drawHighway(canvas: HTMLCanvasElement, run: HeroRun, time: number, pressed: Set<number>, tempo: number) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(devicePixelRatio, 2);
  const width = Math.round(rect.width * ratio), height = Math.round(rect.height * ratio);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext('2d');
  if (!ctx || !width || !height) return;
  ctx.setTransform(width / 1000, 0, 0, height / 1000, 0, 0);
  ctx.clearRect(0, 0, 1000, 1000);
  const horizon = 300, target = 860, travel = 3;
  const point = (lane: number, progress: number) => {
    const depth = Math.max(0, progress) ** 1.65;
    return { x: 500 + (lane - 2) * (30 + 124 * depth), y: horizon + (target - horizon) * depth, scale: .22 + .78 * depth };
  };
  ctx.beginPath(); ctx.moveTo(425, horizon); ctx.lineTo(575, horizon); ctx.lineTo(940, 1000); ctx.lineTo(60, 1000); ctx.closePath();
  const floor = ctx.createLinearGradient(0, horizon, 0, 1000); floor.addColorStop(0, '#110f2810'); floor.addColorStop(1, '#110f2877');
  ctx.fillStyle = floor; ctx.fill();
  for (let lane = -.5; lane <= 4.5; lane++) {
    const a = point(lane, 0), b = point(lane, 1.13);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = lane === -.5 || lane === 4.5 ? '#d9a0ffbb' : '#d5bdff35';
    ctx.lineWidth = lane === -.5 || lane === 4.5 ? 2 : .8;
    ctx.shadowColor = '#bc6dff'; ctx.shadowBlur = 10; ctx.stroke();
  }
  ctx.shadowBlur = 0;
  const beatSeconds = 60 / tempo;
  for (let beat = Math.ceil(time / beatSeconds); beat * beatSeconds < time + travel; beat++) {
    const progress = 1 - (beat * beatSeconds - time) / travel;
    const a = point(-.5, progress), b = point(4.5, progress);
    ctx.strokeStyle = beat % 4 === 0 ? '#e4caff50' : '#e4caff18'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  const left = point(-.5, 1), right = point(4.5, 1);
  ctx.strokeStyle = '#e8d7ff'; ctx.lineWidth = 2; ctx.shadowColor = '#b188ff'; ctx.shadowBlur = 15;
  ctx.beginPath(); ctx.moveTo(left.x, left.y); ctx.lineTo(right.x, right.y); ctx.stroke();
  const gem = (lane: number, progress: number, receptor = false, active = false) => {
    const p = point(lane, progress), color = HERO_COLORS[lane]!;
    ctx.shadowColor = color; ctx.shadowBlur = active ? 30 : 12;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, (receptor ? 52 : 37) * p.scale, (receptor ? 18 : 12) * p.scale, 0, 0, Math.PI * 2);
    ctx.fillStyle = active ? '#ffffffd9' : color + (receptor ? '25' : 'a8'); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = receptor ? 3 : 2; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(p.x, p.y - 3 * p.scale, (receptor ? 44 : 30) * p.scale, (receptor ? 12 : 7) * p.scale, 0, Math.PI, Math.PI * 2);
    ctx.strokeStyle = '#ffffffcc'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  for (let lane = 0; lane < 5; lane++) {
    const flash = time - (run.flashes.get(lane) ?? -Infinity);
    const active = pressed.has(lane) || run.holds.has(lane) || flash >= 0 && flash < .18;
    gem(lane, 1, true, active);
    if (active) {
      const p = point(lane, 1);
      const glow = ctx.createLinearGradient(0, p.y - 130, 0, p.y);
      glow.addColorStop(0, HERO_COLORS[lane]! + '00'); glow.addColorStop(1, HERO_COLORS[lane]! + '80');
      ctx.fillStyle = glow; ctx.fillRect(p.x - 16, p.y - 130, 32, 130);
    }
  }
  for (const note of run.chart.notes) {
    const holding = run.holds.get(note.lane)?.id === note.id;
    if (run.judged.has(note.id) && !holding || note.time > time + travel || note.end < time - .22) continue;
    const progress = holding ? 1 : 1 - (note.time - time) / travel;
    if (note.end > note.time + .1) {
      const head = point(note.lane, Math.min(1.06, progress));
      const tail = point(note.lane, Math.max(0, 1 - (note.end - time) / travel));
      ctx.beginPath(); ctx.moveTo(tail.x, tail.y); ctx.lineTo(head.x, head.y);
      ctx.strokeStyle = HERO_COLORS[note.lane]! + '99'; ctx.lineWidth = 9 * head.scale;
      ctx.shadowColor = HERO_COLORS[note.lane]!; ctx.shadowBlur = 16; ctx.stroke();
      ctx.strokeStyle = '#ffffffb0'; ctx.lineWidth = 2 * head.scale; ctx.stroke();
    }
    gem(note.lane, progress, false, holding);
  }
  ctx.shadowBlur = 0;
}
