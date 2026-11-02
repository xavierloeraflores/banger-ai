import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SignJWT} from 'jose';
import {authenticate} from '../src/server/auth';
import {sessionCookie,sessionUser,signIn} from '../src/server/web-session';

test('browser sessions authenticate same-origin requests without exposing provider keys',async()=>{
  process.env.APP_ORIGIN='https://studio.example.test';
  process.env.BANGER_WEB_PASSWORD='workspace-password-with-at-least-24-characters';
  process.env.BANGER_SESSION_SECRET='independent-session-secret-with-at-least-32-characters';
  process.env.BANGER_WEB_USER='web-owner';
  const login=new Request('https://studio.example.test/api/session',{method:'POST',headers:{Origin:process.env.APP_ORIGIN}});
  await assert.rejects(signIn(login,'wrong'),/Incorrect/);
  await assert.rejects(signIn(new Request(login,{headers:{Origin:'https://attacker.example.test'}}),process.env.BANGER_WEB_PASSWORD),/Banger app/);
  const cookie=await signIn(login,process.env.BANGER_WEB_PASSWORD);
  assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Strict/);
  assert.ok(!cookie.includes(process.env.BANGER_WEB_PASSWORD));
  const headers={Cookie:cookie.split(';')[0]!,Origin:process.env.APP_ORIGIN};
  assert.equal(await authenticate(new Request('https://studio.example.test/api/projects',{headers})),'web-owner');
  assert.equal(await authenticate(new Request('https://studio.example.test/api/projects',{method:'POST',headers})),'web-owner');
  await assert.rejects(authenticate(new Request('https://studio.example.test/api/projects',{method:'POST',headers:{Cookie:headers.Cookie,Origin:'https://attacker.example.test'}})),/Banger app/);
  await assert.rejects(authenticate(new Request('https://studio.example.test/api/projects',{method:'POST',headers:{Cookie:headers.Cookie}})),/Banger app/);
  await assert.rejects(sessionUser(new Request(login,{headers:{Cookie:'banger_session=forged'}})),/expired/);
  const expired=await new SignJWT({}).setProtectedHeader({alg:'HS256'}).setSubject('web-owner').setIssuer('banger-web').setAudience('banger-api').setExpirationTime('-1s').sign(new TextEncoder().encode(process.env.BANGER_SESSION_SECRET));
  await assert.rejects(sessionUser(new Request(login,{headers:{Cookie:`banger_session=${expired}`}})),/expired/);
  assert.match(sessionCookie(login,''),/Max-Age=0/);
});
