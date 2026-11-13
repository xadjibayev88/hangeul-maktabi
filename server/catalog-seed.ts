import { readFileSync } from "node:fs";
import { db, closeDb } from "./database.js";
const value = JSON.parse(readFileSync("public/catalog.json", "utf8"));
try {
  await db().execute("INSERT IGNORE INTO catalog (id,kind,title,content) VALUES (?,?,?,?)", ["learning-v2", "learning-catalog", "Go Topic — koreys tili o‘quv katalogi", JSON.stringify(value)]);
  console.log("Learning catalog v2 exists in MySQL; existing owner content was not overwritten.");
} finally { await closeDb(); }
