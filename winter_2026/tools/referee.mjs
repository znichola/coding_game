import { Worker, MessageChannel } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const botUrl = f => pathToFileURL(path.resolve(f)).href; // path relative to the current directory
import fs from 'node:fs';

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

function genMap(seed) {
  const r = rng(seed);
  const W = 21 + Math.floor(r() * 10), H = 14 + Math.floor(r() * 7);
  const N = W * H;
  const terr = new Array(N).fill(0);
  for (let k = 0; k < 3; k++) { // rivers
    let x = Math.floor(r() * W), y = 0;
    while (y < H) { terr[y * W + x] = 1; const d = r(); if (d < 0.3 && x > 0) x--; else if (d < 0.6 && x < W - 1) x++; else y++; }
  }
  for (let k = 0; k < 4; k++) { // mountains
    const cx = Math.floor(r() * W), cy = Math.floor(r() * H);
    for (let i = 0; i < 25; i++) { const x = cx + Math.floor((r() - .5) * 6), y = cy + Math.floor((r() - .5) * 5); if (x >= 0 && y >= 0 && x < W && y < H) terr[y * W + x] = 2; }
  }
  const K = Math.floor(N / +(process.env.REG_DIV || 22));
  const seeds = Array.from({ length: K }, () => [Math.floor(r() * W), Math.floor(r() * H)]);
  const reg = new Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let b = 0, bd = 1e9;
    seeds.forEach(([sx, sy], i) => { const d = Math.abs(sx - x) + Math.abs(sy - y) + r() * 0.5; if (d < bd) { bd = d; b = i; } });
    reg[y * W + x] = b;
  }
  const adj = Array.from({ length: K }, () => new Set());
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const nx = x + dx, ny = y + dy; if (nx >= W || ny >= H) continue;
    const a = reg[y * W + x], b = reg[ny * W + nx]; if (a !== b) { adj[a].add(b); adj[b].add(a); }
  }
  const want = 4 + Math.floor(r() * 9);
  const towns = [], used = new Set(), banned = new Set();
  for (let tries = 0; tries < 400 && towns.length < want; tries++) {
    const rid = Math.floor(r() * K);
    if (banned.has(rid) || used.has(rid)) continue;
    const cells = []; for (let i = 0; i < N; i++) if (reg[i] === rid && terr[i] === 0) cells.push(i);
    if (!cells.length) continue;
    const c = cells[Math.floor(r() * cells.length)];
    towns.push({ id: towns.length, x: c % W, y: (c / W) | 0, wants: [] });
    used.add(rid); banned.add(rid); adj[rid].forEach(a => banned.add(a));
  }
  const n = towns.length;
  for (const t of towns) for (const o of towns) if (o !== t && r() < 0.25) t.wants.push(o.id);
  for (const o of towns) if (!towns.some(t => t.wants.includes(o.id))) { let t; do { t = towns[Math.floor(r() * n)]; } while (t === o); t.wants.push(o.id); }
  return { W, H, terr, reg, towns };
}

