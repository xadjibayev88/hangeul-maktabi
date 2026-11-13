import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const catalog=JSON.parse(readFileSync('public/catalog.json','utf8'));
test('all six levels have complete balanced authored tasks and every appropriate topic',()=>{
 const ids=new Set<string>();
 for(let level=1;level<=6;level++){
  const pack=JSON.parse(readFileSync(`public/tasks/level-${level}.json`,'utf8'));
  assert.equal(pack.tasks.length,36);
  const count:Record<string,number>={};
  for(const task of pack.tasks){
   assert.equal(task.level,level);assert.ok(!ids.has(task.id));ids.add(task.id);
   count[task.type]=(count[task.type]||0)+1;
   assert.ok(task.promptUz&&task.explanationUz&&(task.ko||task.type==='order'));
   if(['mcq','cloze','reading','listening'].includes(task.type)){assert.equal(new Set(task.choices).size,4);assert.ok(task.choices.includes(task.answer));}
   if(task.type==='cloze')assert.equal(task.ko.split('___').length,2);
   if(task.type==='order')assert.deepEqual(task.tokens.flatMap((token:string)=>token.split(' ')).sort(),task.answer.split(' ').sort());
  }
  assert.deepEqual(count,{mcq:6,cloze:6,order:6,reading:5,listening:5,writing:4,speaking:4});
  const topics=new Set(pack.tasks.map((task:{topic:string})=>task.topic));
  for(const [topic,assigned] of Object.entries(catalog.data.LVMAP))if(assigned===level)assert.ok(topics.has(topic),`Missing ${topic} at ${level}`);
 }
 assert.equal(ids.size,216);
});
