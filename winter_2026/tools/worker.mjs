import { workerData, receiveMessageOnPort } from 'node:worker_threads';
import fs from 'node:fs';
const { bot, port, log, seed } = workerData;
if (seed !== undefined) { // reproducible Math.random for the bot
  let s = seed >>> 0;
  Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let last = performance.now();
globalThis.readline = () => {
  for (;;) {
    const m = receiveMessageOnPort(port);
    if (m) { last = performance.now(); return m.message; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
  }
};
console.log = (l) => port.postMessage({ out: String(l), ms: performance.now() - last });
console.error = (...a) => { if (log) fs.appendFileSync(log, a.join(' ') + String.fromCharCode(10)); };
await import(bot);