async function play(seed, botFiles) {
  const M = genMap(seed);
  const { W, H, terr, reg, towns } = M, N = W * H;
  const owner = new Array(N).fill(-1), inst = {}, inked = new Set();
  const townAt = new Set(towns.map(t => t.y * W + t.x)), townReg = new Set(towns.map(t => reg[t.y * W + t.x]));
  const scores = [0, 0];
  const cost = [1, 2, 3];
  const players = [0, 1].map(i => {
    const { port1, port2 } = new MessageChannel();
    const w = new Worker(path.join(here, 'worker.mjs'), { workerData: { bot: botUrl(botFiles[i]), port: port2, seed: seed * 2 + i, log: process.env.BOTLOG ? `${process.env.BOTLOG}.g${seed}.p${i}.log` : undefined }, transferList: [port2] });
    const q = []; let wake; const turnMs = [];
    port1.on('message', m => { q.push(m.out); if (turnMs) turnMs.push(m.ms); wake && wake(); });
    return { turnMs, port: port1, w, q, waitOut: async () => { while (!q.length) await new Promise(r => { wake = r; }); return q.shift(); }, maxMs: 0, dead: false };
  });
  const send = (p, lines) => { for (const l of lines) p.port.postMessage(l); };
  towns.forEach(() => 0);
  for (let i = 0; i < 2; i++) {
    const init = [String(i), String(W), String(H)];
    for (let c = 0; c < N; c++) init.push(`${reg[c]} ${terr[c]}`);
    init.push(String(towns.length));
    for (const t of towns) init.push(`${t.id} ${t.x} ${t.y} ${t.wants.length ? t.wants.join(',') : 'x'}`);
    send(players[i], init);
  }
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  const byFrom = new Map(); const seen = new Set();
  for (const t of towns) for (const w of t.wants) { const k = Math.min(t.id, w) + '-' + Math.max(t.id, w); if (seen.has(k)) continue; seen.add(k); (byFrom.get(t.id) ?? byFrom.set(t.id, []).get(t.id)).push(towns[w]); }
  let actNow = new Map();
  const score = () => {
    const s = [0, 0]; actNow = new Map();
    for (const [fid, list] of byFrom) {
      const f = towns[fid], src = f.y * W + f.x, par = new Array(N).fill(-2); par[src] = -1; const qu = [src];
      for (let h = 0; h < qu.length; h++) { const c = qu[h], cx = c % W, cy = (c / W) | 0; for (let d = 0; d < 4; d++) { const nx = cx + DX[d], ny = cy + DY[d]; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const ni = ny * W + nx; if (par[ni] !== -2 || (owner[ni] < 0 && !townAt.has(ni))) continue; par[ni] = c; qu.push(ni); } }
      for (const t of list) { let c = t.y * W + t.x; if (par[c] === -2) continue; const lbl = f.id + '-' + t.id; while (c !== src) { if (owner[c] === 0) s[0]++; else if (owner[c] === 1) s[1]++; (actNow.get(c) ?? actNow.set(c, []).get(c)).push(lbl); c = par[c]; } }
    }
    return s;
  };
  let loser = -1; const hits = [{}, {}]; const disrBy = []; const selfWash = [0, 0];
  for (let turn = 1; turn <= 100 && loser < 0; turn++) {
    const t0 = performance.now();
    for (let i = 0; i < 2; i++) {
      const lines = [String(scores[i]), String(scores[1 - i])];
      for (let c = 0; c < N; c++) lines.push(`${owner[c]} ${inst[reg[c]] ?? 0} ${inked.has(reg[c]) ? 1 : 0} ${actNow.has(c) ? actNow.get(c).join(',') : 'x'}`);
      send(players[i], lines);
    }
    const outs = [];
    for (let i = 0; i < 2; i++) { const o = await Promise.race([players[i].waitOut(), new Promise(r => setTimeout(() => r(null), 3000))]); players[i].maxMs = Math.max(players[i].maxMs, turn > 1 ? (players[i].turnMs.at(-1) ?? 0) : 0); outs.push(o); }
    if (process.env.DBG && turn <= +process.env.DBG) console.log('  T' + turn, 'A:', outs[0], '| B:', outs[1], '| sc', scores.join('-'));
    const placed = [new Map(), new Map()], disr = [];
    for (let i = 0; i < 2; i++) {
      if (outs[i] === null) { loser = i; break; }
      let budget = 3, dis = 0;
      for (const a of outs[i].split(';')) {
        const p = a.trim().split(' ');
        if (p[0] === 'PLACE_TRACKS') {
          const x = +p[1], y = +p[2], c = y * W + x;
          if (!(x >= 0 && y >= 0 && x < W && y < H)) { loser = i; break; }
          const pc = cost[terr[c]];
          if (owner[c] >= 0 || townAt.has(c) || inked.has(reg[c]) || pc > budget || placed[i].has(c)) continue;
          budget -= pc; placed[i].set(c, 1);
        } else if (p[0] === 'DISRUPT') {
          const r = p.length === 3 ? reg[+p[2] * W + +p[1]] : +p[1];
          if (dis++ < 1 && !townReg.has(r) && !inked.has(r) && r >= 0) (disr.push(r), hits[i][r] = (hits[i][r] ?? 0) + 1); else if (dis > 1) { /* extra ignored */ }
        } else if (p[0] === 'WAIT' || p[0] === 'MESSAGE') { } else { loser = i; console.error('invalid', i, a); break; }
      }
    }
    if (loser >= 0) break;
    for (const c of placed[0].keys()) owner[c] = placed[1].has(c) ? 2 : 0;
    for (const c of placed[1].keys()) if (!placed[0].has(c)) owner[c] = 1;
    disrBy.forEach((rr) => {});
    for (const r of disr) { inst[r] = (inst[r] ?? 0) + 1; }
    for (const r of Object.keys(inst)) if (inst[r] >= 4 && !inked.has(+r)) { if (process.env.INKLOG) { let t0=0,t1=0; for (let c=0;c<N;c++) if (reg[c]===+r){ if(owner[c]===0)t0++; if(owner[c]===1)t1++; } console.log('  INK t'+turn+' region '+r+' tracks p0/p1 '+t0+'/'+t1+' hits p0/p1 '+(hits[0][r]??0)+'/'+(hits[1][r]??0)); } inked.add(+r); for (let c = 0; c < N; c++) if (reg[c] === +r) { if (owner[c] === 0 || owner[c] === 1) { const o = owner[c]; if ((hits[o][r] ?? 0) >= 2) selfWash[o]++; } owner[c] = -1; } }
    const s = score(); scores[0] += s[0]; scores[1] += s[1];
    if (turn % 20 === 0 && process.env.TL) console.log('   t' + turn, scores.join('-'), 'inked', inked.size);
  }
  players.forEach(p => p.w.terminate());
  return { selfWash, scores, loser, ms: players.map(p => p.maxMs), inked: inked.size, size: `${W}x${H}/${towns.length}t` };
}

