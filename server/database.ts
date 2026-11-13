import { createHash, randomUUID } from "node:crypto";
import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";

export type AppUser = {
  id: string;
  name: string;
  isAdmin: boolean;
};

export type ProgressRecord<T = unknown> = {
  state: T;
  version: number;
  updatedAt?: string;
};

export type DbExecutor = Pick<Pool, "execute" | "query">;

const MAX_PROGRESS_BYTES = 512 * 1024;
const MAX_LEASE_TTL_MS = 120_000;
const MAX_LEASE_WAIT_MS = 8_000;
const MAX_QUEUE_PER_RESOURCE = 64;
const DEFAULT_LEASE_TTL_MS = 45_000;
const poolOptions = {
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 50,
  enableKeepAlive: true,
};

let pool: Pool | undefined;

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function makePool(): Pool {
  const dsn = env("DATABASE_URL");
  // mysql2 accepts URL strings and preserves driver-specific TLS query options.
  // The explicit pool options below are applied by constructing from URL parts.
  const url = new URL(dsn);
  const sslMode = url.searchParams.get("ssl-mode")?.toUpperCase();
  const sslQuery = url.searchParams.get("ssl");
  const tls = sslMode !== "DISABLED" && sslQuery !== "false" && sslQuery !== "0";
  const config: mysql.PoolOptions = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//u, "") || undefined,
    ...poolOptions,
  };
  if (tls) {
    // The managed database supplies a CA/verification policy through its DSN.
    // Do not silently disable certificate verification for TLS connections.
    config.ssl = {
      rejectUnauthorized: true,
    };
    if (sslMode === "REQUIRED") {
      config.ssl.rejectUnauthorized = false;
    }
  }
  return mysql.createPool(config);
}

/** Lazily create the shared bounded MySQL pool. */
export function db(): Pool {
  if (!pool) pool = makePool();
  return pool;
}

/** Finite scripts and tests use this to release the pool. */
export async function closeDb(): Promise<void> {
  const current = pool;
  pool = undefined;
  if (current) await current.end();
}

