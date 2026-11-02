import "./audio-worklet";
import { useState } from "react";
import type { MusicProgram } from "@banger/compiler";
import { renderWav } from "@banger/engine";
import { Button, Select } from "@banger/shadcn";

function download(wav: ArrayBuffer, name: string) {
  const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function AudioExport({ program, fileName, disabled }: { program: MusicProgram; fileName: string; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [sampleRate, setSampleRate] = useState(44100);
  const [stem, setStem] = useState("");
  async function render(individual: boolean) {
    if (busy) return;
    setBusy(true); setStatus("Rendering audio…");
    const name = fileName.replace(/\.banger$/i, "").replace(/[^\w.-]/g, "_");
    try {
      if (individual) {
        const selected = program.tracks.some(track => track.name === stem) ? stem : program.tracks[0]?.name;
        if (!selected) throw new Error("Choose a track to export.");
        const audio = await renderWav(program, { sampleRate, stem: selected });
        download(audio.wav, `${name}-${selected}.wav`);
        setStatus(`Exported ${selected} stem with routing and ${audio.tailSeconds.toFixed(1)} seconds of effect tails.`);
      } else {
        const audio = await renderWav(program, { sampleRate });
        download(audio.wav, `${name}.wav`); setStatus(`Exported stereo WAV with ${audio.tailSeconds.toFixed(1)} seconds of effect tails.`);
      }
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : "Audio export failed."); }
    finally { setBusy(false); }
  }
  return <details className="studio-export"><summary>Export audio</summary><fieldset disabled={disabled || busy}>
    <div className="studio-inline"><label>Sample rate <Select aria-label="Export sample rate" value={sampleRate} onChange={e => setSampleRate(Number(e.target.value))}><option value={44100}>44.1 kHz</option><option value={48000}>48 kHz</option></Select></label>
      <Button variant="secondary" onClick={() => void render(false)}>Export WAV</Button>
      <Select aria-label="Stem track" value={program.tracks.some(track => track.name === stem) ? stem : program.tracks[0]?.name ?? ""} onChange={e => setStem(e.target.value)}>{program.tracks.map(track => <option key={track.name}>{track.name}</option>)}</Select>
      <Button variant="secondary" disabled={!program.tracks.length} onClick={() => void render(true)}>Export stem</Button>
    </div><p>Exports the active song chain or selected pattern with saved mixer and sound settings. The metronome is excluded.</p>
  </fieldset><p role="status" className="studio-export-status">{status}</p></details>;
}
