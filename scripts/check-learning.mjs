import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('public/index.html','utf8');
const data=source.slice(source.indexOf('const CONS='),source.indexOf('let ALL=[]'));
const no=()=>{}, handlers={};
const ctx=vm.createContext({console,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,performance,location:{hash:'#bosh'},S:{lvl:1,decks:{},missions:{done:{},attempts:0,correct:0}},V:{bosh:()=>''},window:{addEventListener:no},document:{querySelector:()=>null,getElementById:()=>null,addEventListener:(name,fn)=>{handlers[name]=fn}},requestAnimationFrame:no,localStorage:{getItem:()=>null,setItem:no},fetch:async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync('public/'+url,'utf8'))})});
vm.runInContext(data+'\nbuildDict();',ctx,{timeout:1000});
vm.runInContext(fs.readFileSync('public/learning.js','utf8'),ctx,{timeout:1000});
const stats=[];
for(let n=1;n<=6;n++){
 const start=performance.now();const value=await ctx.window.GoTopicLearning.loadStatsForLevel(n);stats.push({...value,computeMs:Math.round(performance.now()-start)});
 if(value.authoredTasks!==36)throw new Error(`Missing authored tasks at level ${n}`);
 if(value.byType.order!==6)throw new Error(`Ordering type lost at level ${n}`);
}
const total=stats.reduce((n,row)=>n+row.generatedVariants+row.authoredTasks,0);
console.log(JSON.stringify({totalExercises:total,authored:216,generated:total-216,levels:stats},null,2));
fs.writeFileSync('docs/learning-statistics.json',JSON.stringify({totalExercises:total,authored:216,generated:total-216,levels:stats},null,2)+'\n');
