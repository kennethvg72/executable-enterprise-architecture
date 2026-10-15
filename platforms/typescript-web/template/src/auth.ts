// Sign-in and sessions (IAM-02, IAM-04, TS-07).
// - Production: OIDC authorization code flow with PKCE, using a certified library (SEC-10).
// - Development: a sign-in form to pick a name and role, refused outside development (TS-06).
// - Staff APIs at the edge (staff-edge, AND-05): a bearer access token from the workforce IdP,
//   checked for signature, issuer, audience and expiry. No cookies, so no CSRF.
// Sessions live in PostgreSQL; only a hash of the session ID is stored. Every POST needs
// the session's CSRF token.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import * as oidc from 'openid-client';
import type { Config } from './config.ts';
import type { Pool } from './db.ts';
import { html, page } from './html.ts';
import { HttpError, htmlResponse, redirect, text, type Handler, type Request, type Response, type Router } from './http.ts';
import { ROLES, rolesFromClaims } from './roles.ts';

export interface User { id: string; name: string; roles: string[] }
export interface Session { user: User; csrf: string }

const SESSION_COOKIE = '__Host-session';
const OIDC_COOKIE = '__Host-oidc';
const SESSION_HOURS = 8;   // the workforce IdP's session lifetime (IAM-02); change both together

const hash = (id: string) => createHash('sha256').update(id).digest('hex');
const cookie = (name: string, value: string, maxAgeSeconds: number) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;

