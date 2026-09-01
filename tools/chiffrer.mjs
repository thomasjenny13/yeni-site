#!/usr/bin/env node
/* ============================================================
   yéni.ch — chiffrement du contenu privé (CLI, sans dépendance)
   ------------------------------------------------------------
   Chiffre chaque fichier de content/private/ en AES-GCM 256,
   clé dérivée du mot de passe familial (PBKDF2-SHA256), et
   écrit les .enc dans assets/data/. Crée aussi probe.enc.

   Usage :
     node tools/chiffrer.mjs                # demande le mot de passe
     YENI_PW='mot-de-passe' node tools/chiffrer.mjs
     node tools/chiffrer.mjs --decrypt      # sens inverse (réécrit content/private/)

   Tous les fichiers partagent le sel de probe.enc (réutilisé
   s'il existe, sinon généré).
   ============================================================ */

import { webcrypto as crypto } from "node:crypto";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "content/private");
const OUT = join(ROOT, "assets/data");
const PROBE = join(OUT, "probe.enc");
const ITER = 250000;

const TE = new TextEncoder(), TD = new TextDecoder();
const b64e = (b) => Buffer.from(b).toString("base64");
const b64d = (s) => new Uint8Array(Buffer.from(s, "base64"));

async function deriveKey(pw, salt, iter) {
  const base = await crypto.subtle.importKey("raw", TE.encode(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function enc(obj, key, salt, iter) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, TE.encode(JSON.stringify(obj)));
  return { v: 1, kdf: "PBKDF2-SHA256", iter, salt: b64e(salt), iv: b64e(iv), ct: b64e(ct) };
}
async function dec(payload, pw) {
  const key = await deriveKey(pw, b64d(payload.salt), payload.iter || ITER);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(payload.iv) }, key, b64d(payload.ct));
  return JSON.parse(TD.decode(plain));
}
function ask(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a); }));
}
async function walk(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p, base));
    else if (e.name.endsWith(".json")) out.push(p.slice(base.length + 1));
  }
  return out;
}

const decryptMode = process.argv.includes("--decrypt");
const pw = process.env.YENI_PW || await ask("Mot de passe familial : ");
if (!pw) { console.error("Mot de passe vide."); process.exit(1); }

if (decryptMode) {
  for (const rel of await listEnc(OUT)) {
    const payload = JSON.parse(await readFile(join(OUT, rel), "utf8"));
    const obj = await dec(payload, pw);
    const dest = join(SRC, rel.replace(/\.enc$/, ""));
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, JSON.stringify(obj, null, 2) + "\n");
    console.log("→", dest.slice(ROOT.length + 1));
  }
  process.exit(0);
}

// --- chiffrer ---
let salt, iter = ITER;
if (existsSync(PROBE)) {
  const probe = JSON.parse(await readFile(PROBE, "utf8"));
  salt = b64d(probe.salt); iter = probe.iter || ITER;
  try { await dec(probe, pw); }
  catch { console.error("Le mot de passe ne correspond pas à probe.enc existant.\n" +
    "Supprime assets/data/probe.enc pour repartir d'un nouveau sel (invalide tous les .enc)."); process.exit(1); }
  console.log("Sel réutilisé depuis probe.enc.");
} else {
  salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pw, salt, iter);
  await mkdir(OUT, { recursive: true });
  await writeFile(PROBE, JSON.stringify(await enc({ ok: true, app: "yéni" }, key, salt, iter)));
  console.log("probe.enc créé (nouveau sel).");
}

const key = await deriveKey(pw, salt, iter);
for (const rel of await walk(SRC)) {
  const obj = JSON.parse(await readFile(join(SRC, rel), "utf8"));
  const dest = join(OUT, rel + ".enc");
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, JSON.stringify(await enc(obj, key, salt, iter)));
  console.log("→ assets/data/" + rel + ".enc");
}
console.log("\nFait. Commit + push pour publier.");

async function listEnc(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await listEnc(p, base));
    else if (e.name.endsWith(".json.enc")) out.push(p.slice(base.length + 1));
  }
  return out;
}
