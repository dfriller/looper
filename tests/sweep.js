globalThis.LOOP_DEBUG=0;
const src=require('fs').readFileSync('test.js','utf8').split('const tests =')[0].replace("globalThis.LOOP_DEBUG=0;","").replace("require('../src/loop.js');","");
require('../src/loop.js'); eval(src.replace(/const \{ detectLoops \} = globalThis.LoopDetect;/,'')+`
let r1=0,r2=0,n=0; const fails=[];
for(let i=0;i<60;i++){
  const kind=rnd()<0.5?'g':'d', bpm=70+Math.round(rnd()*80), beats=[4,8,8,16][Math.floor(rnd()*4)], reps=[1,2,2,3][Math.floor(rnd()*4)];
  const L=beats*60/bpm; if(L*reps>30) continue;
  const t={bpm,beats,reps,pre:0.2+rnd()*0.8,post:(rnd()-0.3)*0.4,kind,jitter:0.005+rnd()*0.03};
  const {buf}=make(t); const r=globalThis.LoopDetect.detectLoops(buf,sr); n++;
  const h=r.candidates.findIndex(k=>Math.abs(k.lenS-L)<Math.max(0.03,L*0.008));
  if(h===0)r1++; if(h>=0&&h<=1)r2++; else fails.push(kind+' '+bpm+'bpm '+beats+'b x'+reps+' jit'+t.jitter.toFixed(3)+' -> '+r.candidates.map(c=>c.lenS.toFixed(2)).join(',')+' soll '+L.toFixed(2));
}
console.log('Top1',r1+'/'+n,'Top2',r2+'/'+n); fails.forEach(f=>console.log(' ',f));
`);
