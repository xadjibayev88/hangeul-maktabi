import { z } from "zod";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "./database.js";
const input = z.object({q:z.string().trim().max(64).default(""),page:z.coerce.number().int().min(1).max(2000).default(1),limit:z.coerce.number().int().min(1).max(48).default(24),pos:z.enum(["all","noun","verb","adj","adv","other"]).default("all")});
export function dictionaryQuery(value: unknown) { return input.parse(value); }
export function likePrefix(value: string) { return value.replace(/[=%_]/g,char=>"="+char)+"%"; }
const stops = new Set(["the","and","for","with","that","this","from","into","which","va","bir","bu","bilan","uchun","yoki"]);
export function searchTerms(value: string): string[] {
  return [...new Set(value.normalize("NFC").toLowerCase().replace(/[‘’ʻʼ]/g,"'").split(/[^\p{L}\p{N}]+/u).filter(term=>term.length>=2&&term.length<=96&&!stops.has(term)))];
}
const cache = new Map<string,{expires:number;value:Promise<unknown>}>();
let active=0;
export async function searchDictionary(query: unknown): Promise<unknown> {
  const params=dictionaryQuery(query),key=JSON.stringify(params),cached=cache.get(key);
  if(cached&&cached.expires>Date.now()) return cached.value;
  if(active>=8) throw Object.assign(new Error("Dictionary is busy"),{code:"dictionary_busy"});
  if(cache.size>=200) cache.delete(cache.keys().next().value!);
  const value=(async()=>{
    active++;
    try {
      const conditions:string[]=[],args:string[]=[];
      if(params.pos!=="all"){conditions.push("d.pos = ?");args.push(params.pos);}
      if(params.q){
        if(/^[가-힣\s·-]+$/u.test(params.q)){conditions.push("d.word LIKE ? ESCAPE '='");args.push(likePrefix(params.q));}
        else {
          const terms=searchTerms(params.q).slice(0,3);
          if(!terms.length) return {entries:[],total:0,page:params.page,limit:params.limit,pages:0};
          for(const term of terms){conditions.push("d.id IN (SELECT entry_id FROM dictionary_terms WHERE term LIKE ? ESCAPE '=')");args.push(likePrefix(term));}
        }
      }
      const where=conditions.length?" WHERE "+conditions.join(" AND "):"";
      const [counts]=await db().execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM dictionary_entries d"+where,args);
      const total=Number(counts[0].total);
      const ordering=params.q ? "d.word ASC" : "(d.gloss_uz = '') ASC,(d.translation_status = 'legacy_ai') DESC,d.word ASC";
      const [rows]=await db().query<RowDataPacket[]>(`SELECT d.id,d.word,d.pos,d.gloss_uz AS uz,d.source_gloss AS sourceGloss,d.gloss_language AS glossLanguage,d.romanization,d.source_url AS sourceUrl,d.translation_status AS translationStatus FROM dictionary_entries d${where} ORDER BY ${ordering} LIMIT ? OFFSET ?`,[...args,params.limit,(params.page-1)*params.limit]);
      return {entries:rows,total,page:params.page,limit:params.limit,pages:Math.ceil(total/params.limit)};
    } finally {active--;}
  })();
  cache.set(key,{expires:Date.now()+60000,value});
  value.catch(()=>cache.delete(key));
  return value;
}

let statisticsCache:{expires:number;value:Promise<Record<string,number>>}|null=null;
export async function dictionaryStatistics():Promise<Record<string,number>> {
 if(statisticsCache&&statisticsCache.expires>Date.now())return statisticsCache.value;
 const value=(async()=>{
  const [rows]=await db().query<RowDataPacket[]>("SELECT COUNT(*) AS dictionaryWords,SUM(gloss_uz <> '') AS uzbekWords,SUM(gloss_uz = '') AS sourceOnlyWords,SUM(translation_status = 'ai_draft') AS aiDraftWords,SUM(translation_status = 'legacy_ai') AS legacyWords FROM dictionary_entries");
  return Object.fromEntries(Object.entries(rows[0]).map(([key,value])=>[key,Number(value)]));
 })();
 statisticsCache={expires:Date.now()+60000,value};value.catch(()=>{statisticsCache=null;});return value;
}
