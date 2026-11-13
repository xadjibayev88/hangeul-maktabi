import test from "node:test";
import assert from "node:assert/strict";
import {dictionaryQuery,likePrefix,searchTerms} from "./dictionary.js";
test("dictionary pagination and query sizes stay bounded",()=>{
 assert.deepEqual(dictionaryQuery({}),{q:"",page:1,limit:24,pos:"all"});
 assert.throws(()=>dictionaryQuery({limit:30000}));
 assert.throws(()=>dictionaryQuery({page:-1}));
 assert.throws(()=>dictionaryQuery({q:"a".repeat(65)}));
});
test("LIKE syntax is escaped and search tokens are normalized",()=>{
 assert.equal(likePrefix("학%_="),"학=%=_==%");
 assert.deepEqual(searchTerms("+maktab -(delete)*"),["maktab","delete"]);
 assert.deepEqual(searchTerms("o‘qish va maktab"),["qish","maktab"]);
});
