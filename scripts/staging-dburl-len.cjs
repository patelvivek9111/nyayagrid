const fs = require("fs");
const len = String(process.env.DATABASE_URL || "").length;
fs.writeFileSync("/tmp/dburl.len", String(len));
console.log(JSON.stringify({ ok: len > 0, len }));
