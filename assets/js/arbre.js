/* ============================================================
   yéni.ch — arbre généalogique (vue descendante)
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
  const panel = document.getElementById("panel");
  const panelBody = document.getElementById("panelBody");

  let data = null;          // { individus:{}, familles:{}, meta:{} }
  let currentRoot = null;

  /* ---------- helpers ---------- */
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

  // familles où `id` est conjoint·e
  const familiesOf = (id) =>
    Object.entries(data.familles)
      .filter(([, f]) => (f.conjoints || []).includes(id))
      .map(([fid, f]) => ({ fid, ...f }));

  // famille où `id` est enfant -> ses parents
  const parentFamilyOf = (id) => {
    const hit = Object.values(data.familles).find((f) => (f.enfants || []).includes(id));
    return hit || null;
  };
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

  /* ---------- rendu de l'arbre ---------- */
  function nodeEl(id, isRoot) {
    const p = I(id);
    const li = document.createElement("li");

    const box = document.createElement("div");
    box.className = "node" + (isRoot ? " is-root" : "") + (p && p.sexe === "F" ? " sex-F" : "");
    box.tabIndex = 0;
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

    box.addEventListener("click", () => openPanel(id));
    box.addEventListener("keydown", (e) => { if (e.key === "Enter") openPanel(id); });
    li.appendChild(box);

    const kids = childrenOf(id);
    if (kids.length) {
      const ul = document.createElement("ul");
      kids.forEach((k) => ul.appendChild(nodeEl(k, false)));
      li.appendChild(ul);
    }
    return li;
  }

  function render(rootId) {
    currentRoot = rootId;
    rootSel.value = rootId;
    scroll.querySelectorAll(".tree, #status").forEach((n) => n.remove());
    const ul = document.createElement("ul");
    ul.className = "tree";
    ul.appendChild(nodeEl(rootId, true));
    scroll.appendChild(ul);
    const total = countDescendants(rootId);
    countEl.textContent = `${total} personne${total > 1 ? "s" : ""} sous cette racine`;
    history.replaceState(null, "", "?p=" + encodeURIComponent(rootId));
  }

  function countDescendants(id, seen = new Set()) {
    if (seen.has(id)) return 0;
    seen.add(id);
    let n = 1;
    childrenOf(id).forEach((k) => { n += countDescendants(k, seen); });
    return n;
  }

  /* ---------- fiche individu ---------- */
  function openPanel(id) {
    const p = I(id);
    if (!p) return;
    const parents = (parentFamilyOf(id)?.conjoints || []);
    const rows = [];
    const add = (k, v) => { if (v) rows.push(`<dt>${k}</dt><dd>${v}</dd>`); };
    add("Sexe", p.sexe === "M" ? "Homme" : p.sexe === "F" ? "Femme" : p.sexe);
    add("Naissance", fmtEvent(p.naissance));
    add("Décès", fmtEvent(p.deces));
    add("Profession", p.profession);
    add("Parents", parents.map((x) => link(x)).join(" &amp; "));

    // une ligne par union : conjoint·e + statut (mariage / divorce) + enfants
    familiesOf(id).forEach((f) => {
      const others = (f.conjoints || []).filter((c) => c !== id).map(link).join(", ");
      const info = [];
      if (f.mariage && f.mariage.date) info.push("mariage " + f.mariage.date);
      if (f.fin && f.fin.type === "divorce") info.push("divorce" + (f.fin.date ? " " + f.fin.date : ""));
      else if (f.fin && f.fin.date) info.push("séparés " + f.fin.date);
      const kids = (f.enfants || []).map(link).join(", ");
      const val =
        (others || '<span class="muted">conjoint·e non renseigné·e</span>') +
        (info.length ? ` <span class="muted">(${info.join(", ")})</span>` : "") +
        (kids ? `<br><span class="muted small">enfants : ${kids}</span>` : "");
      rows.push(`<dt>Union</dt><dd>${val}</dd>`);
    });

    add("Note", p.note ? escapeHtml(p.note) : "");

    panelBody.innerHTML =
      `<span class="kicker">Fiche</span>` +
      `<h2>${escapeHtml(fullName(id))}</h2>` +
      (lifespan(p) ? `<p class="muted">${lifespan(p)}</p>` : "") +
      (p.photo ? `<img src="${escapeHtml(p.photo)}" alt="" style="border-radius:.75rem;margin:.5rem 0 1rem">` : "") +
      `<dl>${rows.join("")}</dl>` +
      `<div class="rel-btns">
         <button class="btn secondary" data-root="${id}">Centrer l'arbre ici</button>
         ${parents[0] ? `<button class="btn secondary" data-root="${parents[0]}">Remonter aux parents</button>` : ""}
       </div>`;

    panelBody.querySelectorAll("[data-root]").forEach((b) =>
      b.addEventListener("click", () => { render(b.dataset.root); closePanel(); }));
    panelBody.querySelectorAll("[data-goto]").forEach((b) =>
      b.addEventListener("click", (e) => { e.preventDefault(); openPanel(b.dataset.goto); }));

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

      rootSel.addEventListener("change", () => render(rootSel.value));
      search.addEventListener("change", () => {
        const hit = ids.find((id) => fullName(id).toLowerCase() === search.value.trim().toLowerCase());
        if (hit) { render(hit); openPanel(hit); }
      });

      // racine : ?p= dans l'URL, sinon meta.racine, sinon le plus ancien
      const wanted = new URLSearchParams(location.search).get("p");
      const start = (wanted && data.individus[wanted]) ? wanted
        : (data.meta && data.meta.racine && data.individus[data.meta.racine]) ? data.meta.racine
        : oldest(ids);
      render(start);
    })
    .catch((err) => {
      status.textContent = "Impossible de charger l'arbre : " + err.message;
    });

  function lifespanOpt(id) {
    const p = I(id);
    return lifespan(p) ? ` (${lifespan(p)})` : "";
  }
  function oldest(ids) {
    return ids.slice().sort((a, b) => {
      const ya = year(I(a).naissance) || "9999";
      const yb = year(I(b).naissance) || "9999";
      return ya.localeCompare(yb);
    })[0];
  }
})();