export function createAuth(options: { pool: Pool; config: Config; appName: string; apiKeys?: JWTVerifyGetKey }) {
  const { pool, config, appName } = options;
  let oidcConfig: Promise<oidc.Configuration> | undefined;
  // Cache discovery, but not a failure: one blip at the IdP must not break sign-in until a restart.
  const discover = () => (oidcConfig ??= oidc.discovery(new URL(config.oidc!.issuer), config.oidc!.clientId, config.oidc!.clientSecret)
    .catch((err: unknown) => { oidcConfig = undefined; throw err; }));

  async function createSession(user: User): Promise<string> {
    const id = randomBytes(32).toString('base64url');
    await pool.query(
      `INSERT INTO sessions (id_hash, user_id, user_name, roles, csrf, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6))`,
      [hash(id), user.id, user.name, user.roles, randomBytes(24).toString('base64url'), SESSION_HOURS],
    );
    return cookie(SESSION_COOKIE, id, SESSION_HOURS * 3600);
  }

  async function session(req: Request): Promise<Session | undefined> {
    const id = req.cookies[SESSION_COOKIE];
    if (!id) return undefined;
    const { rows } = await pool.query<{ user_id: string; user_name: string; roles: string[]; csrf: string }>(
      'SELECT user_id, user_name, roles, csrf FROM sessions WHERE id_hash = $1 AND expires_at > now()',
      [hash(id)],
    );
    const r = rows[0];
    return r ? { user: { id: r.user_id, name: r.user_name, roles: r.roles }, csrf: r.csrf } : undefined;
  }

  /** Wrap a handler so it runs only for signed-in users with one of the given roles. */
  function protect(roles: string[], handler: (req: Request, s: Session) => Promise<Response> | Response): Handler {
    return async (req) => {
      const s = await session(req);
      if (!s) {
        if (req.method === 'GET') return redirect(`/sign-in?return=${encodeURIComponent(req.url.pathname + req.url.search)}`);
        return text('Sign in first.', 401);
      }
      // Who accessed what: the workforce id and route, never page content (IAM-07, OBS-01).
      req.log.info('access', { user: s.user.id, method: req.method, route: req.path });
      if (!roles.some((r) => s.user.roles.includes(r))) return text('You do not have access to this.', 403);
      if (req.method === 'POST') await verifyCsrf(req, s);
      return handler(req, s);
    };
  }

  // The IdP's signing keys, from its discovery document. Cached, but not a failure.
  let remoteKeys: Promise<JWTVerifyGetKey> | undefined;
  const apiKeys = (): Promise<JWTVerifyGetKey> => options.apiKeys ? Promise.resolve(options.apiKeys) : (remoteKeys ??= (async () => {
    const issuer = config.api!.issuer.replace(/\/?$/, '/');
    const res = await fetch(new URL('.well-known/openid-configuration', issuer), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
    return createRemoteJWKSet(new URL(((await res.json()) as { jwks_uri: string }).jwks_uri));
  })().catch((err: unknown) => { remoteKeys = undefined; throw err; }));

  /** Wrap an API handler so it runs only with a valid access token carrying one of the given roles. */
  function protectApi(roles: string[], handler: (req: Request, user: User) => Promise<Response> | Response): Handler {
    return async (req) => {
      if (!config.api) return text('Not found.', 404);
      const unauthorized: Response = { ...text('A valid access token is required.', 401), headers: { 'content-type': 'text/plain; charset=utf-8', 'www-authenticate': 'Bearer' } };
      const token = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(String(req.headers['authorization'] ?? ''))?.[1];
      if (!token) return unauthorized;
      let payload;
      try {
        ({ payload } = await jwtVerify(token, await apiKeys(), { issuer: config.api.issuer, audience: config.api.audience, algorithms: ['RS256'], clockTolerance: 60 }));
      } catch (err) {
        req.log.info('rejected token', { reason: err instanceof Error ? err.name : 'invalid' });
        return unauthorized;
      }
      const user: User = {
        id: String(payload['oid'] ?? payload.sub),
        name: String(payload['name'] ?? payload['preferred_username'] ?? payload.sub),
        roles: rolesFromClaims(payload['roles']),
      };
      req.log.info('access', { user: user.id, method: req.method, route: req.path });
      if (!roles.some((r) => user.roles.includes(r))) return text('You do not have access to this.', 403);
      return handler(req, user);
    };
  }

  async function verifyCsrf(req: Request, s: Session): Promise<void> {
    const form = await req.form();
    const sent = Buffer.from(form.get('csrf') ?? '');
    const expected = Buffer.from(s.csrf);
    if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) throw new HttpError(403, 'Invalid or missing CSRF token. Reload the page and try again.');
  }

  /** Only ever return to a path on this application: never to another site (open redirect). */
  const safeReturn = (value: string | null) => {
    if (!value) return '/';
    try {
      const base = new URL('https://app.invalid/');
      const target = new URL(value, base);
      if (target.origin !== base.origin) return '/';
      // Normalization can turn "/.//evil.example" into the path "//evil.example", which a browser
      // reads as another site. A path on this application starts with exactly one slash.
      return `/${target.pathname.replace(/^[/\\]+/, '')}${target.search}`;
    } catch {
      return '/';
    }
  };

  function routes(router: Router): void {
    router.get('/sign-in', async (req) => {
      const returnTo = safeReturn(req.url.searchParams.get('return'));
      if (config.oidc) {
        const conf = await discover();
        const verifier = oidc.randomPKCECodeVerifier();
        const state = oidc.randomState();
        const url = oidc.buildAuthorizationUrl(conf, {
          redirect_uri: config.oidc.redirectUri,
          scope: 'openid profile',          // roles arrive as app roles in the ID token; there is no "groups" scope
          code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
          code_challenge_method: 'S256',
          state,
        });
        return redirect(url.href, { 'set-cookie': cookie(OIDC_COOKIE, JSON.stringify({ verifier, state, returnTo }), 600) });
      }
      if (!config.devSignIn) throw new HttpError(500, 'No sign-in is configured.');
      return htmlResponse(page({
        title: appName,
        banner: 'Development sign-in. This page does not exist in production.',
        body: html`<h1>Sign in (development)</h1>
<form method="post" action="/sign-in" class="stack">
  <input type="hidden" name="return" value="${returnTo}">
  <label>Name <input name="name" required maxlength="100"></label>
  <label>Role <select name="role">${ROLES.map((r) => html`<option>${r}</option>`)}<option value="">no role</option></select></label>
  <button>Sign in</button>
</form>`,
      }));
    });

    router.post('/sign-in', async (req) => {
      if (!config.devSignIn) return text('Not found.', 404);
      const form = await req.form();
      const name = (form.get('name') ?? '').trim().slice(0, 100);
      if (!name) throw new HttpError(400, 'Name is required.');
      const role = form.get('role') ?? '';
      const user: User = { id: `dev:${name.toLowerCase().replace(/\s+/g, '.')}`, name, roles: ROLES.includes(role) ? [role] : [] };
      return redirect(safeReturn(form.get('return')), { 'set-cookie': await createSession(user) });
    });

    router.get('/auth/callback', async (req) => {
      if (!config.oidc) return text('Not found.', 404);
      let pending: { verifier: string; state: string; returnTo: string } | null = null;
      try { pending = JSON.parse(req.cookies[OIDC_COOKIE] ?? 'null'); } catch { /* treated as expired */ }
      if (!pending || typeof pending.verifier !== 'string' || typeof pending.state !== 'string') throw new HttpError(400, 'Sign-in expired. Please try again.');
      const callback = new URL(config.oidc.redirectUri);
      callback.search = req.url.search;
      const tokens = await oidc.authorizationCodeGrant(await discover(), callback, { pkceCodeVerifier: pending.verifier, expectedState: pending.state });
      const claims = tokens.claims();
      if (!claims) throw new HttpError(400, 'The identity provider returned no ID token.');
      const user: User = {
        // oid is the user's ID in the workforce directory, the same in every application; sub differs per app.
        id: String(claims['oid'] ?? claims.sub),
        name: String(claims.name ?? claims.preferred_username ?? claims.sub),
        roles: rolesFromClaims(claims['roles']),
      };
      return redirect(safeReturn(pending.returnTo), { 'set-cookie': [await createSession(user), cookie(OIDC_COOKIE, '', 0)] });
    });

    router.post('/sign-out', async (req) => {
      const s = await session(req);
      if (s) {
        await verifyCsrf(req, s);
        await pool.query('DELETE FROM sessions WHERE id_hash = $1', [hash(req.cookies[SESSION_COOKIE]!)]);
      }
      // Not straight back to /sign-in: with single sign-on, the IdP would sign the user in again.
      return redirect('/signed-out', { 'set-cookie': cookie(SESSION_COOKIE, '', 0) });
    });

    router.get('/signed-out', () => htmlResponse(page({
      title: appName,
      body: html`<h1>Signed out</h1><p><a href="/sign-in">Sign in again</a></p>`,
    })));
  }

  return { routes, protect, protectApi, session };
}

export type Auth = ReturnType<typeof createAuth>;
