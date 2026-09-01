/* ============================================================
   yéni.ch — arbre généalogique
   Vue « focus + contexte » : tout l'arbre reste affiché, la
   personne au centre et sa famille proche sont en pleine
   opacité, le reste en transparence pour garder le repère.
   Données : assets/data/arbre.json.enc  (voir docs/FORMAT.md)
   ============================================================ */

(function () {
  if (!YeniCrypto.requireUnlock()) return;

  document.getElementById("lockBtn").addEventListener("click", () => {
    YeniCrypto.lock();
    location.href = "index.html";
  });

  const scroll = document.getElementById("treeScroll");
  const status = document.getElementById("status");
  const rootSel = document.getElementById("rootSel");
  const search = document.getElementById("search");
  const peopleList = document.getElementById("peopleList");
  const countEl = document.getElementById("count");
  const zoomInput = document.getElementById("zoom");
  const fitBtn = document.getElementById("fitBtn");
  const panel = document.getElementById("panel");
  const panelBody = document.getElementById("panelBody");

  let data = null;
  let rootId = null;         // sommet de l'arbre affiché
  let focusId = null;        // personne au centre
  const nodeById = new Map(); // id -> élément .node (arbre courant)

  /* ---------- helpers données ---------- */
  const I = (id) => data.individus[id];
  const fullName = (id) => {
    const p = I(id);
    if (!p) return "?";
    return [p.prenom, p.nom].filter(Boolean).join(" ") || "(sans nom)";
  };
  const year = (d) => (d && d.date ? String(d.date).slice(0, 4) : "");
  const lifespan = (p) => {
    const n = year(p.naissance), m = year(p.deces);
    if (!n && !m) return "";
    return `${n || "?"}–${m || (p.deces ? "?" : "")}`;
  };
  const familiesOf = (id) =>
    Object.values(data.familles).filter((f) => (f.conjoints || []).includes(id));
  const parentFamilyOf = (id) =>
    Object.values(data.familles).find((f) => (f.enfants || []).includes(id)) || null;
  const spousesOf = (id) => {
    const s = new Set();
    familiesOf(id).forEach((f) => (f.conjoints || []).forEach((c) => { if (c !== id) s.add(c); }));
    return [...s];
  };
  const childrenOf = (id) => {
    const c = [];
    familiesOf(id).forEach((f) => (f.enfants || []).forEach((k) => c.push(k)));
    return c;
  };
  function topmostAncestor(id) {
    let cur = id;
    for (let i = 0; i < 40; i++) {
      const pf = parentFamilyOf(cur);
      if (!pf || !(pf.conjoints || []).length) return cur;
      // suit le parent « de sang » (celui qui a lui-même des parents
      // connus), pour ne pas s'arrêter sur un·e conjoint·e marié·e dans
      const blood = (pf.conjoints || []).find((c) => parentFamilyOf(c));
      cur = blood || pf.conjoints[0];
    }
    return cur;
  }

  /* ---------- ensemble « famille proche » du focus ---------- */
  function kinOf(fid) {
    const k = new Set([fid]);
    (function up(id) {
      const pf = parentFamilyOf(id);
      if (!pf) return;
      (pf.conjoints || []).forEach((p) => { if (!k.has(p)) { k.add(p); up(p); } });
    })(fid);
    const pf = parentFamilyOf(fid);
    (pf?.enfants || []).forEach((s) => k.add(s));   // frères / sœurs
    spousesOf(fid).forEach((s) => k.add(s));
    childrenOf(fid).forEach((c) => {
      k.add(c);
      spousesOf(c).forEach((s) => k.add(s));
      childrenOf(c).forEach((g) => k.add(g));        // petits-enfants
    });
    return k;
  }

  /* ---------- rendu ---------- */
  function nodeEl(id) {
    const p = I(id);
    const li = document.createElement("li");
    const box = document.createElement("div");
    box.className = "node" + (p && p.sexe === "F" ? " sex-F" : "");
    box.tabIndex = 0;
    box.dataset.id = id;
    box.innerHTML =
      `<span class="n-sex">${p ? (p.sexe || "?") : "?"}</span>` +
      `<span class="n-name">${escapeHtml(fullName(id))}</span>` +
      (p && lifespan(p) ? `<span class="n-dates">${lifespan(p)}</span>` : "");

    const sp = spousesOf(id);
    if (sp.length) {
      const s = document.createElement("span");
      s.className = "n-dates";
      s.textContent = "× " + sp.map(fullName).join(", ");
      box.appendChild(s);
    }

    const act = () => { setFocus(id); openPanel(id); };
    box.addEventListener("click", act);
    box.addEventListener("keydown", (e) => { if (e.key === "Enter") act(); });
    li.appendChild(box);
    nodeById.set(id, box);

    const kids = childrenOf(id);
    if (kids.length) {
      const ul = document.createElement("ul");
      kids.forEach((k) => ul.appendChild(nodeEl(k)));
      li.appendChild(ul);
    }
    return li;
  }

  function render() {
    nodeById.clear();
    scroll.querySelectorAll(".tree, #status").forEach((n) => n.remove());
    const ul = document.createElement("ul");
    ul.className = "tree";
    ul.appendChild(nodeEl(rootId));
    scroll.appendChild(ul);
    if (!nodeById.has(focusId)) focusId = rootId;
    applyFocus();
  }

  function applyFocus() {
    const kin = kinOf(focusId);
    nodeById.forEach((el, id) => {
      el.classList.toggle("is-focus", id === focusId);
      el.classList.toggle("is-kin", id !== focusId && kin.has(id));
    });
    countEl.textContent = `${nodeById.size} personnes · centre : ${fullName(focusId)}`;
    rootSel.value = focusId;
    const u = new URLSearchParams();
    u.set("p", rootId);
    u.set("f", focusId);
    history.replaceState(null, "", "?" + u.toString());
    scrollFocusIntoView();
  }

  function scrollFocusIntoView(smooth = true) {
    const el = nodeById.get(focusId);
    if (!el) return;
    const er = el.getBoundingClientRect();
    const sr = scroll.getBoundingClientRect();
    scroll.scrollTo({
      left: scroll.scrollLeft + (er.left - sr.left) - scroll.clientWidth / 2 + er.width / 2,
      top: scroll.scrollTop + (er.top - sr.top) - scroll.clientHeight / 2 + er.height / 2,
      behavior: smooth ? "smooth" : "auto",
    });
  }

  // change le centre ; reconstruit l'arbre seulement si la personne
  // n'est pas déjà affichée
  function setFocus(id) {
    if (!I(id)) return;
    focusId = id;
    if (nodeById.has(id)) applyFocus();
    else { rootId = topmostAncestor(id); render(); }
  }

  /* ---------- fiche individu ---------- */
  function openPanel(id) {
    const p = I(id);
    if (!p) return;
    const parents = (parentFamilyOf(id)?.conjoints || []);
    const kids = childrenOf(id);
    const rows = [];
    const add = (k, v) => { if (v) rows.push(`<dt>${k}</dt><dd>${v}</dd>`); };
    add("Sexe", p.sexe === "M" ? "Homme" : p.sexe === "F" ? "Femme" : p.sexe);
    add("Naissance", fmtEvent(p.naissance));
    add("Décès", fmtEvent(p.deces));
    add("Profession", p.profession);
    add("Parents", parents.map(link).join(" &amp; "));

    familiesOf(id).forEach((f) => {
      const others = (f.conjoints || []).filter((c) => c !== id).map(link).join(", ");
      const info = [];
      if (f.mariage && f.mariage.date) info.push("mariage " + f.mariage.date);
      if (f.fin && f.fin.type === "divorce") info.push("divorce" + (f.fin.date ? " " + f.fin.date : ""));
      else if (f.fin && f.fin.date) info.push("séparés " + f.fin.date);
      const fk = (f.enfants || []).map(link).join(", ");
      rows.push(`<dt>Union</dt><dd>` +
        (others || '<span class="muted">conjoint·e non renseigné·e</span>') +
        (info.length ? ` <span class="muted">(${info.join(", ")})</span>` : "") +
        (fk ? `<br><span class="muted small">enfants : ${fk}</span>` : "") +
        `</dd>`);
    });
    add("Note", p.note ? escapeHtml(p.note) : "");

    panelBody.innerHTML =
      `<span class="kicker">Fiche</span>` +
      `<h2>${escapeHtml(fullName(id))}</h2>` +
      (lifespan(p) ? `<p class="muted">${lifespan(p)}</p>` : "") +
      (p.photo ? `<img src="${escapeHtml(p.photo)}" alt="" style="border-radius:.75rem;margin:.5rem 0 1rem">` : "") +
      `<dl>${rows.join("")}</dl>` +
      `<div class="rel-btns">` +
        `<button class="btn secondary" data-focus="${id}">Mettre au centre</button>` +
        (parents[0] ? `<button class="btn secondary" data-focus="${parents[0]}">↑ Parents</button>` : "") +
        (kids[0] ? `<button class="btn secondary" data-focus="${kids[0]}">↓ Descendance</button>` : "") +
      `</div>`;

    panelBody.querySelectorAll("[data-focus]").forEach((b) =>
      b.addEventListener("click", () => { setFocus(b.dataset.focus); openPanel(b.dataset.focus); }));
    panelBody.querySelectorAll("[data-goto]").forEach((b) =>
      b.addEventListener("click", (e) => { e.preventDefault(); setFocus(b.dataset.goto); openPanel(b.dataset.goto); }));

    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
  }
  function closePanel() {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
  }
  document.getElementById("panelClose").addEventListener("click", closePanel);

  const link = (id) => `<a href="#" data-goto="${id}">${escapeHtml(fullName(id))}</a>`;
  function fmtEvent(ev) {
    if (!ev) return "";
    return [ev.date, ev.lieu].filter(Boolean).join(" — ");
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------- zoom ---------- */
  zoomInput.addEventListener("input", () => {
    scroll.style.setProperty("--zoom", zoomInput.value);
  });
  fitBtn.addEventListener("click", () => {
    scroll.style.setProperty("--zoom", 1);
    requestAnimationFrame(() => {
      const tree = scroll.querySelector(".tree");
      if (!tree) return;
      const r = tree.getBoundingClientRect();
      const z = Math.max(0.45, Math.min(1,
        (scroll.clientWidth - 24) / r.width,
        (scroll.clientHeight - 24) / r.height));
      zoomInput.value = z.toFixed(2);
      scroll.style.setProperty("--zoom", z);
      requestAnimationFrame(() => scrollFocusIntoView(false));
    });
  });

  /* ---------- init ---------- */
  YeniCrypto.loadEncrypted("assets/data/arbre.json.enc")
    .then((json) => {
      data = json;
      data.individus = data.individus || {};
      data.familles = data.familles || {};

      const ids = Object.keys(data.individus).sort((a, b) =>
        fullName(a).localeCompare(fullName(b), "fr"));
      rootSel.innerHTML = ids
        .map((id) => `<option value="${id}">${escapeHtml(fullName(id))}${lifespanOpt(id)}</option>`)
        .join("");
      peopleList.innerHTML = ids.map((id) => `<option value="${escapeHtml(fullName(id))}">`).join("");

      rootSel.addEventListener("change", () => goTo(rootSel.value));
      search.addEventListener("change", () => {
        const q = search.value.trim().toLowerCase();
        const hit = ids.find((id) => fullName(id).toLowerCase() === q);
        if (hit) { goTo(hit); openPanel(hit); }
      });

      const q = new URLSearchParams(location.search);
      focusId = (q.get("f") && data.individus[q.get("f")]) ? q.get("f")
        : (data.meta && data.meta.focus && data.individus[data.meta.focus]) ? data.meta.focus
        : (data.meta && data.meta.racine && data.individus[data.meta.racine]) ? data.meta.racine
        : ids[0];
      rootId = (q.get("p") && data.individus[q.get("p")]) ? q.get("p") : topmostAncestor(focusId);
      render();
      requestAnimationFrame(() => scrollFocusIntoView(false));
    })
    .catch((err) => {
      if (status) status.textContent = "Impossible de charger l'arbre : " + err.message;
    });

  function goTo(id) {
    if (nodeById.has(id)) setFocus(id);
    else { rootId = topmostAncestor(id); focusId = id; render(); }
  }
  function lifespanOpt(id) {
    const p = I(id);
    return lifespan(p) ? ` (${lifespan(p)})` : "";
  }
})();
