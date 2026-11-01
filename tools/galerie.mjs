#!/usr/bin/env node
/* ============================================================
   yéni.ch — chiffrement d'une galerie photo (CLI, sans dépendance)
   ------------------------------------------------------------
   Prend un dossier préparé (full/NNN.jpg, thumb/NNN.jpg, list.json)
   et écrit dans assets/galeries/<nom>/ :
     index.enc       liste des photos, même format JSON que les .enc
                     du site (sert aussi de témoin pour le mot de passe)
     t/NNN.bin       vignettes   } binaire : iv (12 o) + AES-GCM
     f/NNN.bin       photos      }
   Mot de passe propre à la galerie (pas le mot de passe familial).

   Usage :
     GAL_PW='mot-de-passe' node tools/galerie.mjs <nom> <dossier> "<titre>" "<sous-titre>"
   ============================================================ */

import { webcrypto as crypto } from "node:crypto";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ITER = 250000;
const TE = new TextEncoder();
const b64e = (b) => Buffer.from(b).toString("base64");

const [name, srcDir, title = name, subtitle = ""] = process.argv.slice(2);
const pw = process.env.GAL_PW;
if (!name || !srcDir || !pw) {
  console.error("Usage : GAL_PW='…' node tools/galerie.mjs <nom> <dossier> \"<titre>\" \"<sous-titre>\"");
  process.exit(1);
}

const salt = crypto.getRandomValues(new Uint8Array(16));
const base = await crypto.subtle.importKey("raw", TE.encode(pw), "PBKDF2", false, ["deriveKey"]);
const key = await crypto.subtle.deriveKey(
  { name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" },
  base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);

async function seal(bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return out;
}

const OUT = join(ROOT, "assets/galeries", name);
await rm(OUT, { recursive: true, force: true });   // nouveau sel : tout est réécrit
await mkdir(join(OUT, "t"), { recursive: true });
await mkdir(join(OUT, "f"), { recursive: true });

const items = JSON.parse(await readFile(join(srcDir, "list.json"), "utf8"));
for (const it of items) {
  await writeFile(join(OUT, "t", it.id + ".bin"), await seal(await readFile(join(srcDir, "thumb", it.id + ".jpg"))));
  await writeFile(join(OUT, "f", it.id + ".bin"), await seal(await readFile(join(srcDir, "full", it.id + ".jpg"))));
}

const index = { title, subtitle, photos: items.map(({ id, name, w, h }) => ({ id, name, w, h })) };
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, TE.encode(JSON.stringify(index)));
await writeFile(join(OUT, "index.enc"), JSON.stringify(
  { v: 1, kdf: "PBKDF2-SHA256", iter: ITER, salt: b64e(salt), iv: b64e(iv), ct: b64e(ct) }));

console.log(`${items.length} photos → assets/galeries/${name}/`);
