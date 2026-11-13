import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync("public/index.html", "utf8");
const start = source.indexOf("const CONS="), end = source.indexOf("const DKEY=");
if (start < 0 || end <= start) throw new Error("Learning data boundary is missing");
const data = vm.runInNewContext(source.slice(start, end) + "\n({CONS,VOWS,TOPICS,PHRASES,GRAM,GCATS,LVMAP,READ,LISTEN,DPOS,DRAW})", {}, { timeout: 1000 });
const catalog = { version: 2, data, media: { aiHero: "/manus-storage/async-images/4vzI5sf6VBdAmnp65tFPyA/image-1.webp" } };
writeFileSync("public/catalog.json", JSON.stringify(catalog) + "\n");
console.log(JSON.stringify({ topics: Object.keys(data.TOPICS).length, grammar: data.GRAM.length, dictionary: data.DRAW.length, bytes: Buffer.byteLength(JSON.stringify(catalog)) }));
