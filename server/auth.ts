import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { Router } from "express";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import { ensureUser, findUserByOpenId, type AppUser } from "./database.js";

export type { AppUser } from "./database.js";

export const SESSION_COOKIE = "webdev_app_session";
const STATE_COOKIE = "gotopik_oauth_state";
const CALLBACK_PATH = "/api/auth/callback";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const STATE_MAX_AGE_SECONDS = 10 * 60;
const textEncoder = new TextEncoder();

type SessionClaims = JWTPayload & {
  appId: string;
  openId: string;
  name?: string;
};

type OAuthState = {
  redirectUri: string;
  nonce: string;
  issuedAt: number;
  signature: string;
};

type CookieRequest = Request & { cookies?: Record<string, string | undefined> };

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function secret(): Uint8Array {
  return textEncoder.encode(requiredEnv("MANUS_JWT_SECRET"));
}

function isHttpsOrigin(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
      (url.pathname === "" || url.pathname === "/") && url.port !== "80";
  } catch {
    return false;
  }
}

function configuredOrigins(): Set<string> {
  return new Set(
    ["https://gotopik-a749akip.manus.space", "https://8328-ilfzq7bjfvvq6c0z1g3dy-4a0f1f75.us3.manus.computer", process.env.PUBLIC_ORIGIN ?? "", ...(process.env.ALLOWED_ORIGINS ?? "").split(",")]
      .map((value) => value.trim().replace(/\/$/u, ""))
      .filter((value): value is string => isHttpsOrigin(value)),
  );
}

function requestOrigin(req: Request): string | null {
  const input = typeof req.query.origin === "string" ? req.query.origin : undefined;
  if (!isHttpsOrigin(input)) return null;
  const origin = input.replace(/\/$/u, "");
  const browserOrigin = req.get("origin")?.trim().replace(/\/$/u, "");
  if (browserOrigin && browserOrigin !== origin) return null;
  const configured = configuredOrigins();
  if (!configured.has(origin)) return null;
  // A caller must explicitly provide the browser-visible origin. Internal host headers are never used.
  return origin;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function parseBase64UrlJson<T>(value: string): T | null {
  try { return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T; } catch { return null; }
}

function stateSignature(nonce: string): string {
  return createHmac("sha256", secret()).update(`oauth-state:${nonce}`).digest("base64url");
}

function payloadSignature(state: Pick<OAuthState, "redirectUri" | "nonce" | "issuedAt">): string {
  return createHmac("sha256", secret()).update(JSON.stringify({ redirectUri: state.redirectUri, nonce: state.nonce, issuedAt: state.issuedAt })).digest("base64url");
}

function signedNonce(nonce: string): string {
  return `${nonce}.${stateSignature(nonce)}`;
}

function validSignedNonce(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const [nonce, signature] = value.split(".");
  if (!nonce || !signature || !/^[A-Za-z0-9_-]{32,128}$/u.test(nonce)) return null;
  const expected = stateSignature(nonce);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  return nonce;
}

function getCookie(req: CookieRequest, name: string): string | undefined {
  const parsed = req.cookies?.[name];
  if (parsed) return parsed;
  const header = req.headers.cookie ?? "";
  const match = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    path: "/",
    maxAge,
  };
}

function clearCookie(res: Response, name: string): void {
  res.clearCookie(name, { httpOnly: true, secure: true, sameSite: "none", path: "/" });
}

function callbackUri(origin: string): string {
  return `${origin}${CALLBACK_PATH}`;
}

function safeString(value: unknown, max = 255): string | undefined {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : undefined;
}

async function exchangeCode(code: string, redirectUri: string): Promise<{ accessToken: string }> {
  const endpoint = `${requiredEnv("MANUS_OAUTH_API_URL").replace(/\/$/u, "")}/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId: requiredEnv("MANUS_PROJECT_ID"),
      grantType: "authorization_code",
      code,
      redirectUri,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`OAuth token exchange failed (${response.status})`);
  const body = await response.json() as { accessToken?: unknown; error?: unknown };
  if (typeof body.accessToken !== "string" || !body.accessToken) throw new Error("OAuth token exchange returned no token");
  return { accessToken: body.accessToken };
}

async function getManusUser(accessToken: string): Promise<{ openId: string; name?: string }> {
  const endpoint = `${requiredEnv("MANUS_OAUTH_API_URL").replace(/\/$/u, "")}/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accessToken }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`OAuth identity lookup failed (${response.status})`);
  const body = await response.json() as { openId?: unknown; name?: unknown };
  const openId = safeString(body.openId);
  if (!openId) throw new Error("OAuth identity lookup returned no openId");
  return { openId, name: safeString(body.name, 200) };
}

