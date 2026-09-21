import fs from 'node:fs';
let t=fs.readFileSync('loss_log.html','utf8').replace(/<\/div>/g,'\n').replace(/<[^>]*>/g,'').replace(/&gt;/g,'>');
const rows=[];let cur=null;
for(const l of t.split('\n')){let m;
if(m=l.match(/#T (\d+) me=(\d+) foe=(\d+) pred=(\S+)/)){cur={n:+m[1],me:+m[2],foe:+m[3],pred:m[4]};rows.push(cur)}
else if(cur&&(m=l.match(/#OWN (.*)/))){cur.a=[...m[1]].filter(c=>c==='0').length;cur.b=[...m[1]].filter(c=>c==='1').length}
else if(cur&&(m=l.match(/#INKED (.*)/)))cur.ink=m[1]==='-'?0:m[1].split(',').length;
else if(cur&&(m=l.match(/#OUT (.*)/)))cur.out=m[1].replace(/PLACE_TRACKS /g,'P');}
for(const r of rows)console.log('t'+r.n,r.me+'-'+r.foe,'pred',r.pred,'tracks',r.a,r.b,'ink',r.ink,'|',(r.out||'').slice(0,60));
