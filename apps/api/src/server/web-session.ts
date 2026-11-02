import {createHash,timingSafeEqual} from 'node:crypto';
import {SignJWT,jwtVerify} from 'jose';
import {ApiError} from './domain';
const cookieName='banger_session';
const lifetime=12*60*60;
function configuration(){
  const password=process.env.BANGER_WEB_PASSWORD,secret=process.env.BANGER_SESSION_SECRET;
  if(!password||password.length<24||!secret||secret.length<32)return null;
  return {password,key:new TextEncoder().encode(secret),user:process.env.BANGER_WEB_USER??'banger-owner'};
}
export function webSessionEnabled(){return Boolean(configuration());}
export function webOrigin(request:Request){return process.env.APP_ORIGIN?new URL(process.env.APP_ORIGIN).origin:new URL(request.url).origin;}
export function assertWebOrigin(request:Request){
  if(request.headers.get('origin')!==webOrigin(request))throw new ApiError(403,'Open this request from the Banger app.');
}
export function hasWebSession(request:Request){return (request.headers.get('cookie')??'').split(';').some(part=>part.trim().startsWith(`${cookieName}=`));}
export async function sessionUser(request:Request){
  const config=configuration();
  const token=(request.headers.get('cookie')??'').split(';').map(part=>part.trim()).find(part=>part.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
  if(!config||!token)throw new ApiError(401,'Sign in to your workspace.');
  try{
    const {payload}=await jwtVerify(token,config.key,{algorithms:['HS256'],issuer:'banger-web',audience:'banger-api',requiredClaims:['sub','exp']});
    if(payload.sub!==config.user)throw Error('Unknown workspace owner.');
    return config.user;
  }catch{throw new ApiError(401,'Your session expired. Sign in again.');}
}
export function sessionCookie(request:Request,token:string){
  const url=new URL(webOrigin(request));
  const local=url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token?lifetime:0}${local?'':'; Secure'}`;
}
export async function signIn(request:Request,password:unknown){
  assertWebOrigin(request);
  const config=configuration();if(!config)throw new ApiError(503,'Workspace sign-in is not configured.');
  if(typeof password!=='string'||password.length>512)throw new ApiError(401,'Incorrect workspace password.');
  const hash=(value:string)=>createHash('sha256').update(value).digest();
  if(!timingSafeEqual(hash(password),hash(config.password)))throw new ApiError(401,'Incorrect workspace password.');
  const token=await new SignJWT({}).setProtectedHeader({alg:'HS256'}).setSubject(config.user).setIssuer('banger-web').setAudience('banger-api').setIssuedAt().setExpirationTime(`${lifetime}s`).sign(config.key);
  return sessionCookie(request,token);
}
