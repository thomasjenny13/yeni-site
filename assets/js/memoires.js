/* ============================================================
   yéni.ch — les écrits de Claude (articles / textes)
   Données : assets/data/memoires.json.enc  (voir docs/FORMAT.md)
   ============================================================ */

(function () {
  if (!YeniCrypto.requireUnlock()) return;

  const reader = document.getElementById("reader");
  const status = document.getElementById("status");

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const paras = (t) => String(t || "").split(/\n{2,}/)
    .map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("");

  let items = [];

  function showList() {
    reader.innerHTML =
      `<header class="reader-head">` +
      `<h1>${esc(data.titre || "Les écrits de Claude")}</h1>` +
      (data.auteur ? `<p class="reader-by">${esc(data.auteur)}</p>` : "") +
      (data.intro ? `<p class="reader-intro">${esc(data.intro)}</p>` : "") +
      `</header>` +
      (items.length
        ? `<ul class="text-list">` + items.map((t, i) =>
            `<li><a href="#" data-i="${i}"><span class="tl-title">${esc(t.titre || "Sans titre")}</span>` +
            (t.date ? `<span class="tl-date">${esc(t.date)}</span>` : "") + `</a></li>`).join("") + `</ul>`
        : `<p class="muted">Aucun texte pour l'instant.</p>`);
    reader.querySelectorAll("[data-i]").forEach((a) =>
      a.addEventListener("click", (e) => { e.preventDefault(); showText(Number(a.dataset.i)); }));
    window.scrollTo(0, 0);
  }

  function showText(i) {
    const t = items[i];
    if (!t) return;
    reader.innerHTML =
      `<button class="lock-btn reader-back" type="button">← Tous les textes</button>` +
      `<article class="text-body">` +
      `<h1>${esc(t.titre || "Sans titre")}</h1>` +
      (t.date ? `<p class="reader-by">${esc(t.date)}</p>` : "") +
      paras(t.texte) +
      `</article>`;
    reader.querySelector(".reader-back").addEventListener("click", showList);
    window.scrollTo(0, 0);
  }

  let data = {};
  YeniCrypto.loadEncrypted("assets/data/memoires.json.enc")
    .then((m) => {
      data = m || {};
      items = Array.isArray(data.textes) ? data.textes
        : Array.isArray(data.chapitres) ? data.chapitres : [];
      showList();
    })
    .catch((err) => {
      if (status) status.textContent = "Impossible de charger les écrits : " + err.message;
    });
})();
