import { mediaObjects, type MusicObjects } from './media-objects';
export { boundedAudio, type MusicObjects } from './media-objects';
import { ElevenMusic, MusicProviderError, musicActionBase, performMusicAction, publicMusicError, type MusicProvider, type MusicVersion } from '@banger/elevenlabs';
import { db, transaction } from './db';
import { ApiError } from './domain';
import { authorize } from './projects';
import { checkpoint, elevenInput, type Job } from './jobs';
import { decideElevenKey } from './provider-keys';
import { getArtifact } from './artifacts';
export async function getMusic(user:string,musicId:string) {
  const row=(await db().query('SELECT * FROM music_sessions WHERE id=$1',[musicId])).rows[0];
  if(!row) throw new ApiError(404,'Music session not found.');
  await authorize(user,row.project_id);
  return row as {id:string;project_id:string;source_artifact_id:string;revision:number;current_version:MusicVersion|null};
}
export async function runElevenStep(job: Job, injected?: MusicProvider, objects:MusicObjects=mediaObjects, serverProvider?: MusicProvider) {
  const input=elevenInput.parse(job.input);
  const analyze='artifactId' in input;
  const needsProvider=analyze || input.action.operation!=='edit';
  let keySource: 'server' | 'client' = 'client';
  let serverKey: string | undefined;
  // Missing-key jobs wait before artifact lookup, matching recovery of a job whose upload is not ready.
  if(needsProvider && !job.checkpoint.providerStarted){
    const decision=decideElevenKey(input,job.checkpoint,Boolean(injected));
    if(decision.action==='wait'){await checkpoint(job,'awaiting-provider',0,{},'awaiting_provider',null,decision.message);return;}
    if(decision.action==='fail'){await checkpoint(job,'failed',job.progress,{keySource:'server',serverKeyRejected:true},'failed',null,decision.message);return;}
    keySource=decision.action==='use-server'?'server':'client';
    if(decision.action==='use-server') serverKey=decision.key;
  }
  const provider=()=>{
    if(!needsProvider) throw new Error('A lyric edit must not call a provider.');
    if(keySource==='server') return serverProvider ?? new ElevenMusic(serverKey!);
    if(!injected) throw new Error('Add your ElevenLabs API key in Settings to resume this song.');
    return injected;
  };
  const session=analyze ? undefined : await getMusic(job.user_id,input.musicId);
  const source=await getArtifact(job.user_id,analyze?input.artifactId:session!.source_artifact_id,true);
  if(source.project_id!==job.project_id || source.status!=='ready')throw new ApiError(400,'The source WAV is unavailable.');
  const musicId=analyze?job.id:session!.id;
  const receiptPath=`projects/${job.project_id}/music/${musicId}/operations/${job.id}.json`;
  const exists=await objects.exists(receiptPath);
  let version:MusicVersion;
  if(exists) version=JSON.parse((await objects.read(receiptPath)).toString()) as MusicVersion;
  else {
    if(job.checkpoint.providerStarted){await checkpoint(job,'needs-review',job.progress,{},'needs_review',null,'This paid request was interrupted before its result was saved. Check ElevenLabs history before submitting a new request.');return;}
    const baseVersion=analyze?0:input.action.baseVersion;
    if(!analyze && (!session!.current_version || session!.revision!==baseVersion)) throw new ApiError(409,'The composition changed before this request ran. Reload it.');
    const paid=analyze || input.action.operation!=='edit';
    if(paid) await checkpoint(job,analyze?'analyzing':'generating',25,{providerStarted:true,keySource},'running');
    try {
      let output:Uint8Array|undefined;
      if(analyze) {
        const audio=await objects.read(source.pathname);
        const result=await provider().analyze(audio,'source.wav');
        version={id:musicId,version:1,...(input.studioPath ? {studioPath:input.studioPath} : {}),name:input.beat?.name ?? 'Uploaded song',...(input.beat ? {beat:input.beat} : {}),songId:result.songId,originalSongId:result.songId,plan:result.plan,audioMetadata:result.audioMetadata,audioId:source.id,audioType:'audio/wav',audioVersion:1,createdAt:new Date().toISOString(),operation:'analyze'};
      } else {
        const source=input.action.sourceVersion?(await db().query('SELECT document FROM music_versions WHERE music_id=$1 AND revision=$2',[musicId,input.action.sourceVersion])).rows[0]?.document:session!.current_version;
        if(!source)throw new ApiError(404,'Music version not found.');
        const base=musicActionBase(session!.current_version!,source,input.action);
        if(!base.originalSongId) {
          const original=(await db().query('SELECT document FROM music_versions WHERE music_id=$1 AND revision=1',[musicId])).rows[0]?.document as MusicVersion|undefined;
          if(!original)throw new ApiError(404,'The original audio reference is unavailable.');
          base.originalSongId=original.songId;
        }
        const result=await performMusicAction(provider,base,input.action,job.id);version=result.version;output=result.audio;
      }
      if(output) await objects.write(`projects/${job.project_id}/music/${musicId}/audio/${job.id}.mp3`,Buffer.from(output),'audio/mpeg');
      await objects.write(receiptPath,JSON.stringify(version),'application/json');
      await checkpoint(job,'saving',90,{receiptPath},'running');
    } catch(error) {
      if(error instanceof ApiError)throw error;
      const uncertain=error instanceof MusicProviderError&&error.uncertain;
      const rejected=keySource==='server'&&!uncertain;
      const status=uncertain?paid?'needs_review':'failed':'failed';
      const message=rejected?'The hosted ElevenLabs key was rejected. A personal key was not used.':publicMusicError(error);
      await checkpoint(job,status,job.progress,{keySource,...(rejected?{serverKeyRejected:true}:{})},status,null,message);return;
    }
  }
  const audioPath=`projects/${job.project_id}/music/${musicId}/audio/${job.id}.mp3`;
  const audioSize=version.audioId===job.id&&version.audioType==='audio/mpeg'?await objects.size(audioPath):undefined;
  await transaction(async client=>{
    await authorize(job.user_id,job.project_id,true,client,true);
    const lease=await client.query("SELECT id FROM jobs WHERE id=$1 AND lease_token=$2 AND lease_until>now() AND status='running' FOR UPDATE",[job.id,job.lease_token]);
    if(!lease.rowCount)throw new ApiError(409,'Job lease expired.');
    if(analyze)await client.query('INSERT INTO music_sessions(id,project_id,source_artifact_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[musicId,job.project_id,source.id]);
    const current=(await client.query('SELECT revision FROM music_sessions WHERE id=$1 FOR UPDATE',[musicId])).rows[0];
    if(current.revision!==version.version-1)throw new ApiError(409,'Another composition revision was saved first. This result is retained for review.');
    if(version.audioId===job.id && version.audioType==='audio/mpeg') {
      const pathname=audioPath;
      await client.query("INSERT INTO artifacts(id,project_id,revision,user_id,kind,pathname,content_type,size,status) VALUES($1,$2,$3,$4,'elevenlabs',$5,'audio/mpeg',$6,'ready') ON CONFLICT(id) DO NOTHING",[job.id,job.project_id,source.revision,job.user_id,pathname,audioSize]);
    }
    await client.query('INSERT INTO music_versions(music_id,revision,document_path,document) VALUES($1,$2,$3,$4)',[musicId,version.version,receiptPath,version]);
    await client.query('UPDATE music_sessions SET revision=$2,current_version=$3 WHERE id=$1',[musicId,version.version,version]);
    await client.query("UPDATE jobs SET status='completed',stage='completed',progress=100,result=$3,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2",[job.id,job.lease_token,{musicId,version:version.version,artifactId:version.audioId}]);
  });
}
