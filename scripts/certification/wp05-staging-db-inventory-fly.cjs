#!/usr/bin/env node
/**
 * Read-only COUNT inventory using a minimal Postgres simple-query client
 * (Next standalone image does not expose postgres.js / pg as require()-able packages).
 * Never prints credentials. Never writes.
 */
const net = require("net");
const tls = require("tls");
const { URL } = require("url");

function parseDbUrl(raw) {
  const u = new URL(raw);
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    database: decodeURIComponent((u.pathname || "/").replace(/^\//, "").split("?")[0]),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    sslmode: u.searchParams.get("sslmode") || "require",
  };
}

function int32(n) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
}

function startupMessage({ user, database }) {
  const payload = Buffer.concat([
    Buffer.from("user\0"),
    Buffer.from(user + "\0"),
    Buffer.from("database\0"),
    Buffer.from(database + "\0"),
    Buffer.from("client_encoding\0"),
    Buffer.from("UTF8\0"),
    Buffer.from([0]),
  ]);
  return Buffer.concat([int32(4 + 4 + payload.length), int32(196608), payload]);
}

function passwordMessage(password) {
  const body = Buffer.from(password + "\0");
  return Buffer.concat([Buffer.from([0x70]), int32(4 + body.length), body]);
}

function queryMessage(sql) {
  const body = Buffer.from(sql + "\0");
  return Buffer.concat([Buffer.from([0x51]), int32(4 + body.length), body]);
}

function terminateMessage() {
  return Buffer.concat([Buffer.from([0x58]), int32(4)]);
}

class PgBuffer {
  constructor() {
    this.buf = Buffer.alloc(0);
  }
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
  }
  tryReadMessage() {
    if (this.buf.length < 5) return null;
    const type = String.fromCharCode(this.buf[0]);
    const len = this.buf.readInt32BE(1);
    if (this.buf.length < 1 + len) return null;
    const body = this.buf.subarray(5, 1 + len);
    this.buf = this.buf.subarray(1 + len);
    return { type, body };
  }
}

async function withPg(url, fn) {
  const cfg = parseDbUrl(url);
  const socket = await new Promise((resolve, reject) => {
    const s = net.connect({ host: cfg.host, port: cfg.port }, () => resolve(s));
    s.on("error", reject);
  });
  const secure = await new Promise((resolve, reject) => {
    // SSLRequest
    socket.write(Buffer.concat([int32(8), int32(80877103)]));
    socket.once("data", (d) => {
      if (d.toString("utf8") !== "S") {
        reject(new Error("server refused TLS"));
        return;
      }
      const t = tls.connect({ socket, servername: cfg.host, rejectUnauthorized: false }, () =>
        resolve(t),
      );
      t.on("error", reject);
    });
  });

  const reader = new PgBuffer();
  const waitMsg = (predicate, timeoutMs = 20000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("pg timeout")), timeoutMs);
      const onData = (chunk) => {
        reader.push(chunk);
        let msg;
        while ((msg = reader.tryReadMessage())) {
          if (predicate(msg)) {
            clearTimeout(timer);
            secure.off("data", onData);
            resolve(msg);
            return;
          }
          if (msg.type === "E") {
            clearTimeout(timer);
            secure.off("data", onData);
            reject(new Error(msg.body.toString("utf8").slice(0, 200)));
            return;
          }
        }
      };
      secure.on("data", onData);
    });

  secure.write(startupMessage(cfg));
  // Authentication
  for (;;) {
    const msg = await waitMsg(() => true);
    if (msg.type === "R") {
      const code = msg.body.readInt32BE(0);
      if (code === 0) break; // auth ok comes as R then later ReadyForQuery
      if (code === 3) {
        // cleartext
        secure.write(passwordMessage(cfg.password));
        continue;
      }
      if (code === 5) {
        // MD5
        const crypto = require("crypto");
        const salt = msg.body.subarray(4, 8);
        const inner = crypto
          .createHash("md5")
          .update(cfg.password + cfg.user)
          .digest("hex");
        const outer = crypto
          .createHash("md5")
          .update(Buffer.concat([Buffer.from(inner, "utf8"), salt]))
          .digest("hex");
        secure.write(passwordMessage("md5" + outer));
        continue;
      }
      throw new Error(`Unsupported auth code ${code}`);
    }
    if (msg.type === "Z") break;
  }
  // Drain to ReadyForQuery
  await waitMsg((m) => m.type === "Z");

  const result = await fn({
    async query(sqlText) {
      secure.write(queryMessage(sqlText));
      const rows = [];
      let fields = [];
      for (;;) {
        const msg = await waitMsg(() => true);
        if (msg.type === "T") {
          // row description
          let offset = 0;
          const fieldCount = msg.body.readInt16BE(offset);
          offset += 2;
          fields = [];
          for (let i = 0; i < fieldCount; i++) {
            const end = msg.body.indexOf(0, offset);
            const name = msg.body.subarray(offset, end).toString("utf8");
            offset = end + 1 + 18;
            fields.push(name);
          }
        } else if (msg.type === "D") {
          let offset = 0;
          const colCount = msg.body.readInt16BE(offset);
          offset += 2;
          const row = {};
          for (let i = 0; i < colCount; i++) {
            const len = msg.body.readInt32BE(offset);
            offset += 4;
            if (len === -1) {
              row[fields[i]] = null;
            } else {
              row[fields[i]] = msg.body.subarray(offset, offset + len).toString("utf8");
              offset += len;
            }
          }
          rows.push(row);
        } else if (msg.type === "C") {
          // command complete
        } else if (msg.type === "Z") {
          break;
        } else if (msg.type === "E") {
          throw new Error(msg.body.toString("utf8").slice(0, 200));
        }
      }
      return rows;
    },
  });

  secure.write(terminateMessage());
  secure.end();
  return result;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const tables = [
    "legal_authorities",
    "legal_authority_chunks",
    "legal_authority_versions",
    "legal_authority_citations",
    "organizations",
    "matters",
    "documents",
    "criminal_cases",
    "audit_events",
  ];
  const report = await withPg(url, async (client) => {
    await client.query("SET default_transaction_read_only = on");
    const host = new URL(url).hostname;
    const database = new URL(url).pathname.replace(/^\//, "").split("?")[0];
    const counts = {};
    for (const table of tables) {
      if (!/^[a-z_]+$/.test(table)) throw new Error("bad table");
      const exists = await client.query(`SELECT to_regclass('public.${table}') AS reg`);
      if (!exists[0] || exists[0].reg === null || exists[0].reg === "") {
        counts[table] = { present: false, count: null };
        continue;
      }
      const rows = await client.query(`SELECT COUNT(*)::bigint AS c FROM public.${table}`);
      counts[table] = { present: true, count: Number(rows[0].c) };
    }
    const exts = await client.query("SELECT extname FROM pg_extension ORDER BY 1");
    return {
      classification: "NYAYAGRID_WP05_STAGING_DB_INVENTORY",
      at: new Date().toISOString(),
      readOnly: true,
      neonCorpusWrites: 0,
      target: { host, database },
      extensions: exts.map((r) => r.extname),
      counts,
      isolationNote:
        "Corpus and product tables coexist on this database — physical isolation OPEN.",
    };
  });
  console.log(JSON.stringify(report));
}

main().catch((err) => {
  console.error(
    JSON.stringify({ result: "ERROR", error: String(err.message || err).slice(0, 400) }),
  );
  process.exit(1);
});
