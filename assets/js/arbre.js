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

  const scroll = document.getElementById("treeScroll");
  const status = document.getElementById("status");
  const rootSel = document.getElementById("rootSel");
  const search = document.getElementById("search");
  const peopleList = document.getElementById("peopleList");
  const card = document.getElementById("card");
  const cardBody = document.getElementById("cardBody");

  let data = null;
  let rootId = null;
  let focusId = null;
  const nodeById = new Map();

  // transform du canevas
  let tx = 0, ty = 0, ts = 1;
  const MIN_S = 0.12, MAX_S = 5, FIT_MAX = 1.35;

  /* ---------- helpers données ---------- */
  const I = (id) => data.individus[id];
  const fullName = (id) => {
    const p = I(id);
    if (!p) return "?";
    return [p.prenom, p.nom].filter(Boolean).join(" ") || "(sans nom)";
  };
  // dans l'arbre : un seul prénom (le premier) ; les autres restent dans la fiche
  const shortName = (id) => {
    const p = I(id);
    if (!p) return "?";
    const first = (p.prenom || "").trim().split(/\s+/)[0];
    return [first, p.nom].filter(Boolean).join(" ") || "(sans nom)";
  };
  const year = (d) => (d && d.date ? String(d.date).slice(0, 4) : "");
  const lifespan = (p) => {
    const n = year(p.naissance), m = year(p.deces);
    if (p.deces) return (n || m) ? `${n || "?"}–${m || "?"}` : "";
    return n || "";                    // vivant·e → juste l'année de naissance
  };
  const familiesOf = (id) =>
    Object.entries(data.familles)
      .filter(([, f]) => (f.conjoints || []).includes(id))
      .map(([fid, f]) => ({ fid, ...f }));
  const parentFamilyOf = (id) =>
    Object.values(data.familles).find((f) => (f.enfants || []).includes(id)) || null;
  const parentFamilyEntryOf = (id) => {
    const e = Object.entries(data.familles).find(([, f]) => (f.enfants || []).includes(id));
    return e ? { fid: e[0], ...e[1] } : null;
  };
  // chemin ascendant de `id` jusqu'à la racine : quelles unions et quels
  // « rattachements enfant » sont sur la lignée d'où vient la personne
  function ancestryHot(id) {
    const drops = new Set();   // `${fid}>${enfantId}`
    const unions = new Set();  // fid des unions traversées
    let cur = id;
    for (let i = 0; i < 60; i++) {
      const pf = parentFamilyEntryOf(cur);
      if (!pf) break;
      drops.add(pf.fid + ">" + cur);
      unions.add(pf.fid);
      const blood = (pf.conjoints || []).find((c) => parentFamilyOf(c)) || (pf.conjoints || [])[0];
      if (!blood || blood === cur) break;
      cur = blood;
    }
    return { drops, unions };
  }
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
  // on garde toujours tout l'arbre dans le cadre ; la sélection est juste
  // mise en évidence (opacité + lignée en gueules), sans recadrage serré
  function fitTargets() {
    return [...nodeById.keys()];
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
      `<span class="n-name">${escapeHtml(shortName(id))}</span>` +
      (p && lifespan(p) ? `<span class="n-dates">${lifespan(p)}</span>` : "");
    const act = (e) => {
      if (e) e.stopPropagation();
      setFocus(id);                      // met en évidence et, au besoin, redéploie l'arbre
      openCard(id);
    };
    box.addEventListener("click", act);
    box.addEventListener("keydown", (e) => { if (e.key === "Enter") act(e); });
    nodeById.set(id, box);
    return box;
  }

  // libellé du lien entre deux conjoint·es selon le statut de l'union
  function unionState(f) {
    if (f.fin && f.fin.type === "divorce") return "divorce";
    if (f.fin) return "separe";
    if (f.statut === "actuelle") return "actuelle";
    return "";
  }

  function personLi(id) {
    const li = document.createElement("li");
    li.dataset.person = id;
    const couple = document.createElement("div");
    couple.className = "couple";
    const prim = nodeDiv(id);
    prim.classList.add("is-primary");

    const fams = familiesOf(id);
    const seen = new Set([id]);
    const spouseNodes = [];
    fams.forEach((f) => {
      (f.conjoints || []).forEach((c) => {
        if (seen.has(c)) return;
        seen.add(c);
        const sn = nodeDiv(c);
        sn.dataset.union = f.fid;
        spouseNodes.push(sn);
      });
    });
    // 0-1 conjoint·e : « personne — conjoint·e ». Plusieurs : on encadre
    // la personne (conjoint·e — PERSONNE — conjoint·e) pour que chaque
    // trait relie des bulles adjacentes.
    if (spouseNodes.length <= 1) {
      couple.appendChild(prim);
      spouseNodes.forEach((sn) => couple.appendChild(sn));
    } else {
      const half = Math.floor(spouseNodes.length / 2);
      spouseNodes.slice(0, half).forEach((sn) => couple.appendChild(sn));
      couple.appendChild(prim);
      spouseNodes.slice(half).forEach((sn) => couple.appendChild(sn));
    }
    li.appendChild(couple);

    // enfants regroupés par union, dans un seul <ul> (ordre des unions)
    if (fams.some((f) => (f.enfants || []).length)) {
      const ul = document.createElement("ul");
      fams.forEach((f) => {
        (f.enfants || []).forEach((kid) => {
          const kl = personLi(kid);
          kl.dataset.union = f.fid;
          ul.appendChild(kl);
        });
      });
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
    applyFocus(false);
  }

  /* ---------- connecteurs (SVG, coudes arrondis) ---------- */
  const SVGNS = "http://www.w3.org/2000/svg";
  const R = 10; // rayon des coudes

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
        midY: (r.top + r.height / 2 - tr.top) / ts,
        left: (r.left - tr.left) / ts,
        right: (r.right - tr.left) / ts,
        top: (r.top - tr.top) / ts,
        bot: (r.bottom - tr.top) / ts,
      };
    };

    const links = [];   // { d, cls } — traits entre conjoint·es
    const descent = []; // descentes vers les enfants
    const linksHot = [];   // idem, sur la lignée ascendante du focus → gueules
    const descentHot = [];

    const hot = ancestryHot(focusId);

    const primNodeOf = (li) =>
      li.querySelector(":scope > .couple > .node.is-primary") ||
      li.querySelector(":scope > .couple > .node");

    tree.querySelectorAll("li").forEach((li) => {
      const personId = li.dataset.person;
      const couple = li.querySelector(":scope > .couple");
      if (!couple) return;
      const nodeEls = [...couple.querySelectorAll(":scope > .node")];
      const primEl = primNodeOf(li);
      const prim = P(primEl);

      // traits vers chaque conjoint·e (chacun·e est adjacent·e à la personne)
      nodeEls.forEach((n) => {
        if (n === primEl) return;
        const a = P(primEl), b = P(n);
        const [lft, rgt] = a.cx < b.cx ? [a, b] : [b, a];
        const y = (a.midY + b.midY) / 2;
        const fid = n.dataset.union;
        const f = fid ? data.familles[fid] : null;
        (hot.unions.has(fid) ? linksHot : links)
          .push({ d: `M ${lft.right} ${y} L ${rgt.left} ${y}`, cls: f ? unionState(f) : "" });
      });

      // descente vers les enfants, groupée par union
      const childUl = li.querySelector(":scope > ul");
      if (!childUl) return;
      const bot = Math.max(...nodeEls.map((n) => P(n).bot));
      const byUnion = new Map();
      [...childUl.children].forEach((kl) => {
        const arr = byUnion.get(kl.dataset.union) || [];
        arr.push({ p: P(primNodeOf(kl)), id: kl.dataset.person });
        byUnion.set(kl.dataset.union, arr);
      });

      byUnion.forEach((kids, fid) => {
        const fam = data.familles[fid];
        const spId = (fam?.conjoints || []).find((c) => c !== personId);
        const spEl = spId ? nodeEls.find((n) => n.dataset.id === spId) : null;
        // la descente part du trait entre les conjoint·es (ou du bas de la
        // personne si elle est seule) → elle touche la ligne des parents
        const startX = spEl ? (prim.cx + P(spEl).cx) / 2 : prim.cx;
        const startY = spEl ? (prim.midY + P(spEl).midY) / 2 : prim.bot;
        const busY = bot + Math.max(16, (kids[0].p.top - bot) / 2);
        kids.forEach(({ p: k, id: kid }) => {
          const out = hot.drops.has(fid + ">" + kid) ? descentHot : descent;
          // décalage faible → on descend droit (trait vertical net) plutôt qu'un coude
          if (Math.abs(k.cx - startX) <= 26) {
            out.push(`M ${k.cx} ${startY} L ${k.cx} ${k.top}`);
            return;
          }
          const s = Math.sign(k.cx - startX);
          const r = Math.min(R, Math.abs(k.cx - startX) / 2, (busY - startY) / 2, (k.top - busY) / 2);
          out.push(
            `M ${startX} ${startY}` +
            ` L ${startX} ${busY - r}` +
            ` Q ${startX} ${busY} ${startX + s * r} ${busY}` +
            ` L ${k.cx - s * r} ${busY}` +
            ` Q ${k.cx} ${busY} ${k.cx} ${busY + r}` +
            ` L ${k.cx} ${k.top}`);
        });
      });
    });

    // « l'arbre continue » : amorce pointillée vers le haut au-dessus d'une
    // personne dont les parents ne sont pas visibles ici — qu'ils soient
    // absents des données ou simplement hors de cette vue (autre branche).
    // Limitée à la personne au centre et à sa parenté proche pour ne pas
    // surcharger.
    const openUp = [];
    tree.querySelectorAll(".couple > .node").forEach((n) => {
      const id = n.dataset.id;
      if (!n.classList.contains("is-focus") && !n.classList.contains("is-kin")) return;
      const pf = parentFamilyEntryOf(id);
      if (pf && (pf.conjoints || []).some((c) => nodeById.has(c))) return;  // parents affichés
      const ind = I(id);
      if (!pf && ind && ind.ascendance === "fin") return;   // fin de lignée connue
      const b = P(n);
      const x = Math.round(b.cx);
      openUp.push(
        `M ${x} ${b.top - 3} L ${x} ${b.top - 22}` +
        ` M ${x - 5} ${b.top - 15} L ${x} ${b.top - 22} L ${x + 5} ${b.top - 15}`);
    });

    svg.setAttribute("width", tr.width / ts);
    svg.setAttribute("height", tr.height / ts);
    svg.setAttribute("viewBox", `0 0 ${tr.width / ts} ${tr.height / ts}`);
    svg.innerHTML =
      `<path class="ln-descent" d="${descent.join(" ")}" fill="none"/>` +
      links.map((l) => `<path class="ln-link ${l.cls}" d="${l.d}" fill="none"/>`).join("") +
      `<path class="ln-descent ln-hot" d="${descentHot.join(" ")}" fill="none"/>` +
      linksHot.map((l) => `<path class="ln-link ln-hot ${l.cls}" d="${l.d}" fill="none"/>`).join("") +
      (openUp.length ? `<path class="ln-open" d="${openUp.join(" ")}" fill="none"/>` : "");
  }

  function applyFocus(smooth = true) {
    const kin = kinOf(focusId);
    nodeById.forEach((el, id) => {
      el.classList.toggle("is-focus", id === focusId);
      el.classList.toggle("is-kin", id !== focusId && kin.has(id));
    });
    rootSel.value = focusId;
    const u = new URLSearchParams();
    u.set("p", rootId);
    u.set("f", focusId);
    history.replaceState(null, "", "?" + u.toString());
    drawLines();
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
    // la fiche (en bas) ne contraint pas le zoom : on garde le calcul sur
    // toute la hauteur, on décale seulement le centrage vertical
    const cardH = (card && !card.hidden) ? Math.min(card.offsetHeight, vh * 0.5) : 0;
    let s = Math.min(
      (vw - pad) / Math.max(1, box.w),
      (vh - pad) / Math.max(1, box.h),
      FIT_MAX);
    s = Math.max(MIN_S, s);
    // tout l'arbre centré ; on décale seulement le centrage vertical pour la fiche
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    tx = vw / 2 - cx * s;
    ty = (vh - cardH) / 2 - cy * s;
    ts = s;
    applyTransform(smooth);
  }

  // recentre sur `id` ; si sa lignée ascendante n'est pas déjà déployée dans
  // la vue courante, on ré-enracine l'arbre sur son ancêtre le plus haut
  function setFocus(id) {
    if (!I(id)) return;
    const newRoot = topmostAncestor(id);
    focusId = id;
    if (newRoot === rootId && nodeById.has(id)) applyFocus(true);   // déjà là → glissement fluide
    else { rootId = newRoot; render(); }                            // sinon → on redéploie
  }

  /* ---------- pan / zoom façon carte (comme Aperçu) ---------- */
  // deux doigts sur le pad / molette → déplacement ; pincement (ou ⌘/Ctrl+molette) → zoom
  scroll.addEventListener("wheel", (e) => {
    if (!scroll.querySelector(".tree")) return;
    e.preventDefault();
    const scale = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? scroll.clientHeight : 1);
    if (e.ctrlKey || e.metaKey) {
      const ns = Math.max(MIN_S, Math.min(MAX_S, ts * Math.exp(-e.deltaY * scale * 0.012)));
      const k = ns / ts;
      const rect = scroll.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      tx = mx - (mx - tx) * k;
      ty = my - (my - ty) * k;
      ts = ns;
    } else {
      tx -= e.deltaX * scale;
      ty -= e.deltaY * scale;
    }
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
    if (p.naissance && p.naissance.lieu) facts.push(`<div><b>Naissance</b> · ${escapeHtml(p.naissance.lieu)}</div>`);
    if (p.deces && p.deces.lieu) facts.push(`<div><b>Décès</b> · ${escapeHtml(p.deces.lieu)}</div>`);
    if (p.profession) facts.push(`<div><b>Profession</b> · ${escapeHtml(p.profession)}</div>`);
    if (parents.length) facts.push(`<div><b>Parents</b> · ${parents.map(link).join(" &amp; ")}</div>`);
    else if (p.ascendance !== "fin") facts.push(`<div><b>Ascendance</b> · à compléter · ${suggestLink(id, "les parents")}</div>`);
    familiesOf(id).forEach((f) => {
      const others = (f.conjoints || []).filter((c) => c !== id).map(link).join(", ");
      const info = [];
      if (f.mariage && f.mariage.date) info.push("mariage " + f.mariage.date);
      if (f.fin && f.fin.type === "divorce") info.push("divorcé·e" + (f.fin.date ? " " + f.fin.date : ""));
      else if (f.fin) info.push("séparé·e" + (f.fin.date ? " " + f.fin.date : ""));
      else if (f.statut === "actuelle") info.push("compagne / compagnon actuel·le");
      const fk = (f.enfants || []).map(link).join(", ");
      facts.push(`<div><b>${others ? "Conjoint·e" : "Union"}</b> · ` +
        (others || "—") + (info.length ? ` <span class="muted">(${info.join(", ")})</span>` : "") +
        (fk ? `<br><b>Enfants</b> · ${fk}` : "") + `</div>`);
    });

    const kids = childrenOf(id);

    // ligne de dates : 20.05.1993 –  (vivant·e) | 20.05.1993 – 04.03.2025 | date + « suggérer »
    const suggest = suggestLink(id);
    const naiss = fmtDate(p.naissance && p.naissance.date);
    const dec = fmtDate(p.deces && p.deces.date);
    let dateLine;
    if (!naiss && !p.deces) dateLine = suggest;
    else dateLine = `${naiss || suggest} – ${p.deces ? (dec || suggest) : ""}`;

    cardBody.innerHTML =
      `<h2>${escapeHtml(fullName(id))}</h2>` +
      `<div class="card-sub">${dateLine}</div>` +
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

    const wasHidden = card.hidden;
    card.hidden = false;
    if (wasHidden) requestAnimationFrame(() => fitView(true)); // recadre au-dessus de la fiche
  }
  function closeCard() { card.hidden = true; requestAnimationFrame(() => fitView(true)); }
  document.getElementById("cardClose").addEventListener("click", (e) => { e.stopPropagation(); closeCard(); });
  card.addEventListener("pointerdown", (e) => e.stopPropagation());

  const link = (id) => `<a href="#" data-goto="${id}">${escapeHtml(fullName(id))}</a>`;
  function fmtEvent(ev) {
    if (!ev) return "";
    return [ev.date, ev.lieu].filter(Boolean).join(" — ");
  }
  function fmtDate(d) {
    if (!d) return "";
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
    return m ? `${m[3]}.${m[2]}.${m[1]}` : String(d);   // "1993", "2017", "vers 1880" tels quels
  }
  function suggestLink(id, what) {
    const nom = fullName(id);
    const subject = what ? `yéni.ch — ${what} de ${nom}` : "yéni.ch — précision sur " + nom;
    const body = (what
      ? `${what.charAt(0).toUpperCase()}${what.slice(1)} de ${nom}`
      : "Précision / correction pour " + nom) + " :\n\n";
    return `<a class="card-suggest" href="mailto:info@xn--yni-bma.ch?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}">suggérer</a>`;
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
      const wantF = (q.get("f") && data.individus[q.get("f")]) ? q.get("f") : null;
      focusId = wantF
        || (data.meta && data.meta.focus && data.individus[data.meta.focus] ? data.meta.focus : null)
        || (data.meta && data.meta.racine && data.individus[data.meta.racine] ? data.meta.racine : null)
        || ids[0];
      rootId = (q.get("p") && data.individus[q.get("p")]) ? q.get("p") : topmostAncestor(focusId);
      render();
      if (document.fonts && document.fonts.ready)
        document.fonts.ready.then(() => { drawLines(); fitView(false); });
    })
    .catch((err) => {
      if (status) status.textContent = "Impossible de charger l'arbre : " + err.message;
    });

  function goTo(id) { setFocus(id); }
  function lifespanOpt(id) {
    const p = I(id);
    return lifespan(p) ? ` (${lifespan(p)})` : "";
  }
})();
