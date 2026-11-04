import { browserArtworkCredentials, loadServerAIStatus } from '@/lib/ai-providers';
import type { WebWorkspace } from './web-workspace';
import { cloudMusic, cloudVocalRequest } from '@/lib/elevenlabs';
import { cloudHeaders, uploadWav, type CloudBinding } from '@/lib/cloud-projects';
import type { MusicHistory, MusicOperation, MusicVersion } from '@banger/elevenlabs/protocol';
import type {} from '@/components/producer/song-library';
import type {} from '@/lib/song-storage';

type SongToken = { projectId: string; path: string; source: string };
type Job = { id: string; musicId?: string; status: string; stage: string; progress: number; error?: string; result?: {musicId?:string;version?:number} };
const operation = (job: Job): MusicOperation => ({ id: job.id, musicId: job.result?.musicId ?? job.musicId ?? '', status: job.status as MusicOperation['status'], stage: job.stage, progress: job.progress, error: job.error, resultVersion: job.result?.version });

export function installWebMusic(accountId: string, workspace: WebWorkspace) {
  const { request } = workspace;
  const connection = { url: '', accountId };
  function queueArtwork(recordId: string) {
    const credentials = browserArtworkCredentials();
    if (credentials) { void request(`/library/${recordId}/artwork`, 'POST', credentials).catch(() => {}); return; }
    void loadServerAIStatus().then(status => { if (status?.artwork) void request(`/library/${recordId}/artwork`, 'POST', {}).catch(() => {}); });
  }
  async function saveToLibrary(input: unknown) {
    const entry = await request<{name:string;recordId:string;scope:string}>('/library', 'POST', input);
    queueArtwork(entry.recordId);
    return entry;
  }
  const tokens = new Map<string, SongToken>();
  const archived = new Map<string, string>();
  const backends = new Map<string, ReturnType<typeof cloudMusic>>();
  function resolve(token?: string) { const song = token ? tokens.get(token) : undefined; if (!song) throw new Error('Reopen the project song before continuing.'); return song; }
  async function binding(token: string): Promise<CloudBinding> {
    const song = resolve(token);
    const snapshot = await request<{revision:number;files:{path:string;source:string}[]}>(`/projects/${song.projectId}`);
    if (!snapshot.files.some(file => file.path === song.path)) throw new Error('The song is no longer in this project.');
    return { ...connection, ...song, revision: snapshot.revision };
  }
  async function backend(token?: string) {
    if (!token) throw new Error('Wait for the song to load.');
    const bound = await binding(token);
    // Each backend keeps its own song IDs, so polling cannot follow another song.
    const key = `${token}:${bound.revision}`;
    if (!backends.has(key)) backends.set(key, cloudMusic(bound, bound.path, { allowHosted: true }));
    return backends.get(key)!;
  }
  async function audio(artifactId: string) {
    const response = await fetch(`/api/artifacts/${artifactId}`, { cache: 'no-store', headers: cloudHeaders(connection), redirect: 'error' });
    if (!response.ok) throw new Error('The saved audio is unavailable.');
    return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get('content-type') ?? 'audio/wav' };
  }
  async function version(id: string, number: number) {
    const history = await request<{versions:{document:MusicVersion}[];original:MusicVersion}>(`/music/${id}/versions?before=${number + 1}`);
    const selected = history.versions.find(item => item.document.version === number)?.document;
    if (!selected) throw new Error('This saved music version is unavailable.');
    return selected;
  }
  async function archive(token: string, bytes: Uint8Array) {
    const bound = await binding(token);
    const buffer = new Uint8Array(bytes).buffer;
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(value => value.toString(16).padStart(2, '0')).join('');
    const key = `${bound.projectId}:${bound.path}:${hash}`;
    let id = archived.get(key);
    if (!id) {
      id = await uploadWav(bound, buffer, () => {});
      await request(`/projects/${bound.projectId}/audio-history?path=${encodeURIComponent(bound.path)}`, 'POST', { artifactId: id });
      archived.set(key, id);
    }
    return id;
  }
  async function prepare(name: string, source?: string) {
    const current = workspace.current();
    const active = current.files.find(file => file.path === workspace.activePath());
    const file = current.files.find(file => file.path === name) ?? (active?.path.split('/').pop() === name ? active : undefined);
    if (!file) throw new Error('Open the song in this project before exporting.');
    const token = crypto.randomUUID(); tokens.set(token, { projectId: current.projectId, path: file.path, source: source ?? file.source });
    return token;
  }
  window.bangerStorage = {
    prepare,
    audio: async (token, bytes) => `instrumentals/${await archive(token, bytes)}.wav`,
    async readDraft(token) { const song = resolve(token); return (await request<{draft:import('@/lib/song-storage').LyricDraft|null}>(`/projects/${song.projectId}/draft?path=${encodeURIComponent(song.path)}`)).draft; },
    async saveDraft(token, draft, expected) { const song = resolve(token); await request(`/projects/${song.projectId}/draft?path=${encodeURIComponent(song.path)}`, 'PUT', { draft, expected }); },
    async retireDraft(token, expected) { const song = resolve(token); await request(`/projects/${song.projectId}/draft?path=${encodeURIComponent(song.path)}`, 'DELETE', { expected }); },
    async addToLibrary(name, source, bytes, prepared) {
      const token = prepared ?? await prepare(name, source);
      return saveToLibrary( { name: name.replace(/\.banger$/i, ''), artifactId: await archive(token, bytes), beat: { name, source } });
    },
    async history(token) {
      const song = resolve(token);
      const entries = await request<{audio:{id:string}[]}>(`/projects/${song.projectId}/audio-history?path=${encodeURIComponent(song.path)}`);
      const api = await backend(token);
      const songs = await api.list();
      const versions: MusicVersion[] = [];
      for (const song of songs) { let before: number|undefined; do { const history: MusicHistory = await api.versions(song.id, before); versions.push(...history.versions); before = history.nextBefore; } while (before); }
      return { instrumentals: entries.audio.map(entry => `${entry.id}.wav`), vocals: [...new Set(versions.filter(item => item.audioType === 'audio/mpeg').map(item => `${item.audioId}.mp3`))], lyrics: versions.map(item => `${item.id}-v${item.version}.json`) };
    },
    async copyToLibrary(token, scope, selection) {
      const song = resolve(token);
      const history = await window.bangerStorage!.history(token);
      const [kind, file] = selection.audio.split('/');
      if (!file || !(kind === 'instrumentals' ? history.instrumentals : kind === 'vocals' ? history.vocals : []).includes(file)) throw new Error('Choose saved audio from this song.');
      const artifactId = file.replace(/\.(wav|mp3)$/, '');
      let musicId: string|undefined, selectedVersion: number|undefined;
      if (selection.lyrics) {
        const name = selection.lyrics.replace(/^lyrics\//, '');
        if (!history.lyrics.includes(name)) throw new Error('Choose saved lyrics from this song.');
        const match = name.match(/^(.+)-v(\d+)\.json$/)!; musicId = match[1]; selectedVersion = Number(match[2]);
      }
      return saveToLibrary( { artifactId, scope, name: song.path.replace(/\.banger$/, ''), beat: { name: song.path.split('/').pop()!, source: song.source }, ...(musicId ? { musicId, version: selectedVersion } : {}) });
    },
  };
  window.bangerMusic = {
    list: async token => (await backend(token)).list(),
    get: id => request(`/music/${id}`),
    versions: async (id, before) => { const history = await request<{versions:{document:MusicVersion}[];original:MusicVersion;nextBefore?:number}>(`/music/${id}/versions${before ? `?before=${before}` : ''}`); return { ...history, versions: history.versions.map(item => item.document) }; },
    async importWav(key, token) {
      const file = await new Promise<File|null>(resolve => {
        const input = document.createElement('input'); input.type = 'file'; input.accept = '.wav,audio/wav';
        input.onchange = () => resolve(input.files?.[0] ?? null); input.oncancel = () => resolve(null); input.click();
      });
      if (!file) return null;
      if (file.size > 100 * 1024 * 1024) throw new Error('Choose a WAV up to 100 MiB.');
      return window.bangerMusic!.rendered(new Uint8Array(await file.arrayBuffer()), file.name, key, token);
    },
    async rendered(bytes, _name, key, token, beat) {
      const song = resolve(token), bound = await binding(token!);
      const artifactId = await archive(token!, bytes);
      return operation(await cloudVocalRequest<Job>(bound, `/projects/${song.projectId}/jobs`, { kind: 'elevenlabs', idempotencyKey: key, input: { artifactId, studioPath: song.path, ...(beat ? { beat } : {}) } }, { allowHosted: true }));
    },
    async act(id, action, key) {
      const payload = { action, idempotencyKey: key };
      return operation(await (action.operation === 'edit' ? request<Job>(`/music/${id}/actions`, 'POST', payload) : cloudVocalRequest<Job>(connection, `/music/${id}/actions`, payload, { allowHosted: true })));
    },
    // Full Send submits actions through the native-compatible bridge. Refresh
    // the cloud adapter's song IDs so it can associate those jobs after a save
    // changes the project revision or creates the first composition.
    operations: async token => { const api = await backend(token); await api.list(); return api.operations(); },
    operation: async id => operation(await request<Job>(`/jobs/${id}`)),
    audio: async (id, number) => audio((await version(id, number)).audioId),
    async save(id, number) {
      const selected = await version(id, number), data = await audio(selected.audioId);
      const url = URL.createObjectURL(new Blob([new Uint8Array(data.bytes)], { type: data.contentType }));
      const link = document.createElement('a'); link.href = url; link.download = `${selected.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}-v${number}.${data.contentType === 'audio/wav' ? 'wav' : 'mp3'}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); return true;
    },
    async addToLibrary(id, number) { const song = await version(id, number); return saveToLibrary( { name: song.name, artifactId: song.audioId, musicId: song.id, version: song.version }); },
  };
  window.bangerLibrary = {
    async renameRecord(id, name) { await request(`/library/${id}/record`, 'PATCH', { name }); },
    async regenerateArtwork(id) {
      await request(`/library/${id}/regenerate`, 'POST', browserArtworkCredentials() ?? {});
    },
    list: async () => {
      const { songs } = await request<{songs:Awaited<ReturnType<NonNullable<Window['bangerLibrary']>['list']>>}>('/library');
      for (const recordId of new Set(songs.filter(song => (!song.artwork || song.artworkPending) && (song.artworkAttempts ?? 0) < 3).map(song => song.recordId))) if(recordId)queueArtwork(recordId);
      return songs;
    },
    async read(id) { const entry = await request<{artifactId:string;beat?:{name:string;source:string};lyrics?:unknown}>(`/library/${id}`); return { ...await audio(entry.artifactId), beat: entry.beat, lyrics: entry.lyrics }; },
  };
}
