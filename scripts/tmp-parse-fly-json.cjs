"use strict";
const fs = require("fs");
const path = process.argv[2];
const out = process.argv[3];
let b = fs.readFileSync(path);
let t = b[1] === 0 || b[0] === 0xff ? b.toString("utf16le") : b.toString("utf8");
t = t.replace(/^\uFEFF/, "");
const lines = t.split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith("{") || l.includes('{"ok"'));
let parsed = null;
for (let i = lines.length - 1; i >= 0; i--) {
  const s = lines[i].includes("{") ? lines[i].slice(lines[i].indexOf("{")) : lines[i];
  try {
    parsed = JSON.parse(s);
    break;
  } catch {
    /* try brace extract */
    const start = t.lastIndexOf('{"ok"');
    if (start >= 0) {
      let depth = 0;
      for (let k = start; k < t.length; k++) {
        if (t[k] === "{") depth++;
        else if (t[k] === "}") {
          depth--;
          if (depth === 0) {
            try {
              parsed = JSON.parse(t.slice(start, k + 1));
            } catch {}
            break;
          }
        }
      }
    }
  }
}
if (!parsed) {
  console.error("PARSE_FAIL", path);
  process.exit(1);
}
if (out) fs.writeFileSync(out, JSON.stringify(parsed, null, 2));
console.log(JSON.stringify(parsed, null, 2).slice(0, 4000));
