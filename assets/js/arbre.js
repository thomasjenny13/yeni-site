/* ============================================================
   yéni.ch — arbre généalogique
   Canevas pan/zoom fluide (comme une carte). La personne au
   centre et sa famille proche sont en pleine opacité, le reste
   en transparence. Conjoint·es = deux bulles reliées. Fiche en
   petite carte en bas de l'écran ; un clic ailleurs la ferme.
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
  const wideBtn = document.getElementById("wideBtn");
  const card = document.getElementById("card");
  const cardBody = document.getElementById("cardBody");

  let data = null;
  let rootId = null;
  let focusId = null;
  let wide = false;
  const nodeById = new Map();

  // transform du canevas
  let tx = 0, ty = 0, ts = 1;
  const MIN_S = 0.12, MAX_S = 2.6, FIT_MAX = 1.35;

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
    const s = [];
    familiesOf(id).forEach((f) => (f.conjoints || []).forEach((c) => {
      if (c !== id && !s.includes(c)) s.push(c);
    }));
    return s;
  };
  const childrenOf = (id) => {
    const c = [];
    familiesOf(id).forEach((f) => (f.enfants || []).forEach((k) => { if (!c.includes(k)) c.push(k); }));
    return c;
  };
  function topmostAncestor(id) {
    let cur = id;
    for (let i = 0; i < 40; i++) {
      const pf = parentFamilyOf(cur);
      if (!pf || !(pf.conjoints || []).length) return cur;
      const blood = (pf.conjoints || []).find((c) => parentFamilyOf(c));
      cur = blood || pf.conjoints[0];
    }
    return cur;
  }

  /* ---------- famille proche du focus (mise en évidence) ---------- */
  function kinOf(fid) {
    const k = new Set([fid]);
    (function up(id) {
      const pf = parentFamilyOf(id);
      if (!pf) return;
      (pf.conjoints || []).forEach((p) => { if (!k.has(p)) { k.add(p); up(p); } });
    })(fid);
    const pf = parentFamilyOf(fid);
    (pf?.enfants || []).forEach((s) => k.add(s));
    spousesOf(fid).forEach((s) => k.add(s));
    childrenOf(fid).forEach((c) => {
      k.add(c);
      spousesOf(c).forEach((s) => k.add(s));
      childrenOf(c).forEach((g) => k.add(g));
    });
    return k;
  }
  // voisinage serré pour le cadrage (zoom plus proche)
  function fitTargets() {
    if (wide) return [...nodeById.keys()];
    // cellule immédiate : la personne, son/sa/ses conjoint·es, ses enfants.
    // Les parents ne sont pas dans le cadrage (souvent décalés loin sur le
    // côté), mais le trait qui monte reste visible ; bouton « ↑ Parents ».
    const t = new Set([focusId]);
    spousesOf(focusId).forEach((x) => t.add(x));
    childrenOf(focusId).forEach((x) => t.add(x));
    return [...t];
  }

  /* ---------- rendu ---------- */
  function nodeDiv(id) {
    const p = I(id);
    const box = document.createElement("div");
    box.className = "node";
    box.tabIndex = 0;
    box.dataset.id = id;
    if (p && (p.sexe === "M" || p.sexe === "F")) box.dataset.sex = p.sexe;
    box.innerHTML =
      `<span class="n-name">${escapeHtml(fullName(id))}</span>` +
      (p && lifespan(p) ? `<span class="n-dates">${lifespan(p)}</span>` : "");
    const act = (e) => { if (e) e.stopPropagation(); setFocus(id); openCard(id); };
    box.addEventListener("click", act);
    box.addEventListener("keydown", (e) => { if (e.key === "Enter") act(e); });
    nodeById.set(id, box);
    return box;
  }

  function personLi(id) {
    const li = document.createElement("li");
    const couple = document.createElement("div");
    couple.className = "couple";
    couple.appendChild(nodeDiv(id));
    spousesOf(id).forEach((sid) => {
      const bar = document.createElement("span");
      bar.className = "mlink";
      couple.appendChild(bar);
      couple.appendChild(nodeDiv(sid));
    });
    li.appendChild(couple);

    const kids = childrenOf(id);
    if (kids.length) {
      const ul = document.createElement("ul");
      kids.forEach((k) => ul.appendChild(personLi(k)));
      li.appendChild(ul);
    }
    return li;
  }

  function render() {
    nodeById.clear();
    scroll.querySelectorAll(".tree, #status").forEach((n) => n.remove());
    tx = 0; ty = 0; ts = 1;
    const ul = document.createElement("ul");
    ul.className = "tree no-anim";
    ul.style.transform = "translate(0px,0px) scale(1)";
    ul.appendChild(personLi(rootId));
    scroll.appendChild(ul);
    if (!nodeById.has(focusId)) focusId = rootId;
    drawLines();
    applyFocus(false);
  }

  /* ---------- connecteurs (SVG) ---------- */
  const SVGNS = "http://www.w3.org/2000/svg";
  function drawLines() {
    const tree = scroll.querySelector(".tree");
    if (!tree) return;
    let svg = tree.querySelector("svg.tree-lines");
    if (!svg) {
      svg = document.createElementNS(SVGNS, "svg");
      svg.setAttribute("class", "tree-lines");
      tree.prepend(svg);
    }
    const tr = tree.getBoundingClientRect();
    const P = (el) => {
      const r = el.getBoundingClientRect();
      return {
        cx: (r.left + r.width / 2 - tr.left) / ts,
        top: (r.top - tr.top) / ts,
        bot: (r.bottom - tr.top) / ts,
      };
    };
    const d = [];
    tree.querySelectorAll("li").forEach((li) => {
      const couple = li.querySelector(":scope > .couple");
      const childUl = li.querySelector(":scope > ul");
      if (!couple || !childUl) return;
      const cc = P(couple);
      const bot = Math.max(...[...couple.querySelectorAll(":scope > .node")].map((n) => P(n).bot));
      const kids = [...childUl.children].map((k) => P(k.querySelector(":scope > .couple > .node")));
      if (!kids.length) return;
      const busY = bot + Math.max(14, (kids[0].top - bot) / 2);
      d.push(`M ${cc.cx} ${bot} L ${cc.cx} ${busY}`);
      if (kids.length === 1) {
        d.push(`M ${kids[0].cx} ${busY} L ${kids[0].cx} ${kids[0].top}`);
      } else {
        const xs = kids.map((k) => k.cx);
        d.push(`M ${Math.min(...xs)} ${busY} L ${Math.max(...xs)} ${busY}`);
        kids.forEach((k) => d.push(`M ${k.cx} ${busY} L ${k.cx} ${k.top}`));
      }
    });
    svg.setAttribute("width", tr.width / ts);
    svg.setAttribute("height", tr.height / ts);
    svg.setAttribute("viewBox", `0 0 ${tr.width / ts} ${tr.height / ts}`);
    svg.innerHTML = `<path d="${d.join(" ")}" fill="none" stroke="var(--accent-deep)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  function applyFocus(smooth = true) {
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
    requestAnimationFrame(() => fitView(smooth));
  }

  /* ---------- transform ---------- */
  function applyTransform(smooth) {
    const tree = scroll.querySelector(".tree");
    if (!tree) return;
    tree.classList.toggle("no-anim", !smooth);
    tree.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${ts.toFixed(4)})`;
  }
  function localRect(els) {
    const tree = scroll.querySelector(".tree");
    const tr = tree.getBoundingClientRect();
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    els.forEach((el) => {
      const r = el.getBoundingClientRect();
      a = Math.min(a, (r.left - tr.left) / ts);
      b = Math.min(b, (r.top - tr.top) / ts);
      c = Math.max(c, (r.right - tr.left) / ts);
      d = Math.max(d, (r.bottom - tr.top) / ts);
    });
    return { x: a, y: b, w: c - a, h: d - b };
  }
  function fitView(smooth = true) {
    const tree = scroll.querySelector(".tree");
    if (!tree || !nodeById.get(focusId)) return;
    const els = fitTargets().map((id) => nodeById.get(id)).filter(Boolean);
    if (!els.length) return;
    const box = localRect(els);
    const vw = scroll.clientWidth, vh = scroll.clientHeight;
    const pad = 52;
    let s = Math.min(
      (vw - pad) / Math.max(1, box.w),
      (vh - pad) / Math.max(1, box.h),
      FIT_MAX);
    s = Math.max(MIN_S, s);
    // le zoom cadre le voisinage. Horizontalement : calé sur la personne
    // sélectionnée (toujours au milieu). Verticalement : on vise un point
    // entre la personne et le haut de la boîte, pour garder les parents
    // visibles au-dessus et les enfants en dessous.
    let cx = box.x + box.w / 2;
    let cy = box.y + box.h / 2;
    if (!wide) {
      const f = localRect([nodeById.get(focusId)]);
      cx = f.x + f.w / 2;                       // calé horizontalement sur la personne
      cy -= 24;                                 // légèrement remonté (montre le trait parents)
    }
    tx = vw / 2 - cx * s;
    ty = vh / 2 - cy * s;
    ts = s;
    applyTransform(smooth);
  }

  function setFocus(id) {
    if (!I(id)) return;
    focusId = id;
    if (nodeById.has(id)) applyFocus(true);
    else { rootId = topmostAncestor(id); render(); }
  }

  wideBtn.addEventListener("click", () => {
    wide = !wide;
    wideBtn.setAttribute("aria-pressed", String(wide));
    wideBtn.textContent = wide ? "Suivre la sélection" : "Voir large";
    fitView(true);
  });

  /* ---------- pan / zoom façon carte ---------- */
  scroll.addEventListener("wheel", (e) => {
    if (!scroll.querySelector(".tree")) return;
    e.preventDefault();
    const rect = scroll.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const ns = Math.max(MIN_S, Math.min(MAX_S, ts * Math.exp(-e.deltaY * 0.0016)));
    const k = ns / ts;
    tx = mx - (mx - tx) * k;
    ty = my - (my - ty) * k;
    ts = ns;
    applyTransform(false);
  }, { passive: false });

  let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0, pid = null;
  scroll.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !scroll.querySelector(".tree")) return;
    dragging = true; moved = false;
    sx = e.clientX; sy = e.clientY; ox = tx; oy = ty; pid = e.pointerId;
  });
  scroll.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && Math.abs(dx) + Math.abs(dy) > 4) {
      moved = true;
      try { scroll.setPointerCapture(pid); } catch (_) {}
      scroll.classList.add("grabbing");
    }
    if (moved) { tx = ox + dx; ty = oy + dy; applyTransform(false); }
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    scroll.classList.remove("grabbing");
    if (!moved) {
      const onNode = e.target.closest && e.target.closest(".node");
      const onCard = e.target.closest && e.target.closest(".person-card");
      if (!onNode && !onCard) closeCard();
    }
  }
  scroll.addEventListener("pointerup", endDrag);
  scroll.addEventListener("pointercancel", () => { dragging = false; scroll.classList.remove("grabbing"); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCard(); });

  /* ---------- fiche : petite carte ---------- */
  function openCard(id) {
    const p = I(id);
    if (!p) return;
    const parents = (parentFamilyOf(id)?.conjoints || []);
    const facts = [];
    if (p.profession) facts.push(`<div><b>Profession</b> · ${escapeHtml(p.profession)}</div>`);
    if (parents.length) facts.push(`<div><b>Parents</b> · ${parents.map(link).join(" &amp; ")}</div>`);
    familiesOf(id).forEach((f) => {
      const others = (f.conjoints || []).filter((c) => c !== id).map(link).join(", ");
      const info = [];
      if (f.mariage && f.mariage.date) info.push("mariage " + f.mariage.date);
      if (f.fin && f.fin.type === "divorce") info.push("divorce" + (f.fin.date ? " " + f.fin.date : ""));
      else if (f.fin && f.fin.date) info.push("séparés " + f.fin.date);
      const fk = (f.enfants || []).map(link).join(", ");
      facts.push(`<div><b>${others ? "Conjoint·e" : "Union"}</b> · ` +
        (others || "—") + (info.length ? ` <span class="muted">(${info.join(", ")})</span>` : "") +
        (fk ? `<br><b>Enfants</b> · ${fk}` : "") + `</div>`);
    });

    const sub = [lifespan(p), fmtEvent(p.naissance) && ("né·e " + fmtEvent(p.naissance))].filter(Boolean).join(" · ");
    const kids = childrenOf(id);

    cardBody.innerHTML =
      `<h2>${escapeHtml(fullName(id))}</h2>` +
      (sub ? `<div class="card-sub">${escapeHtml(sub)}</div>` : "") +
      (facts.length ? `<div class="card-facts">${facts.join("")}</div>` : "") +
      (p.note ? `<div class="card-note">${escapeHtml(p.note)}</div>` : "") +
      `<div class="rel-btns">` +
        (parents[0] ? `<button class="btn secondary" data-focus="${parents[0]}">↑ Parents</button>` : "") +
        (kids[0] ? `<button class="btn secondary" data-focus="${kids[0]}">↓ Descendance</button>` : "") +
      `</div>`;

    cardBody.querySelectorAll("[data-focus]").forEach((b) =>
      b.addEventListener("click", (e) => { e.stopPropagation(); setFocus(b.dataset.focus); openCard(b.dataset.focus); }));
    cardBody.querySelectorAll("[data-goto]").forEach((b) =>
      b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); setFocus(b.dataset.goto); openCard(b.dataset.goto); }));

    card.hidden = false;
  }
  function closeCard() { card.hidden = true; }
  document.getElementById("cardClose").addEventListener("click", (e) => { e.stopPropagation(); closeCard(); });
  card.addEventListener("pointerdown", (e) => e.stopPropagation());

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

      rootSel.addEventListener("change", () => goTo(rootSel.value));
      search.addEventListener("change", () => {
        const q = search.value.trim().toLowerCase();
        const hit = ids.find((id) => fullName(id).toLowerCase() === q);
        if (hit) { goTo(hit); openCard(hit); }
      });
      window.addEventListener("resize", () => {
        clearTimeout(window.__rz);
        window.__rz = setTimeout(() => { drawLines(); fitView(false); }, 200);
      });

      const q = new URLSearchParams(location.search);
      focusId = (q.get("f") && data.individus[q.get("f")]) ? q.get("f")
        : (data.meta && data.meta.focus && data.individus[data.meta.focus]) ? data.meta.focus
        : (data.meta && data.meta.racine && data.individus[data.meta.racine]) ? data.meta.racine
        : ids[0];
      rootId = (q.get("p") && data.individus[q.get("p")]) ? q.get("p") : topmostAncestor(focusId);
      render();
      if (document.fonts && document.fonts.ready)
        document.fonts.ready.then(() => { drawLines(); fitView(false); });
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
