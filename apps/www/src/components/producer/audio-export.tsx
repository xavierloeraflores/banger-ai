import "./audio-worklet";
import { saveLibraryBundle } from "@/lib/browser-library";
import { ProjectIcon } from "./project-icon";
import { useState } from "react";
import type { MusicProgram } from "@banger/compiler";
import { prepareSong, archiveWav } from "@/lib/song-storage";
import { renderWav } from "@banger/engine";
import { uploadWav, type CloudBinding } from "@/lib/cloud-projects";
import { Button, Select } from "@banger/shadcn";

function download(wav: ArrayBuffer, name: string) {
  const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function AudioExport({ program, fileName, source, disabled, cloud, compact = false }: { program: MusicProgram; fileName: string; source: string; disabled: boolean; cloud?: CloudBinding | null; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [sampleRate, setSampleRate] = useState(44100);
  const [stem, setStem] = useState("");
  async function render(individual: boolean, upload = false, library = false) {
    if (busy) return;
    setBusy(true); setStatus("Rendering audio…");
    const name = fileName.replace(/\.banger$/i, "").replace(/[^\w.-]/g, "_");
    try {
      const token = await prepareSong(fileName, source);
      if (individual) {
        const selected = program.tracks.some(track => track.name === stem) ? stem : program.tracks[0]?.name;
        if (!selected) throw new Error("Choose a track to export.");
        const audio = await renderWav(program, { sampleRate, stem: selected });
        await archiveWav(token, audio.wav);
        download(audio.wav, `${name}-${selected}.wav`);
        setStatus(`Exported ${selected} stem with routing and ${audio.tailSeconds.toFixed(1)} seconds of effect tails.`);
      } else {
        const audio = await renderWav(program, { sampleRate });
        await archiveWav(token, audio.wav);
        if (upload && cloud) {
          await uploadWav(cloud, audio.wav, percentage => setStatus(`Uploading WAV: ${Math.round(percentage)}%`));
          setStatus(`WAV uploaded to cloud revision ${cloud.revision}.`); return;
        }
        if (library) {
          if (window.bangerStorage) await window.bangerStorage.addToLibrary(fileName, source, new Uint8Array(audio.wav));
          else await saveLibraryBundle(name, audio.wav, { [`${name}.banger`]: source, [`${name}.wav`]: audio.wav }, { name: `${name}.banger`, source });
        }
        download(audio.wav, `${name}.wav`); setStatus(library ? "Exported and saved to library." : `Exported stereo WAV with ${audio.tailSeconds.toFixed(1)} seconds of effect tails.`);
      }
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : "Audio export failed."); }
    finally { setBusy(false); }
  }
  const menu = <Select aria-label="Export song" value="" disabled={disabled || busy} onChange={event => { const library = event.target.value === 'library'; void render(false, false, library); }}>
    <option value="" disabled>Export…</option><option value="export">Export</option><option value="library">Export and save to library</option>
  </Select>;
  if (compact) return <div>{menu}<span role="status">{status}</span></div>;
  return <section className="studio-export" aria-labelledby="project-export-title">
    <h2 id="project-export-title"><ProjectIcon name="audio" />Export Controls</h2>
    <fieldset disabled={disabled || busy}>
      <div className="project-export-controls">
        <div className="project-export-group project-export-song">
          <label>Sample rate<Select aria-label="Export sample rate" value={sampleRate} onChange={e => setSampleRate(Number(e.target.value))}><option value={44100}>44.1 kHz</option><option value={48000}>48 kHz</option></Select></label>
          {menu}
        </div>
        <div className="project-export-group">
          <label>Stem<Select aria-label="Stem track" value={program.tracks.some(track => track.name === stem) ? stem : program.tracks[0]?.name ?? ""} onChange={e => setStem(e.target.value)}>{program.tracks.map(track => <option key={track.name}>{track.name}</option>)}</Select></label>
          <Button variant="secondary" disabled={!program.tracks.length} onClick={() => void render(true)}><ProjectIcon name="layers" />Export stem</Button>
        </div>
      </div>
      {cloud && <Button className="project-cloud-export" variant="secondary" onClick={() => void render(false, true)}>Upload WAV to cloud</Button>}
      <p className="project-export-help"><ProjectIcon name="info" />Exports the active song chain or selected pattern with saved mixer and sound settings. The metronome is excluded.</p>
    </fieldset>
    <p role="status" className="studio-export-status">{status}</p>
  </section>;
}
