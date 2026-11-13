import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {LlmClient,mapLimit,messageText}=await import(pathToFileURL('/home/ubuntu/skills/builtin-llm-models/lib/llm.mjs').href);
const root=process.cwd(),pilot=process.argv.includes('--pilot');
const workers=Math.max(1,Math.min(8,Number(process.argv.find(value=>value.startsWith('--workers='))?.split('=')[1])||4));
const batchSize=Math.max(10,Math.min(60,Number(process.argv.find(value=>value.startsWith('--batch-size='))?.split('=')[1])||60));
const entries=fs.readFileSync(path.join(root,'data/korean-dictionary-source.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
const catalog=JSON.parse(fs.readFileSync(path.join(root,'public/catalog.json'),'utf8'));
const legacy=new Map(catalog.data.DRAW.map(row=>[row[0],row[1]]));
for(const words of Object.values(catalog.data.TOPICS))for(const row of words)if(row[2])legacy.set(row[0],row[2]);
const out=path.join(root,pilot?'data/dictionary-uz-pilot.jsonl':'data/dictionary-uz.jsonl');
const completed=new Map();
if(!pilot&&fs.existsSync(out))for(const line of fs.readFileSync(out,'utf8').split('\n')){try{const value=JSON.parse(line);completed.set(value.id,value);}catch{}}
if(!pilot&&completed.size)fs.writeFileSync(out,[...completed.values()].map(JSON.stringify).join('\n')+'\n');
if(!pilot){
 const initial=[];
 for(const entry of entries)if(legacy.has(entry.word)&&!completed.has(entry.id)){
  const row={id:entry.id,uz:legacy.get(entry.word),status:'legacy_ai'};initial.push(row);completed.set(entry.id,row);
 }
 if(initial.length)fs.appendFileSync(out,initial.map(JSON.stringify).join('\n')+'\n');
}
let pending=entries.filter(entry=>!completed.has(entry.id));
if(pilot)pending=Array.from({length:20},(_,i)=>pending[Math.floor(i*pending.length/20)]);
const batches=[];for(let i=0;i<pending.length;i+=batchSize)batches.push(pending.slice(i,i+batchSize));
const llm=new LlmClient({timeoutMs:120000,maxRetries:2});
const schema={type:'object',properties:{translations:{type:'array',items:{type:'object',properties:{index:{type:'integer'},uz:{type:'string'},confident:{type:'boolean'}},required:['index','uz','confident'],additionalProperties:false}}},required:['translations'],additionalProperties:false};
function parseObject(raw){
 const start=raw.indexOf('{');let depth=0,quoted=false,escape=false;
 for(let i=start;i>=0&&i<raw.length;i++){
  const c=raw[i];if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;continue;}
  if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0)return JSON.parse(raw.slice(start,i+1));
 }
 throw new Error('No complete translation JSON object');
}
let fatal=null,batchDone=0,tokens=0;
console.log(JSON.stringify({model:'gpt-6-luna',mode:pilot?'pilot20':'batch',existing:completed.size,pending:pending.length,batches:batches.length}));
await mapLimit(batches,pilot?1:workers,async batch=>{
 if(fatal)return;
 try{
  const response=await llm.chat({model:'gpt-6-luna',reasoning:{effort:'none'},max_completion_tokens:12000,response_format:{type:'json_schema',json_schema:{name:'uzbek_dictionary',strict:true,schema}},messages:[
   {role:'system',content:'You are a careful Korean-English-Uzbek lexicographic translator. Translate the provided SOURCE English meanings of real Korean headwords into concise Uzbek LATIN script. Preserve main distinct senses with semicolons, proper technical meanings and source qualifiers. Never guess literal components instead of source meanings. Do not add examples, TOPIK level, pronunciation or new meanings. If unable to accurately translate, set confident false and uz empty. These are draft AI translations, not official definitions. Return every input index exactly once; never change indexes.'},
   {role:'user',content:JSON.stringify(batch.map((entry,index)=>({index,word:entry.word,pos:entry.pos,source:entry.sourceGloss})))}
  ]});
  const raw=messageText(response);
  if(pilot)fs.writeFileSync('/home/ubuntu/dictionary-work/uz-pilot-response.txt',raw);
  const result=parseObject(raw);
  const seen=new Set();
  if(result.translations.length!==batch.length)throw new Error('Translation batch count mismatch');
  const rows=result.translations.map(value=>{
   if(!Number.isInteger(value.index)||value.index<0||value.index>=batch.length||seen.has(value.index))throw new Error('Translation index mismatch');seen.add(value.index);
   const uz=String(value.uz||'').trim().replace(/[‘’ʻʼ]/g,"'");
   const good=value.confident&&uz.length>=2&&uz.length<=500&&!/[가-힣\u0400-\u04ff]/u.test(uz)&&/[a-z]/i.test(uz);
   return {id:batch[value.index].id,uz:good?uz:'',status:good?'ai_draft':'source_only',...(pilot?{word:batch[value.index].word,source:batch[value.index].sourceGloss}:{})};
  });
  fs.appendFileSync(out,rows.map(JSON.stringify).join('\n')+'\n');rows.forEach(row=>completed.set(row.id,row));
  tokens+=response.usage?.total_tokens||0;batchDone++;
  console.log(JSON.stringify({finishedBatches:batchDone,totalBatches:batches.length,completed:completed.size,totalTokens:tokens}));
 }catch(error){
  if(error.fatal)fatal=error;
  console.error(JSON.stringify({batchError:error.message,fatal:!!error.fatal}));
 }
});
if(fatal)throw fatal;
const counts={};for(const row of completed.values())counts[row.status]=(counts[row.status]||0)+1;
console.log(JSON.stringify({complete:true,unique:completed.size,counts,out,totalTokens:tokens}));
if(completed.size<(pilot?20:entries.length))process.exitCode=2;
