/* ============================================================
   yéni.ch — les écrits du Claude (articles / textes)
   Données : assets/data/memoires.json.enc  (voir docs/FORMAT.md)
   ============================================================ */

(function () {
  if (!YeniCrypto.requireUnlock()) return;

  const reader = document.getElementById("reader");
  const status = document.getElementById("status");

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const inline = (s) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  const paras = (t) => String(t || "").split(/\n{2,}/)
    .map((p) => `<p>${inline(p.trim()).replace(/\n/g, "<br>")}</p>`).join("");

  let data = {};
  let items = [];

  /* ---------- liste ---------- */
  function showList() {
    reader.className = "reader";
    reader.innerHTML =
      `<header class="reader-head">` +
      `<h1>${esc(data.titre || "Les écrits du Claude")}</h1>` +
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

  /* ---------- un article ---------- */
  function block(b) {
    switch (b.type) {
      case "h": return `<h2 class="gz-crosshead">${esc(b.t)}</h2>`;
      case "lead": return `<p class="gz-lead">${inline(b.t)}</p>`;
      case "quote": return `<blockquote class="gz-extract"><p>${inline(b.t)}</p>` +
        (b.src ? `<cite>${inline(b.src)}</cite>` : "") + `</blockquote>`;
      case "box": return `<aside class="gz-panel">` +
        (b.kicker ? `<p class="gz-panel-kicker">${esc(b.kicker)}</p>` : "") +
        (b.titre ? `<h3>${esc(b.titre)}</h3>` : "") +
        `<ul>${(b.items || []).map((i) => `<li>${inline(i)}</li>`).join("")}</ul></aside>`;
      case "refs": return `<section class="gz-sources"><h2>Sources</h2><ol>` +
        (b.items || []).map((i) => `<li>${inline(i)}</li>`).join("") + `</ol></section>`;
      case "figure": return `<figure class="gz-figure${b.wide ? " gz-figure--wide" : ""}">` +
        `<img src="${esc(b.src)}" alt="${esc(b.alt || "")}" loading="lazy">` +
        ((b.caption || b.credit)
          ? `<figcaption>${b.caption ? inline(b.caption) : ""}` +
            (b.credit ? ` <span class="gz-credit">${inline(b.credit)}</span>` : "") + `</figcaption>`
          : "") +
        `</figure>`;
      default: return `<p${b.dropcap ? ' class="gz-dropcap"' : ""}>${inline(b.t)}</p>`;
    }
  }

  // regroupe les paragraphes qui se suivent en blocs à deux colonnes ;
  // titres, encadré, citations et références restent pleine largeur
  function renderCorps(corps) {
    let html = "", buf = [];
    const flush = () => {
      if (!buf.length) return;
      // un paragraphe isolé reste pleine largeur (éviter un veuf coupé en deux colonnes)
      html += buf.length === 1 ? buf[0] : `<div class="cols">${buf.join("")}</div>`;
      buf = [];
    };
    corps.forEach((b) => {
      if (!b.type || b.type === "p") buf.push(block(b));
      else if (b.type === "figure" && !b.wide) buf.push(block(b));  // illustration dans le fil des colonnes
      else { flush(); html += block(b); }
    });
    flush();
    return html;
  }

  function showText(i) {
    const t = items[i];
    if (!t) return;
    const back = `<button class="lock-btn reader-back" type="button">← Tous les textes</button>`;

    if (Array.isArray(t.corps)) {
      const meta = t.meta && Object.keys(t.meta).length
        ? `<dl class="gz-meta">` + Object.entries(t.meta)
            .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${inline(v)}</dd></div>`).join("") + `</dl>`
        : "";
      reader.className = "reader wide";
      reader.innerHTML = back +
        `<article class="gazette">` +
        `<header class="gz-masthead">` +
          `<div class="gz-rule gz-rule--thickthin"></div>` +
          `<p class="gz-folio">` +
            `<span class="gz-tag">${esc(t.kicker || "Les écrits du Claude")}</span>` +
            `<span>${esc(t.date || "")}</span>` +
          `</p>` +
          `<h1 class="gz-headline">${esc(t.titre)}</h1>` +
          `<div class="gz-dash"></div>` +
          (t.standfirst ? `<p class="gz-deck">${inline(t.standfirst)}</p>` : "") +
          (t.tags && t.tags.length ? `<p class="gz-tags">${t.tags.map(esc).join(" · ")}</p>` : "") +
          `<div class="gz-rule gz-rule--thinthick"></div>` +
        `</header>` +
        meta +
        `<div class="gz-body">${renderCorps(t.corps)}</div>` +
        (t.note ? `<p class="gz-colophon">${inline(t.note)}</p>` : "") +
        `<div class="gz-endmark">⁂</div>` +
        `</article>`;
    } else {
      reader.className = "reader";
      reader.innerHTML = back +
        `<article class="text-body"><h1>${esc(t.titre || "Sans titre")}</h1>` +
        (t.date ? `<p class="reader-by">${esc(t.date)}</p>` : "") +
        paras(t.texte) + `</article>`;
    }
    reader.querySelector(".reader-back").addEventListener("click", showList);
    window.scrollTo(0, 0);
  }

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
