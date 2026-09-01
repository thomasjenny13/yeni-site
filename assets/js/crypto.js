/* ============================================================
   yéni.ch — déchiffrement côté client
   ------------------------------------------------------------
   Le contenu privé (arbre, cartes) est stocké dans le dépôt
   sous forme de fichiers .enc = JSON chiffré en AES-GCM 256,
   clé dérivée du mot de passe familial via PBKDF2-SHA256.

   Le dépôt étant public (GitHub Pages), personne ne peut lire
   le contenu sans le mot de passe. Ce n'est pas une sécurité
   « bancaire » (un mot de passe partagé reste partagé), mais
   c'est du vrai chiffrement : suffisant pour de la vie privée
   familiale.

   Fichier .enc :
   { "v":1, "kdf":"PBKDF2-SHA256", "iter":250000,
     "salt":"<base64>", "iv":"<base64>", "ct":"<base64>" }
   ============================================================ */

const YeniCrypto = (() => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const SESSION_KEY = "yeni.key";       // clé brute (base64) en sessionStorage
  const PROBE_URL = "assets/data/probe.enc"; // petit fichier témoin pour valider le mdp

  const b64 = {
    enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
    dec: (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0)),
  };

  async function deriveKey(password, salt, iter) {
    const base = await crypto.subtle.importKey(
      "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  }

  async function decryptPayload(payload, key) {
    const iv = b64.dec(payload.iv);
    const ct = b64.dec(payload.ct);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return JSON.parse(dec.decode(plain));
  }

  /* ----- session ----- */
  async function storeKey(key) {
    const raw = await crypto.subtle.exportKey("raw", key);
    try { sessionStorage.setItem(SESSION_KEY, b64.enc(raw)); } catch (_) {}
  }
  async function loadSessionKey() {
    let raw;
    try { raw = sessionStorage.getItem(SESSION_KEY); } catch (_) { raw = null; }
    if (!raw) return null;
    return crypto.subtle.importKey(
      "raw", b64.dec(raw), { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
    );
  }
  function lock() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
  }
  function isUnlocked() {
    try { return !!sessionStorage.getItem(SESSION_KEY); } catch (_) { return false; }
  }

  /* ----- API haut niveau ----- */

  // essaie de déverrouiller avec un mot de passe ; renvoie true/false
  async function unlock(password) {
    const res = await fetch(PROBE_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("Fichier témoin introuvable (" + PROBE_URL + ")");
    const probe = await res.json();
    const salt = b64.dec(probe.salt);
    const key = await deriveKey(password, salt, probe.iter || 250000);
    try {
      await decryptPayload(probe, key);      // lève si mauvais mot de passe
    } catch (_) {
      return false;
    }
    await storeKey(key);
    return true;
  }

  // charge et déchiffre un fichier .enc -> objet JS
  async function loadEncrypted(url) {
    const key = await loadSessionKey();
    if (!key) throw new Error("verrouillé");
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Introuvable : " + url);
    const payload = await res.json();
    return decryptPayload(payload, key);
  }

  // redirige vers la page de login si pas déverrouillé
  function requireUnlock(loginUrl = "prive.html") {
    if (!isUnlocked()) {
      const back = encodeURIComponent(location.pathname.split("/").pop() + location.search);
      location.replace(loginUrl + "?next=" + back);
      return false;
    }
    return true;
  }

  return { unlock, lock, isUnlocked, loadEncrypted, requireUnlock };
})();
