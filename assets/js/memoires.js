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
      case "h": return `<h2>${esc(b.t)}</h2>`;
      case "lead": return `<p class="article-lead${b.dropcap ? " dropcap" : ""}">${inline(b.t)}</p>`;
      case "quote": return `<blockquote class="pull-quote"><p>${inline(b.t)}</p>` +
        (b.src ? `<cite>— ${inline(b.src)}</cite>` : "") + `</blockquote>`;
      case "box": return `<aside class="article-box">` +
        (b.kicker ? `<p class="box-kicker">${esc(b.kicker)}</p>` : "") +
        (b.titre ? `<h3>${esc(b.titre)}</h3>` : "") +
        `<ul>${(b.items || []).map((i) => `<li>${inline(i)}</li>`).join("")}</ul></aside>`;
      case "refs": return `<section class="article-refs"><h2>Références</h2><ol>` +
        (b.items || []).map((i) => `<li>${inline(i)}</li>`).join("") + `</ol></section>`;
      default: return `<p${b.dropcap ? ' class="dropcap"' : ""}>${inline(b.t)}</p>`;
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
        ? `<dl class="article-meta">` + Object.entries(t.meta)
            .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${inline(v)}</dd></div>`).join("") + `</dl>`
        : "";
      reader.className = "reader wide";
      reader.innerHTML = back +
        `<article class="article">` +
        (t.kicker || t.date
          ? `<p class="article-kicker">${esc(t.kicker || "")}${t.kicker && t.date ? " · " : ""}${esc(t.date || "")}</p>`
          : "") +
        (t.tags && t.tags.length ? `<p class="article-tags">${t.tags.map(esc).join(" · ")}</p>` : "") +
        `<h1 class="article-title">${esc(t.titre)}</h1>` +
        (t.standfirst ? `<p class="article-standfirst">${inline(t.standfirst)}</p>` : "") +
        meta +
        `<div class="article-body">${renderCorps(t.corps)}</div>` +
        (t.note ? `<p class="article-note">${inline(t.note)}</p>` : "") +
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
