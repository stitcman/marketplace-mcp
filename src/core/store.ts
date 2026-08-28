/**
 * Storage layer. Two modes:
 *  - PgStore: production (PostgreSQL, DATABASE_URL set) — connections, encrypted credentials, audit.
 *  - MemoryStore: demo/dev without a database — seeded with mock connections so the server
 *    can be started and attached to an MCP client with no infrastructure at all.
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { encryptSecret, decryptSecret } from "./secrets.js";

export type Marketplace = "wildberries" | "ozon" | "yandex_market";

export interface Connection {
  connection_id: string;
  marketplace: Marketplace;
  name: string;
  status: "active" | "disabled";
  mock: boolean;
  /** Connection points at the marketplace sandbox rather than production. */
  sandbox: boolean;
  permissions: string[];
  created_at: string;
}

export interface ToolCallLog {
  tool: string;
  marketplace: string | null;
  connection_id: string | null;
  duration_ms: number;
  status: "ok" | "error";
  error_code: string | null;
  client: string | null;
}

export interface Store {
  listConnections(): Promise<Connection[]>;
  getConnection(id: string): Promise<Connection | null>;
  addConnection(c: Omit<Connection, "connection_id" | "created_at">, credentials: Record<string, string>): Promise<Connection>;
  getCredentials(connectionId: string): Promise<Record<string, string>>;
  logToolCall(l: ToolCallLog): Promise<void>;
  kind: "postgres" | "memory";
}

/* ------------------------------- MemoryStore ------------------------------ */

export class MemoryStore implements Store {
  kind = "memory" as const;
  private conns = new Map<string, Connection>();
  private creds = new Map<string, Record<string, string>>();
  public auditLog: ToolCallLog[] = [];

  constructor() {
    const READ_PERMS = ["catalog.read", "stocks.read", "orders.read", "prices.read"];
    const seed = (id: string, marketplace: Marketplace, name: string, mock: boolean, credentials: Record<string, string> = {}, sandbox = false) => {
      this.conns.set(id, {
        connection_id: id,
        marketplace,
        name,
        status: "active",
        mock,
        sandbox,
        permissions: READ_PERMS,
        created_at: new Date().toISOString(),
      });
      this.creds.set(id, credentials);
    };

    // Demo connections: they work without API keys through the mock adapters.
    // One per marketplace so the demo showcases the full normalization story,
    // not just Wildberries.
    seed("00000000-0000-4000-8000-000000000001", "wildberries", "DEMO WB (mock)", true);
    seed("00000000-0000-4000-8000-000000000011", "ozon", "DEMO Ozon (mock)", true);
    seed("00000000-0000-4000-8000-000000000021", "yandex_market", "DEMO Yandex Market (mock)", true);

    // Real connections from the environment, when keys are provided.
    if (process.env.WB_API_TOKEN) {
      const wbSandbox = process.env.WB_SANDBOX === "1" || process.env.WB_SANDBOX === "true";
      seed(
        "00000000-0000-4000-8000-000000000002",
        "wildberries",
        process.env.WB_CONNECTION_NAME ?? (wbSandbox ? "Wildberries (sandbox)" : "Wildberries (env token)"),
        false,
        { token: process.env.WB_API_TOKEN },
        wbSandbox,
      );
    }
    if (process.env.OZON_CLIENT_ID && process.env.OZON_API_KEY) {
      seed("00000000-0000-4000-8000-000000000012", "ozon", process.env.OZON_CONNECTION_NAME ?? "Ozon (env keys)", false, {
        client_id: process.env.OZON_CLIENT_ID,
        api_key: process.env.OZON_API_KEY,
      });
    }
    if (process.env.YM_API_KEY) {
      seed("00000000-0000-4000-8000-000000000022", "yandex_market", process.env.YM_CONNECTION_NAME ?? "Yandex Market (env key)", false, {
        api_key: process.env.YM_API_KEY,
        ...(process.env.YM_BUSINESS_ID ? { business_id: process.env.YM_BUSINESS_ID } : {}),
      });
    }
  }