/** Test-only dependency injection; never used by application startup. */
export function setDbForTests(next: Pool | undefined): void {
  pool = next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function assertProgressState(value: unknown): void {
  if (!isRecord(value) && !Array.isArray(value)) {
    throw new Error("Progress state must be a JSON object or array");
  }
  if (jsonBytes(value) > MAX_PROGRESS_BYTES) {
    throw new Error("Progress state is too large");
  }
  try {
    JSON.stringify(value);
  } catch {
    throw new Error("Progress state must be JSON serializable");
  }
}

function adminOpenIds(): Set<string> {
  return new Set(
    (process.env.ADMIN_OPEN_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export async function ensureUser(openId: string, name = "Learner"): Promise<AppUser> {
  if (!/^[^\s\u0000]{1,255}$/u.test(openId)) throw new Error("Invalid Manus openId");
  const safeName = name.trim().slice(0, 200) || "Learner";
  const id = createHash("sha256").update(openId, "utf8").digest("hex");
  const isAdmin = adminOpenIds().has(openId);
  await db().execute(
    `INSERT INTO users (id, open_id, name, is_admin)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), is_admin = VALUES(is_admin), updated_at = CURRENT_TIMESTAMP(6)`,
    [id, openId, safeName, isAdmin ? 1 : 0],
  );
  return { id, name: safeName, isAdmin };
}

export async function findUserByOpenId(openId: string): Promise<AppUser | null> {
  const [rows] = await db().execute<RowDataPacket[]>(
    "SELECT id, name, is_admin AS isAdmin FROM users WHERE open_id = ? LIMIT 1",
    [openId],
  );
  const row = rows[0] as { id?: string; name?: string; isAdmin?: number } | undefined;
  if (!row?.id) return null;
  return { id: row.id, name: String(row.name ?? "Learner"), isAdmin: row.isAdmin === 1 };
}

export async function loadProgress(userId: string): Promise<ProgressRecord | null> {
  const [rows] = await db().execute<RowDataPacket[]>(
    "SELECT state, version, updated_at AS updatedAt FROM progress WHERE user_id = ? LIMIT 1",
    [userId],
  );
  const row = rows[0] as { state?: unknown; version?: number; updatedAt?: string } | undefined;
  if (!row) return null;
  let state: unknown = row.state;
  if (typeof state === "string") {
    try { state = JSON.parse(state) as unknown; } catch { throw new Error("Stored progress is invalid"); }
  }
  return { state, version: Number(row.version ?? 0), updatedAt: row.updatedAt };
}

export class ProgressConflictError extends Error {
  readonly code = "progress_conflict" as const;
  constructor(readonly currentVersion: number) {
    super("Progress was changed by another request");
    this.name = "ProgressConflictError";
  }
}

export async function saveProgress(
  userId: string,
  state: unknown,
  expectedVersion?: number,
): Promise<ProgressRecord> {
  if (!/^[a-f0-9]{64}$/u.test(userId)) throw new Error("Invalid user id");
  assertProgressState(state);
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT version FROM progress WHERE user_id = ? FOR UPDATE",
      [userId],
    );
    const current = Number((rows[0] as { version?: number } | undefined)?.version ?? 0);
    if (expectedVersion !== undefined && expectedVersion !== current) {
      await connection.rollback();
      throw new ProgressConflictError(current);
    }
    const next = current + 1;
    await connection.execute(
      `INSERT INTO progress (user_id, state, version)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE state = VALUES(state), version = VALUES(version), updated_at = CURRENT_TIMESTAMP(6)`,
      [userId, JSON.stringify(state), next],
    );
    await connection.commit();
    return { state, version: next };
  } catch (error) {
    try { await connection.rollback(); } catch { /* preserve original error */ }
    throw error;
  } finally {
    connection.release();
  }
}

export class CapacityError extends Error {
  readonly code: "busy" | "quota_exceeded" | "unavailable";
  readonly retryAfter: number;
  constructor(
    code: "busy" | "quota_exceeded" | "unavailable",
    message: string,
    retryAfter = 1,
  ) {
    super(message);
    this.name = "CapacityError";
    this.code = code;
    this.retryAfter = Math.max(1, Math.ceil(retryAfter));
  }
}

function asDbFailure(error: unknown, action: string): CapacityError {
  if (error instanceof CapacityError) return error;
  return new CapacityError("unavailable", `${action} is temporarily unavailable`, 2);
}

function positiveInt(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function leaseKeys(resources: Array<{ key: string; limit: number }>): Array<{ key: string; limit: number }> {
  if (!Array.isArray(resources) || resources.length === 0 || resources.length > 16) {
    throw new Error("At least one and at most sixteen resources are required");
  }
  const byKey = new Map<string, number>();
  for (const resource of resources) {
    if (!/^[A-Za-z0-9:_-]{1,191}$/u.test(resource.key)) throw new Error("Invalid resource key");
    const limit = positiveInt(resource.limit, "Resource limit");
    const previous = byKey.get(resource.key);
    byKey.set(resource.key, previous === undefined ? limit : Math.min(previous, limit));
  }
  return [...byKey].map(([key, limit]) => ({ key, limit })).sort((a, b) => a.key.localeCompare(b.key));
}

function placeholders(count: number): string { return Array.from({ length: count }, () => "?").join(","); }
function utcDate(msFromNow: number): Date { return new Date(Date.now() + msFromNow); }

async function lockGuards(connection: PoolConnection, resources: Array<{ key: string; limit: number }>): Promise<void> {
  for (const resource of resources) {
    await connection.execute(
      `INSERT INTO resource_guards (resource_key, capacity) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE capacity = GREATEST(capacity, VALUES(capacity)), updated_at = CURRENT_TIMESTAMP(6)`,
      [resource.key, resource.limit],
    );
  }
  // Every lease operation locks resource rows in sorted order.
  for (const resource of resources) {
    await connection.execute("SELECT resource_key FROM resource_guards WHERE resource_key = ? FOR UPDATE", [resource.key]);
  }
}

async function removeExpiredLeases(connection: PoolConnection, resources: Array<{ key: string; limit: number }>): Promise<void> {
  const keys = resources.map((resource) => resource.key);
  await connection.execute(
    `DELETE FROM leases WHERE resource_key IN (${placeholders(keys.length)}) AND expires_at <= UTC_TIMESTAMP(6)`,
    keys,
  );
}

async function activeCount(connection: PoolConnection, key: string): Promise<number> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS count FROM leases WHERE resource_key = ? AND state = 'active' AND expires_at > UTC_TIMESTAMP(6)",
    [key],
  );
  return Number((rows[0] as { count?: number } | undefined)?.count ?? 0);
}

async function queuedCount(connection: PoolConnection, key: string): Promise<number> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS count FROM leases WHERE resource_key = ? AND state = 'queued' AND expires_at > UTC_TIMESTAMP(6)",
    [key],
  );
  return Number((rows[0] as { count?: number } | undefined)?.count ?? 0);
}

