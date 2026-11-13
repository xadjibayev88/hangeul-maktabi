import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./app.js";
import { SignJWT, type JWTPayload } from "jose";
import { verifySessionToken } from "./auth.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

test("anonymous paid AI and cross-site forms are blocked without provider calls", async () => {
  const server = createServer(createApp());
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const [header, expected] of [[{}, 403], [{ "X-GoTopic-Request": "1" }, 401]] as const) {
      const response = await fetch(base + "/api/ai/json", { method: "POST", headers: { "Content-Type": "application/json", ...header }, body: JSON.stringify({ prompt: "test" }) });
      assert.equal(response.status, expected);
    }
    assert.equal((await fetch(base + "/api/auth/login?origin=https://attacker.example", { redirect: "manual" })).status, 400);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
test("JWT requires the correct app, openId and an unexpired exp", async () => {
  const oldId = process.env.MANUS_PROJECT_ID, oldSecret = process.env.MANUS_JWT_SECRET;
  process.env.MANUS_PROJECT_ID = "unit-test-app"; process.env.MANUS_JWT_SECRET = "unit-test-secret-not-a-live-credential";
  try {
    const sign = (claims: JWTPayload) => new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(process.env.MANUS_JWT_SECRET));
    const valid = await sign({ appId: "unit-test-app", openId: "unit-user", exp: Math.floor(Date.now()/1000)+60 });
    assert.ok(await verifySessionToken(valid));
    assert.equal(await verifySessionToken(await sign({ appId: "wrong", openId: "unit-user", exp: Math.floor(Date.now()/1000)+60 })), null);
    assert.equal(await verifySessionToken(await sign({ appId: "unit-test-app", openId: "unit-user" })), null);
    assert.equal(await verifySessionToken(await sign({ appId: "unit-test-app", openId: "unit-user", exp: 1 })), null);
  } finally { process.env.MANUS_PROJECT_ID = oldId; process.env.MANUS_JWT_SECRET = oldSecret; }
});

test("OAuth callback rejects a tampered origin or state before exchanging a code", async () => {
  const server = createServer(createApp());
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const origin = "https://8328-ilfzq7bjfvvq6c0z1g3dy-4a0f1f75.us3.manus.computer";
  try {
    const login = await fetch(base + "/api/auth/login?origin=" + encodeURIComponent(origin), { redirect: "manual" });
    assert.equal(login.status, 302);
    const location = new URL(login.headers.get("location")!);
    const state = JSON.parse(Buffer.from(location.searchParams.get("state")!, "base64url").toString());
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    for (const patch of [{ redirectUri: "https://attacker.example/api/auth/callback" }, { signature: "invalid" }, { issuedAt: Date.now() + 86400000 }]) {
      const encoded = Buffer.from(JSON.stringify({ ...state, ...patch })).toString("base64url");
      const response = await fetch(base + "/api/auth/callback?code=not-a-code&state=" + encoded, { headers: { Cookie: cookie }, redirect: "manual" });
      assert.equal(response.status, 400);
    }
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