  async listConnections() {
    return [...this.conns.values()];
  }
  async getConnection(id: string) {
    return this.conns.get(id) ?? null;
  }
  async addConnection(c: Omit<Connection, "connection_id" | "created_at">, credentials: Record<string, string>) {
    const conn: Connection = { ...c, connection_id: randomUUID(), created_at: new Date().toISOString() };
    this.conns.set(conn.connection_id, conn);
    this.creds.set(conn.connection_id, credentials);
    return conn;
  }
  async getCredentials(connectionId: string) {
    return this.creds.get(connectionId) ?? {};
  }
  async logToolCall(l: ToolCallLog) {
    this.auditLog.push(l);
  }
}

/* -------------------------------- PgStore --------------------------------- */

export class PgStore implements Store {
  kind = "postgres" as const;
  constructor(private pool: pg.Pool) {}

  static async connect(databaseUrl: string): Promise<PgStore> {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    await pool.query("SELECT 1");
    return new PgStore(pool);
  }

  async listConnections(): Promise<Connection[]> {
    const r = await this.pool.query(
      `SELECT connection_id, marketplace, name, status, mock, sandbox, permissions, created_at
       FROM marketplace_connections ORDER BY created_at`,
    );
    return r.rows.map(rowToConnection);
  }

  async getConnection(id: string): Promise<Connection | null> {
    const r = await this.pool.query(
      `SELECT connection_id, marketplace, name, status, mock, sandbox, permissions, created_at
       FROM marketplace_connections WHERE connection_id = $1`,
      [id],
    );
    return r.rows[0] ? rowToConnection(r.rows[0]) : null;
  }

  async addConnection(
    c: Omit<Connection, "connection_id" | "created_at">,
    credentials: Record<string, string>,
  ): Promise<Connection> {
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO marketplace_connections (connection_id, marketplace, name, status, mock, sandbox, permissions)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, c.marketplace, c.name, c.status, c.mock, c.sandbox ?? false, JSON.stringify(c.permissions)],
    );
    for (const [key, value] of Object.entries(credentials)) {
      await this.pool.query(
        `INSERT INTO marketplace_credentials (connection_id, cred_key, cred_value_encrypted)
         VALUES ($1,$2,$3)`,
        [id, key, encryptSecret(value)],
      );
    }
    const created = await this.getConnection(id);
    if (!created) throw new Error("insert failed");
    return created;
  }

  async getCredentials(connectionId: string): Promise<Record<string, string>> {
    const r = await this.pool.query(
      `SELECT cred_key, cred_value_encrypted FROM marketplace_credentials WHERE connection_id = $1`,
      [connectionId],
    );
    const out: Record<string, string> = {};
    for (const row of r.rows) out[row.cred_key] = decryptSecret(row.cred_value_encrypted);
    return out;
  }

  async logToolCall(l: ToolCallLog) {
    await this.pool.query(
      `INSERT INTO tool_calls (tool, marketplace, connection_id, duration_ms, status, error_code, client)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [l.tool, l.marketplace, l.connection_id, l.duration_ms, l.status, l.error_code, l.client],
    );
  }
}

function rowToConnection(row: any): Connection {
  return {
    connection_id: row.connection_id,
    marketplace: row.marketplace,
    name: row.name,
    status: row.status,
    mock: row.mock,
    sandbox: row.sandbox ?? false,
    permissions: Array.isArray(row.permissions) ? row.permissions : JSON.parse(row.permissions ?? "[]"),
    created_at: new Date(row.created_at).toISOString(),
  };
}

/** Picks the store implementation based on the environment. */
export async function initStore(): Promise<Store> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[store] DATABASE_URL not set — running with in-memory store (demo mode)");
    return new MemoryStore();
  }
  return PgStore.connect(url);
}
