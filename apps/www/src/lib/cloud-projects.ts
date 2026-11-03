import { upload } from '@vercel/blob/client';
export type CloudConnection = { url: string; token?: string };
export type CloudBinding = CloudConnection & { projectId: string; revision: number; path: string; source: string };
export type CloudFile = { path: string; source: string };
export type CloudSnapshot = { projectId: string; name: string; revision: number; files: CloudFile[]; deleted: string[] };
export type CloudJob = { id: string; kind: string; status: string; stage: string; progress: number; error?: string; activity: string[]; result?: {revision?:number;artifactId?:string;candidateAvailable?:boolean} };
export class CloudError extends Error { constructor(public status: number, message: string) { super(message); } }
export function cloudUrl(connection: CloudConnection, path: string) { return `${connection.url.replace(/\/$/,'')}/api${path}`; }
export function cloudHeaders(connection:CloudConnection):Record<string,string>{return connection.token?{Authorization:`Bearer ${connection.token}`}:{}}
export async function cloudRequest<T>(connection: CloudConnection, path: string, method = 'GET', data?: unknown, headers?: Record<string,string>): Promise<T> {
  const response = await fetch(cloudUrl(connection,path), { method, credentials:'same-origin', ...(headers ? {redirect:'error' as const} : {}), headers: {...cloudHeaders(connection), ...headers, ...(data === undefined ? {} : {'Content-Type':'application/json'})}, ...(data === undefined ? {} : {body:JSON.stringify(data)}), cache:'no-store' });
  const body = await response.json();
  if (!response.ok) throw new CloudError(response.status,body.error ?? 'The cloud request failed.');
  return body as T;
}
export async function uploadWav(binding: CloudBinding, wav: ArrayBuffer, onProgress: (percentage:number)=>void) {
  const reserved = await cloudRequest<{id:string;pathname:string}>(binding,`/projects/${binding.projectId}/artifacts`,'POST',{revision:binding.revision});
  await upload(reserved.pathname,new Blob([wav],{type:'audio/wav'}),{access:'private',handleUploadUrl:cloudUrl(binding,'/uploads'),headers:cloudHeaders(binding),clientPayload:JSON.stringify({artifactId:reserved.id}),multipart:true,onUploadProgress:event=>onProgress(event.percentage)});
  await cloudRequest(binding,`/artifacts/${reserved.id}/complete`,'POST',{});
  return reserved.id;
}
export async function audioUrl(connection:CloudConnection,id:string) {
  const response=await fetch(cloudUrl(connection,`/artifacts/${id}`),{headers:cloudHeaders(connection),credentials:'same-origin',cache:'no-store'});
  if (!response.ok) throw new Error('The audio could not be loaded.');
  return URL.createObjectURL(await response.blob());
}
/** Keep drafts against the revision they were based on until the user explicitly reloads. */
export function mergeCloudDelta(current: CloudSnapshot, delta: CloudSnapshot): CloudSnapshot {
  if (current.projectId !== delta.projectId || delta.revision < current.revision) return current;
  const files = new Map(current.files.map(file=>[file.path,file]));
  for (const path of delta.deleted) files.delete(path);
  for (const file of delta.files) files.set(file.path,file);
  return {...delta,files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path)),deleted:[]};
}
