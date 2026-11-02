import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {authenticate} from '../src/server/auth';
import {createProject} from '../src/server/projects';
import {reserveWav,uploadCallback,MAX_AUDIO_BYTES} from '../src/server/artifacts';
import {db} from '../src/server/db';
test('authentication verifies signature, issuer, audience and expiry',async t=>{
  const {privateKey,publicKey}=await generateKeyPair('RS256');
  const key=await exportJWK(publicKey);
  const server=createServer((_request,response)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify({keys:[{...key,kid:'test',alg:'RS256'}]}));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const address=server.address() as {port:number};
  process.env.AUTH_JWKS_URL=`http://127.0.0.1:${address.port}/jwks`;
  process.env.AUTH_ISSUER='banger-test';process.env.AUTH_AUDIENCE='banger-api';
  const token=async(audience='banger-api',expires='1m',subject='user-1')=>new SignJWT({}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer('banger-test').setAudience(audience).setSubject(subject).setExpirationTime(expires).sign(privateKey);
  const request=(token:string)=>new Request('http://localhost/api/projects',{headers:{Authorization:`Bearer ${token}`}});
  assert.equal(await authenticate(request(await token())),'user-1');
  await assert.rejects(authenticate(request(await token('wrong'))),/session expired/);
  await assert.rejects(authenticate(request(await token('banger-api','-1s'))),/session expired/);
  await assert.rejects(authenticate(request('unsigned.user-1.fake')),/session expired/);
  await assert.rejects(authenticate(new Request('http://localhost/api/projects')),/Sign in/);
  if(process.env.DATABASE_URL){
    t.after(()=>db().end());
    const project=await createProject('user-1','Upload security',[],{async write(){},async text(){return '';}});
    const artifact=await reserveWav('user-1',project.projectId,0);
    process.env.BLOB_READ_WRITE_TOKEN='vercel_blob_rw_fixture_test-only';
    process.env.VERCEL_BLOB_CALLBACK_URL='https://callback.example.test';
    const uploadBody={type:'blob.generate-client-token' as const,payload:{pathname:artifact.pathname,clientPayload:JSON.stringify({artifactId:artifact.id}),multipart:true}};
    const signed=await uploadCallback(request(await token()),uploadBody);
    assert.ok('clientToken' in signed);
    const signedPayload=JSON.parse(Buffer.from(Buffer.from(signed.clientToken.split('_')[4]!,'base64').toString().split('.')[1]!,'base64').toString());
    assert.equal(signedPayload.pathname,artifact.pathname);
    assert.equal(signedPayload.allowOverwrite,false);
    assert.equal(signedPayload.addRandomSuffix,false);
    assert.equal(signedPayload.maximumSizeInBytes,MAX_AUDIO_BYTES);
    assert.deepEqual(signedPayload.allowedContentTypes,['audio/wav']);
    await assert.rejects(uploadCallback(request(await token()),{...uploadBody,payload:{...uploadBody.payload,pathname:'other-project/stolen.wav'}}),/not authorized/);
    await assert.rejects(uploadCallback(request(await token('banger-api','1m','user-2')),uploadBody),/denied/);
    await assert.rejects(uploadCallback(request(await token()),{type:'blob.upload-completed',payload:{blob:{url:'https://example.test',pathname:artifact.pathname,downloadUrl:'https://example.test',contentType:'audio/wav',contentDisposition:'inline',etag:'test'},tokenPayload:JSON.stringify({artifactId:artifact.id})}}),/signature/);
  }

});
