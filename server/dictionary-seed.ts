import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { db, closeDb } from "./database.js";
import { searchTerms } from "./dictionary.js";
type Entry={id:string;word:string;pos:string;sourceGloss:string;glossLanguage:string;romanization:string;sourceUrl:string};
const entries=readFileSync("data/korean-dictionary-source.jsonl","utf8").trim().split("\n").map(line=>JSON.parse(line) as Entry);
const translations=new Map<string,{uz:string;status:string}>();
try {for(const line of readFileSync("data/dictionary-uz.jsonl","utf8").split("\n")){try{const row=JSON.parse(line);translations.set(row.id,row);}catch{}}}catch{}
const normalizedPos=(value:string)=>value==="adjective"?"adj":value==="adverb"?"adv":["noun","verb","adj","adv"].includes(value)?value:"other";
let terms:[string,string][]=[];
try {
 for(let offset=0;offset<entries.length;offset+=200){
  const batch=entries.slice(offset,offset+200),values:unknown[]=[];
  for(const entry of batch){
   const translation=translations.get(entry.id),uz=translation?.uz||"";
   const id=createHash("sha256").update(entry.word).digest("hex");
   values.push(id,entry.word,normalizedPos(entry.pos),uz,entry.sourceGloss,entry.glossLanguage,entry.romanization||"",entry.sourceUrl,translation?.status||"source_only");
   for(const term of searchTerms(uz+" "+entry.sourceGloss+" "+entry.romanization+" "+entry.word).slice(0,60))terms.push([term,id]);
  }
  await db().query(`INSERT INTO dictionary_entries (id,word,pos,gloss_uz,source_gloss,gloss_language,romanization,source_url,translation_status) VALUES ${batch.map(()=>"(?,?,?,?,?,?,?,?,?)").join(",")} ON DUPLICATE KEY UPDATE gloss_uz=VALUES(gloss_uz),translation_status=VALUES(translation_status)`,values);
  if(offset%2000===0)console.log(JSON.stringify({entriesSeeded:Math.min(offset+200,entries.length)}));
 }
 // INSERT IGNORE is idempotent and never deletes existing records/indexes.
 for(let offset=0;offset<terms.length;offset+=500){
  const batch=terms.slice(offset,offset+500);
  await db().query(`INSERT IGNORE INTO dictionary_terms (term,entry_id) VALUES ${batch.map(()=>"(?,?)").join(",")}`,batch.flat());
  if(offset%25000===0)console.log(JSON.stringify({termsSeeded:Math.min(offset+500,terms.length)}));
 }
 const [counts]=await db().query("SELECT COUNT(*) AS words,SUM(gloss_uz <> '') AS uzbek FROM dictionary_entries");
 console.log(JSON.stringify({seedComplete:true,counts}));
} finally {await closeDb();}
