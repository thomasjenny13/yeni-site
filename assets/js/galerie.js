/* ============================================================
   yéni.ch — galerie photo chiffrée
   ------------------------------------------------------------
   Une galerie = assets/galeries/<nom>/ (voir tools/galerie.mjs) :
   index.enc (liste, JSON chiffré) + t/NNN.bin, f/NNN.bin
   (iv 12 o + AES-GCM). Mot de passe propre à la galerie,
   indépendant du mot de passe familial.

   La page déclare <body data-galerie="<nom>" data-base="../">.
   ============================================================ */

(() => {
  const body = document.body;
  const NAME = body.dataset.galerie;
  const DIR = (body.dataset.base || "") + "assets/galeries/" + NAME + "/";
  const SESSION_KEY = "yeni.galerie." + NAME;
  const TE = new TextEncoder(), TD = new TextDecoder();
  const b64 = {
    enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
    dec: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
  };
  const $ = (id) => document.getElementById(id);

  let key = null, photos = [];

  /* ----- chiffrement ----- */
  async function deriveKey(pw, salt, iter) {
    const base = await crypto.subtle.importKey("raw", TE.encode(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
  }
  async function fetchIndex() {
    const res = await fetch(DIR + "index.enc", { cache: "no-store" });
    if (!res.ok) throw new Error("Galerie introuvable");
    return res.json();
  }
  async function openIndex(payload, k) {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.dec(payload.iv) }, k, b64.dec(payload.ct));
    return JSON.parse(TD.decode(plain));
  }
  async function loadImage(path) {
    const res = await fetch(DIR + path);
    if (!res.ok) throw new Error("Introuvable : " + path);
    const buf = new Uint8Array(await res.arrayBuffer());
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.subarray(0, 12) }, key, buf.subarray(12));
    return URL.createObjectURL(new Blob([plain], { type: "image/jpeg" }));
  }

  /* ----- déverrouillage ----- */
  async function trySession() {
    let raw = null;
    try { raw = sessionStorage.getItem(SESSION_KEY); } catch (_) {}
    if (!raw) return null;
    try {
      const k = await crypto.subtle.importKey("raw", b64.dec(raw), { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
      return [k, await openIndex(await fetchIndex(), k)];
    } catch (_) { return null; }
  }

  async function start() {
    const pw = $("pw"), err = $("err"), form = $("unlockForm");
    if (!window.isSecureContext || !(window.crypto && crypto.subtle)) {
      err.textContent = "Ouvrir la page en https.";
      pw.disabled = true;
      return;
    }
    const s = await trySession();
    if (s) return show(...s);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.textContent = "";
      pw.disabled = true;
      try {
        const payload = await fetchIndex();
        const k = await deriveKey(pw.value, b64.dec(payload.salt), payload.iter || 250000);
        let index;
        try { index = await openIndex(payload, k); }
        catch (_) { err.textContent = "Mot de passe incorrect."; pw.disabled = false; pw.select(); return; }
        try { sessionStorage.setItem(SESSION_KEY, b64.enc(await crypto.subtle.exportKey("raw", k))); } catch (_) {}
        show(k, index);
      } catch (ex) {
        err.textContent = "Erreur : " + ex.message;
        pw.disabled = false;
      }
    });
    pw.focus();
  }

  /* ----- grille ----- */
  function show(k, index) {
    key = k;
    photos = index.photos;
    document.title = index.title;
    $("galTitle").textContent = index.title;
    $("galSub").textContent = index.subtitle || "";
    $("lockScreen").remove();
    body.classList.remove("is-locked");
    $("galerie").hidden = false;

    const grid = $("galGrid");
    const queue = [];
    let active = 0;
    const pump = () => {
      while (active < 6 && queue.length) {
        const fig = queue.shift();
        active++;
        loadImage("t/" + fig.dataset.id + ".bin")
          .then((url) => { const img = fig.querySelector("img"); img.src = url; img.onload = () => fig.classList.add("is-loaded"); })
          .catch(() => fig.classList.add("is-error"))
          .finally(() => { active--; pump(); });
      }
    };
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { io.unobserve(en.target); queue.push(en.target); }
      pump();
    }, { rootMargin: "600px 0px" });

    photos.forEach((p, i) => {
      const r = p.w / p.h;
      const fig = document.createElement("button");
      fig.type = "button";
      fig.className = "gal-item";
      fig.dataset.id = p.id;
      fig.style.flexGrow = r;
      fig.style.flexBasis = `calc(${r} * var(--row-h))`;
      fig.style.aspectRatio = `${p.w} / ${p.h}`;
      fig.setAttribute("aria-label", "Photo " + (i + 1));
      fig.append(document.createElement("img"));
      fig.addEventListener("click", () => openLightbox(i));
      grid.append(fig);
      io.observe(fig);
    });
  }

  /* ----- visionneuse ----- */
  const cache = new Map();   // id -> Promise<blob url>, garde les plus récentes
  function full(i) {
    const id = photos[i].id;
    const p = cache.get(id) || loadImage("f/" + id + ".bin");
    cache.delete(id);
    cache.set(id, p);            // en dernier = la plus récente
    if (cache.size > 8) {
      const [oldId, oldP] = cache.entries().next().value;
      cache.delete(oldId);
      oldP.then(URL.revokeObjectURL, () => {});
    }
    return p;
  }

  let cur = -1;
  async function openLightbox(i) {
    cur = i;
    const lb = $("lightbox"), img = $("lbImg");
    lb.hidden = false;
    body.classList.add("lb-open");
    $("lbCount").textContent = (i + 1) + " / " + photos.length;
    lb.classList.add("is-loading");
    // vignette tout de suite, la grande image remplace dès qu'elle arrive
    const thumb = document.querySelector(`.gal-item[data-id="${photos[i].id}"] img`);
    img.src = thumb && thumb.src ? thumb.src : "";
    try {
      const url = await full(i);
      if (cur !== i) return;
      img.src = url;
      lb.classList.remove("is-loading");
    } catch (_) { /* reste sur la vignette */ }
    if (i + 1 < photos.length) full(i + 1);
    if (i > 0) full(i - 1);
  }
  function closeLightbox() {
    cur = -1;
    $("lightbox").hidden = true;
    body.classList.remove("lb-open");
  }
  const step = (d) => { if (cur >= 0) openLightbox((cur + d + photos.length) % photos.length); };

  $("lbClose").addEventListener("click", closeLightbox);
  $("lbPrev").addEventListener("click", () => step(-1));
  $("lbNext").addEventListener("click", () => step(1));
  $("lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox" || e.target.id === "lbStage") closeLightbox(); });
  document.addEventListener("keydown", (e) => {
    if (cur < 0) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
  });
  let x0 = null;
  $("lbStage").addEventListener("touchstart", (e) => { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  $("lbStage").addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    x0 = null;
  });

  start();
})();