async function sessionToken(openId: string, name?: string): Promise<string> {
  const claims: SessionClaims = {
    appId: requiredEnv("MANUS_PROJECT_ID"),
    openId,
    ...(name ? { name } : {}),
  };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secret());
}

async function verifiedClaims(req: CookieRequest): Promise<SessionClaims | null> {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;
  try {
    const result = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
      issuer: undefined,
      audience: undefined,
    });
    const payload = result.payload as SessionClaims;
    if (payload.appId !== requiredEnv("MANUS_PROJECT_ID")) return null;
    if (!safeString(payload.openId)) return null;
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Resolve a valid session to the application's persisted user and role. */
export async function getUser(req: Request): Promise<AppUser | null> {
  const claims = await verifiedClaims(req as CookieRequest);
  if (!claims?.openId) return null;
  try {
    const user = await findUserByOpenId(claims.openId) ?? await ensureUser(claims.openId, claims.name || "O‘quvchi");
    return { ...user, isAdmin: (process.env.ADMIN_OPEN_IDS || "").split(",").map(value => value.trim()).includes(claims.openId) };
  } catch {
    // Authentication fails closed when the database is unavailable.
    return null;
  }
}

export const requireUser: RequestHandler = async (req, res, next) => {
  const user = await getUser(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  res.locals.user = user;
  next();
};

function authError(res: Response, status = 400): void {
  res.status(status).json({ error: "Authentication failed" });
}

export const authRouter = Router();

authRouter.get("/login", (req, res) => {
  try {
    const origin = requestOrigin(req);
    if (!origin) { authError(res, 400); return; }
    const nonce = randomBytes(32).toString("base64url");
    const redirectUri = callbackUri(origin);
    const issuedAt = Date.now();
    const state: OAuthState = { redirectUri, nonce, issuedAt, signature: payloadSignature({ redirectUri, nonce, issuedAt }) };
    res.cookie(STATE_COOKIE, signedNonce(nonce), cookieOptions(STATE_MAX_AGE_SECONDS * 1000));
    const portal = new URL(`${requiredEnv("MANUS_OAUTH_PORTAL_URL").replace(/\/$/u, "")}/app-auth`);
    portal.searchParams.set("appId", requiredEnv("MANUS_PROJECT_ID"));
    portal.searchParams.set("redirectUri", redirectUri);
    portal.searchParams.set("state", base64UrlJson(state));
    portal.searchParams.set("responseType", "code");
    res.redirect(portal.toString());
  } catch {
    authError(res, 503);
  }
});

authRouter.get("/callback", async (req, res) => {
  try {
    const code = safeString(req.query.code, 4096);
    const stateValue = safeString(req.query.state, 8192);
    if (!code || !stateValue) { authError(res); return; }
    const state = parseBase64UrlJson<OAuthState>(stateValue);
    const cookieNonce = validSignedNonce(getCookie(req as CookieRequest, STATE_COOKIE));
    const stateOrigin = state?.redirectUri.endsWith(CALLBACK_PATH)
      ? state.redirectUri.slice(0, -CALLBACK_PATH.length) : "";
    if (!state || !isHttpsOrigin(stateOrigin) || !configuredOrigins().has(stateOrigin) || !cookieNonce ||
      state.nonce !== cookieNonce || state.signature !== payloadSignature(state) ||
      state.redirectUri !== callbackUri(stateOrigin)) {
      authError(res); return;
    }
    if (!Number.isFinite(state.issuedAt) || state.issuedAt > Date.now() + 30000 || Date.now() - state.issuedAt > STATE_MAX_AGE_SECONDS * 1000) {
      authError(res); return;
    }
    clearCookie(res, STATE_COOKIE);
    const exchanged = await exchangeCode(code, state.redirectUri);
    const identity = await getManusUser(exchanged.accessToken);
    await ensureUser(identity.openId, identity.name);
    res.cookie(SESSION_COOKIE, await sessionToken(identity.openId, identity.name), cookieOptions(SESSION_MAX_AGE_SECONDS * 1000));
    res.redirect(`${state.redirectUri.slice(0, -CALLBACK_PATH.length)}/#reyting`);
  } catch {
    authError(res, 502);
  }
});

authRouter.post("/logout", (req, res) => {
  clearCookie(res, SESSION_COOKIE);
  res.status(204).end();
});

authRouter.get("/me", async (req, res) => {
  const user = await getUser(req);
  res.json({ user });
});

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const result = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const claims = result.payload as SessionClaims;
    return claims.appId === requiredEnv("MANUS_PROJECT_ID") && safeString(claims.openId) &&
      typeof claims.exp === "number" && claims.exp > Math.floor(Date.now() / 1000) ? claims : null;
  } catch {
    return null;
  }
}
