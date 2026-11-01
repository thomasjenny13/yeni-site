#!/usr/bin/env node
/* ============================================================
   yéni.ch — chiffrement d'une galerie photo (CLI, sans dépendance)
   ------------------------------------------------------------
   Prend un dossier préparé par tools/redim.py (full/, thumb/, list.json)
   et écrit dans assets/galeries/<nom>/ :
     index.enc       liste des photos, même format JSON que les .enc
                     du site (sert aussi de témoin pour le mot de passe)
     t/<id>.bin      vignettes   } binaire : iv (12 o) + AES-GCM
     f/<id>.bin      photos      }
   Mot de passe propre à la galerie (pas le mot de passe familial).
   Le plus simple : galeries/publier.command sur kDrive (yéni/galeries/).

   Usage :
     GAL_PW='mot-de-passe' node tools/galerie.mjs <nom> <dossier> "<titre>" "<sous-titre>"
   ============================================================ */

import { webcrypto as crypto } from "node:crypto";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ITER = 250000;
const TE = new TextEncoder();
const b64e = (b) => Buffer.from(b).toString("base64");
const b64d = (s) => new Uint8Array(Buffer.from(s, "base64"));

const [name, srcDir, title = name, subtitle = ""] = process.argv.slice(2);
const pw = process.env.GAL_PW;
if (!name || !srcDir || !pw) {
  console.error("Usage : GAL_PW='…' node tools/galerie.mjs <nom> <dossier> \"<titre>\" \"<sous-titre>\"");
  process.exit(1);
}

const OUT = join(ROOT, "assets/galeries", name);
const INDEX = join(OUT, "index.enc");

// sel conservé d'une publication à l'autre (si même mot de passe) : une photo
// inchangée redonne alors exactement le même .bin, git ne renvoie que les nouveautés
let salt = crypto.getRandomValues(new Uint8Array(16));
if (existsSync(INDEX)) {
  const old = JSON.parse(await readFile(INDEX, "utf8"));
  const [k] = await derive(b64d(old.salt));
  try {
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(old.iv) }, k, b64d(old.ct));
    salt = b64d(old.salt);
  } catch { console.log("Nouveau mot de passe : nouveau sel, tout est rechiffré."); }
}
const [key, macKey] = await derive(salt);

// PBKDF2 → 64 octets : les 32 premiers = la clé AES (identique à ce que dérive
// le navigateur), les 32 suivants = clé HMAC pour un iv déterministe par photo
async function derive(salt) {
  const base = await crypto.subtle.importKey("raw", TE.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, base, 512));
  return Promise.all([
    crypto.subtle.importKey("raw", bits.slice(0, 32), "AES-GCM", false, ["encrypt", "decrypt"]),
    crypto.subtle.importKey("raw", bits.slice(32), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
  ]);
}

async function seal(bytes) {
  const iv = new Uint8Array(await crypto.subtle.sign("HMAC", macKey, bytes)).slice(0, 12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return out;
}

await rm(OUT, { recursive: true, force: true });
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
await writeFile(INDEX, JSON.stringify(
  { v: 1, kdf: "PBKDF2-SHA256", iter: ITER, salt: b64e(salt), iv: b64e(iv), ct: b64e(ct) }));

console.log(`${items.length} photos → assets/galeries/${name}/`);
