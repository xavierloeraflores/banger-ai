import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { ApiError } from './domain';
import { db, transaction } from './db';

const cookieName = 'banger_session';
const lifetime = 12 * 60 * 60;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function webSessionEnabled() { return Boolean(process.env.DATABASE_URL); }
export function webOrigin(request: Request) { return process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : new URL(request.url).origin; }
export function assertWebOrigin(request: Request) {
  if (request.headers.get('origin') !== webOrigin(request)) throw new ApiError(403, 'Open this request from the Banger app.');
}
function sessionToken(request: Request) {
  return (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
}
export function hasWebSession(request: Request) { return Boolean(sessionToken(request)); }
export async function sessionAccount(request: Request): Promise<{ id: string; username: string }> {
  const token = sessionToken(request);
  if (!webSessionEnabled() || !token || !/^[a-f0-9]{64}$/.test(token)) throw new ApiError(401, 'Sign in to your account.');
  const result = await db().query('SELECT a.user_id AS id, a.username FROM web_sessions s JOIN web_accounts a ON a.user_id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()', [digest(token)]);
  if (!result.rows[0]) throw new ApiError(401, 'Your session expired. Sign in again.');
  return result.rows[0];
}
export async function sessionUser(request: Request) { return (await sessionAccount(request)).id; }
export function sessionCookie(request: Request, token: string) {
  const url = new URL(webOrigin(request));
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? lifetime : 0}${local ? '' : '; Secure'}`;
}
export function accountInput(username: unknown, password: unknown) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,32}$/.test(username.trim())) throw new ApiError(400, 'Use 3–32 letters, numbers or underscores for your username.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new ApiError(400, 'Use a password with 12–128 characters.');
  return { username: username.trim().toLowerCase(), password };
}
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded?: string) {
  // Unknown accounts still pay the same password derivation cost.
  const [, salt, expected] = (encoded ?? `scrypt$${'0'.repeat(32)}$${'0'.repeat(64)}`).split('$');
  const actual = await derive(password, salt!);
  return Boolean(encoded) && timingSafeEqual(actual, Buffer.from(expected!, 'hex'));
}
async function limit(username: string) {
  // Shared database counters also apply across server instances. A global ceiling
  // bounds signup/hash work; the account ceiling bounds password guessing.
  await db().query('DELETE FROM web_auth_limits WHERE expires_at<=now()');
  for (const [bucket, max] of [['global', 300], [`account:${digest(username)}`, 10]] as const) {
    const result = await db().query(`INSERT INTO web_auth_limits(bucket,attempts,expires_at) VALUES($1,1,now()+interval '15 minutes')
      ON CONFLICT(bucket) DO UPDATE SET attempts=web_auth_limits.attempts+1 RETURNING attempts`, [bucket]);
    if (result.rows[0].attempts > max) throw new ApiError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
  }
}
async function issueSession(request: Request, userId: string) {
  const token = randomBytes(32).toString('hex');
  await transaction(async client => {
    await client.query('DELETE FROM web_sessions WHERE expires_at<=now()');
    const previous = sessionToken(request);
    if (previous) await client.query('DELETE FROM web_sessions WHERE token_hash=$1', [digest(previous)]);
    await client.query("INSERT INTO web_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')", [digest(token), userId]);
  });
  return sessionCookie(request, token);
}
export async function signIn(request: Request, username: unknown, password: unknown, register = false) {
  assertWebOrigin(request);
  if (!webSessionEnabled()) throw new ApiError(503, 'Account sign-in is not configured.');
  const input = accountInput(username, password);
  await limit(input.username);
  let userId: string;
  if (register) {
    const passwordHash = await hashPassword(input.password);
    userId = `web:${randomUUID()}`;
    try {
      await transaction(async client => {
        await client.query('INSERT INTO users(id) VALUES($1)', [userId]);
        await client.query('INSERT INTO web_accounts(user_id,username,password_hash) VALUES($1,$2,$3)', [userId, input.username, passwordHash]);
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ApiError(409, 'That username is unavailable. Choose another or sign in.');
      throw error;
    }
  } else {
    const result = await db().query('SELECT user_id,password_hash FROM web_accounts WHERE username=$1', [input.username]);
    if (!await verifyPassword(input.password, result.rows[0]?.password_hash)) throw new ApiError(401, 'Incorrect username or password.');
    userId = result.rows[0].user_id;
  }
  return issueSession(request, userId);
}
export async function signOut(request: Request) {
  assertWebOrigin(request);
  const token = sessionToken(request);
  if (token && webSessionEnabled()) await db().query('DELETE FROM web_sessions WHERE token_hash=$1', [digest(token)]);
  return sessionCookie(request, '');
}
