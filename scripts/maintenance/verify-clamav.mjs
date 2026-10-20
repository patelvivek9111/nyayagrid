#!/usr/bin/env node
/**
 * Live ClamAV check against a reachable clamd (docker-compose `clamav` by default).
 * Sends the EICAR test file and expects a FOUND / blocked response. Fixture mode is not used.
 */
import { connect } from "node:net";

const host = process.env.CLAMAV_HOST ?? "127.0.0.1";
const port = Number(process.env.CLAMAV_PORT ?? "3310");
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const CLEAN = "NyayaGrid SYNTH clean upload for ClamAV rehearsal.\n";

function instream(buffer) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let response = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`ClamAV timed out talking to ${host}:${port}`));
    }, 30_000);

    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const size = Buffer.alloc(4);
      size.writeUInt32BE(buffer.length, 0);
      socket.write(size);
      socket.write(buffer);
      const end = Buffer.alloc(4);
      end.writeUInt32BE(0, 0);
      socket.write(end);
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

const infected = await instream(Buffer.from(EICAR));
const clean = await instream(Buffer.from(CLEAN));
const report = { host, port, infected, clean };
console.log(JSON.stringify(report, null, 2));

if (!/FOUND/.test(infected)) {
  console.error("EICAR was not blocked by clamd");
  process.exit(1);
}
if (/FOUND/.test(clean)) {
  console.error("Clean SYNTH payload was treated as infected");
  process.exit(1);
}
console.log("ClamAV live check passed: EICAR blocked, clean payload accepted.");