const [a, b, nGames = '6'] = process.argv.slice(2);
let winsA = 0, winsB = 0, draws = 0, sumA = 0, sumB = 0, worstA = 0, worstB = 0;
for (let g = +(process.env.G0 || 0); g < +nGames; g++) {
  const swap = g % 2 === 1;
  const res = await play(100 + g, swap ? [b, a] : [a, b]);
  const sa = swap ? res.scores[1] : res.scores[0], sb = swap ? res.scores[0] : res.scores[1];
  const ma = swap ? res.ms[1] : res.ms[0], mb = swap ? res.ms[0] : res.ms[1];
  const loserIsA = res.loser >= 0 ? (swap ? res.loser === 1 : res.loser === 0) : null;
  sumA += sa; sumB += sb; worstA = Math.max(worstA, ma); worstB = Math.max(worstB, mb);
  if (loserIsA === true) winsB++; else if (loserIsA === false) winsA++; else if (sa > sb) winsA++; else if (sb > sa) winsB++; else draws++;
  console.log(`game ${g} ${res.size} A=${sa} B=${sb} ms(A/B)=${ma.toFixed(0)}/${mb.toFixed(0)} inked=${res.inked} selfwash(A/B)=${swap ? res.selfWash[1] : res.selfWash[0]}/${swap ? res.selfWash[0] : res.selfWash[1]}${res.loser >= 0 ? ' LOSER=' + (loserIsA ? 'A' : 'B') : ''}`);
}
console.log(`A(${a}) wins ${winsA}, B(${b}) wins ${winsB}, draws ${draws}; avg ${sumA / nGames | 0} vs ${sumB / nGames | 0}; worst ms ${worstA.toFixed(0)}/${worstB.toFixed(0)}`);
process.exit(0);