async function deleteTokenRows(connection: PoolConnection, token: string, state?: "active" | "queued"): Promise<void> {
  if (state) await connection.execute("DELETE FROM leases WHERE token = ? AND state = ?", [token, state]);
  else await connection.execute("DELETE FROM leases WHERE token = ?", [token]);
}

export type LeaseHandle = {
  release(): Promise<void>;
  renew(): Promise<void>;
};

/** Acquire all requested capacity atomically, with a persisted bounded wait queue. */
export async function acquireLease(
  requestedResources: Array<{ key: string; limit: number }>,
  ttlMs = DEFAULT_LEASE_TTL_MS,
  signal?: AbortSignal,
  maxWaitMs = MAX_LEASE_WAIT_MS,
): Promise<LeaseHandle> {
  const resources = leaseKeys(requestedResources);
  if (!Number.isFinite(ttlMs) || ttlMs < 1 || ttlMs > MAX_LEASE_TTL_MS) throw new Error("Invalid lease TTL");
  if (!Number.isFinite(maxWaitMs) || maxWaitMs < 0 || maxWaitMs > MAX_LEASE_WAIT_MS) throw new Error("Invalid lease wait");
  if (signal?.aborted) throw new CapacityError("busy", "Capacity request was aborted", 1);
  const token = randomUUID();
  const deadline = Date.now() + maxWaitMs;
  let queued = false;
  let acquired = false;
  const run = async <T>(operation: (connection: PoolConnection) => Promise<T>): Promise<T> => {
    try {
      const connection = await db().getConnection();
      try {
        await connection.beginTransaction();
        const result = await operation(connection);
        await connection.commit();
        return result;
      } catch (error) {
        try { await connection.rollback(); } catch { /* preserve original */ }
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      throw asDbFailure(error, "Capacity service");
    }
  };
  const cancelQueued = async () => {
    if (!queued || acquired) return;
    queued = false;
    await run(async (connection) => {
      await lockGuards(connection, resources);
      await deleteTokenRows(connection, token, "queued");
    }).catch(() => undefined);
  };
  const onAbort = () => { void cancelQueued(); };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (!acquired) {
      if (signal?.aborted) throw new CapacityError("busy", "Capacity request was aborted", 1);
      const now = Date.now();
      if (now > deadline) {
        throw new CapacityError("busy", "Capacity is busy", 1);
      }
      const result = await run(async (connection) => {
        await lockGuards(connection, resources);
        await removeExpiredLeases(connection, resources);
        const available = (await Promise.all(resources.map(async (resource) =>
          (await activeCount(connection, resource.key)) < resource.limit))).every(Boolean);
        if (available) {
          await deleteTokenRows(connection, token, "queued");
          await connection.execute(
            `INSERT INTO leases (token, resource_key, state, expires_at) VALUES ${resources.map(() => "(?, ?, 'active', ?)").join(", ")}`,
            resources.flatMap((resource) => [token, resource.key, utcDate(ttlMs)]),
          );
          return "acquired" as const;
        }
        if (!queued) {
          const counts = await Promise.all(resources.map((resource) => queuedCount(connection, resource.key)));
          if (counts.some((count) => count >= MAX_QUEUE_PER_RESOURCE)) {
            throw new CapacityError("busy", "Capacity queue is full", 2);
          }
          await connection.execute(
            `INSERT INTO leases (token, resource_key, state, expires_at) VALUES ${resources.map(() => "(?, ?, 'queued', ?)").join(", ")}`,
            resources.flatMap((resource) => [token, resource.key, new Date(deadline)]),
          );
          queued = true;
        }
        return "waiting" as const;
      });
      if (result === "acquired") { acquired = true; break; }
      const delay = Math.min(250, Math.max(25, deadline - Date.now()));
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => signal?.removeEventListener("abort", abort);
        const timer = setTimeout(() => { cleanup(); resolve(); }, delay);
        const abort = () => { clearTimeout(timer); cleanup(); reject(new CapacityError("busy", "Capacity request was aborted", 1)); };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
    if (signal?.aborted) {
      await run((connection) => deleteTokenRows(connection, token));
      acquired = false;
      throw new CapacityError("busy", "Capacity request was aborted", 1);
    }
  } catch (error) {
    await cancelQueued();
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      await run(async (connection) => {
        await lockGuards(connection, resources);
        await deleteTokenRows(connection, token, "active");
      });
    },
    async renew() {
      if (released) throw new CapacityError("unavailable", "Lease is already released", 1);
      await run(async (connection) => {
        await lockGuards(connection, resources);
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE leases SET expires_at = ? WHERE token = ? AND state = 'active' AND expires_at > UTC_TIMESTAMP(6)`,
          [utcDate(ttlMs), token],
        );
        if (result.affectedRows !== resources.length) {
          throw new CapacityError("busy", "Lease expired", 1);
        }
      });
    },
  };
}

/** Atomically reserve amount from a cross-process, cross-rollout quota bucket. */
export async function consumeBudget(
  key: string,
  windowId: string,
  limit: number,
  amount = 1,
): Promise<boolean> {
  if (!/^[A-Za-z0-9:_-]{1,191}$/u.test(key) || !/^[A-Za-z0-9:._-]{1,191}$/u.test(windowId)) {
    throw new Error("Invalid quota key");
  }
  positiveInt(limit, "Quota limit");
  positiveInt(amount, "Quota amount");
  if (amount > limit) return false;
  let connection: PoolConnection | undefined;
  try {
    connection = await db().getConnection();
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO quota_buckets (budget_key, window_id, used) VALUES (?, ?, 0)
       ON DUPLICATE KEY UPDATE budget_key = VALUES(budget_key)`,
      [key, windowId],
    );
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT used FROM quota_buckets WHERE budget_key = ? AND window_id = ? FOR UPDATE",
      [key, windowId],
    );
    const used = Number((rows[0] as { used?: number } | undefined)?.used ?? 0);
    if (used + amount > limit) {
      await connection.rollback();
      return false;
    }
    await connection.execute(
      "UPDATE quota_buckets SET used = used + ?, updated_at = CURRENT_TIMESTAMP(6) WHERE budget_key = ? AND window_id = ?",
      [amount, key, windowId],
    );
    await connection.commit();
    return true;
  } catch (error) {
    try { await connection?.rollback(); } catch { /* preserve original */ }
    throw asDbFailure(error, "Quota service");
  } finally {
    connection?.release();
  }
}

export async function refundBudget(key: string, windowId: string, amount: number): Promise<void> {
  if (amount === 0) return;
  positiveInt(amount, "Refund amount");
  try {
    await db().execute(
      `UPDATE quota_buckets SET used = GREATEST(0, used - ?), updated_at = CURRENT_TIMESTAMP(6)
       WHERE budget_key = ? AND window_id = ?`,
      [amount, key, windowId],
    );
  } catch (error) {
    throw asDbFailure(error, "Quota refund service");
  }
}

export type { Pool };
