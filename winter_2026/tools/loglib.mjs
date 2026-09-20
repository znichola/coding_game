// Parse a bot debug log (LOG = true in main.ts, copied from the CodinGame stderr console or from BOTLOG files).
// Lines look like "#TAG payload"; anything before the '#' on a line (timestamps etc.) is ignored.
import fs from 'node:fs';

export function parseLog(file) {
  const raw = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const init = [];
  const turns = [];
  let cur = null;
  for (const line of raw) {
    const m = line.match(/#(INKED|INST|OWN|ACT|DBG|OUT|IN|T)(?: (.*))?$/);
    if (!m) continue;
    const tag = m[1], text = m[2] ?? '';
    if (tag === 'IN') { init.push(text); continue; }
    if (tag === 'T') {
      const f = Object.fromEntries(text.split(' ').slice(1).map(kv => kv.split('=')));
      const [p0, p1] = f.pred.split('/').map(Number);
      cur = { n: +text.split(' ')[0], me: +f.me, foe: +f.foe, id: +f.id, pred: [p0, p1] };
      turns.push(cur);
    } else if (cur) {
      cur[tag.toLowerCase()] = text;
    }
  }
  const myId = +init[0], W = +init[1], H = +init[2], N = W * H;
  const regionOf = [], terrain = [];
  for (let i = 0; i < N; i++) { const [r, t] = init[3 + i].split(' ').map(Number); regionOf.push(r); terrain.push(t); }
  const townCount = +init[3 + N];
  const towns = [];
  for (let i = 0; i < townCount; i++) {
    const [id, x, y, w] = init[4 + N + i].split(' ');
    towns.push({ id: +id, x: +x, y: +y, wants: w === 'x' ? [] : w.split(',').map(Number) });
  }
  return { init, myId, W, H, N, regionOf, terrain, towns, turns };
}

/** The cell lines the game would have sent for turn t (so a bot can be re-run on a recorded position). */
export function turnInput(g, t) {
  const inst = new Map(t.inst === '-' ? [] : t.inst.split(',').map(s => s.split(':').map(Number)));
  const inked = new Set(t.inked === '-' ? [] : t.inked.split(',').map(Number));
  const act = new Map(t.act === '-' ? [] : t.act.split(';').map(s => { const k = s.indexOf('='); return [+s.slice(0, k), s.slice(k + 1)]; }));
  const lines = [String(t.me), String(t.foe)];
  for (let i = 0; i < g.N; i++) {
    const o = t.own[i] === '.' ? -1 : +t.own[i];
    const r = g.regionOf[i];
    lines.push(`${o} ${inst.get(r) ?? 0} ${inked.has(r) ? 1 : 0} ${act.get(i) ?? 'x'}`);
  }
  return lines;
}
