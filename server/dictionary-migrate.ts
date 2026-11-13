import { db, closeDb } from "./database.js";
try {
  await db().execute(`CREATE TABLE IF NOT EXISTS dictionary_entries (
    id CHAR(64) NOT NULL PRIMARY KEY,
    word VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    pos VARCHAR(32) NOT NULL,
    gloss_uz TEXT NOT NULL,
    source_gloss TEXT NOT NULL,
    gloss_language VARCHAR(8) NOT NULL,
    romanization VARCHAR(500) NOT NULL DEFAULT '',
    source_url VARCHAR(1200) NOT NULL,
    translation_status VARCHAR(24) NOT NULL DEFAULT 'source_only',
    UNIQUE KEY dictionary_word_uq(word),
    KEY dictionary_pos_word_idx(pos,word)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // The managed MySQL-compatible database does not support FULLTEXT.
  // Prefix lookups use this bounded B-tree inverted index instead of a full table scan.
  await db().execute(`CREATE TABLE IF NOT EXISTS dictionary_terms (
    term VARCHAR(96) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    entry_id CHAR(64) NOT NULL,
    PRIMARY KEY(term,entry_id),
    KEY dictionary_terms_entry_idx(entry_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  console.log("Additive dictionary and B-tree term tables ready; existing data untouched.");
} finally { await closeDb(); }
