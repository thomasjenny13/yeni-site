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
  // ascendance directe du focus (les deux parents à chaque génération) : on
  // déploie pleinement cette lignée ; les branches sœurs (collatéraux) montrent
  // leur famille proche — conjoint·e, enfants, petits-enfants.
  let lineToFocus = new Set();   // ascendance directe du focus → « fil rouge »

  // transform du canevas
  let tx = 0, ty = 0, ts = 1;
  const MIN_S = 0.12, MAX_S = 5, FIT_MAX = 1.35;
  // dézoom automatique plafonné : au-delà d'un certain nombre de personnes,
  // on ne rapetisse plus l'arbre (les noms resteraient illisibles) — on cadre
  // sur la personne et le reste se parcourt en glissant.
  const FIT_MIN = 0.62;

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
  // tous les ancêtres directs de `id` : on remonte par les DEUX parents à
  // chaque génération (l'ascendance ne se ramifie qu'en 2, et les lignées
  // s'arrêtent vite faute de données). Sert à tracer le « fil rouge ».
  function ancestryHot(id) {
    const drops = new Set();   // `${fid}>${enfantId}`
    const unions = new Set();  // fid des unions d'ancêtres
    const seen = new Set();
    (function up(cur) {
      if (seen.has(cur)) return;
      seen.add(cur);
      const pf = parentFamilyEntryOf(cur);
      if (!pf) return;
      drops.add(pf.fid + ">" + cur);
      unions.add(pf.fid);
      (pf.conjoints || []).forEach(up);
    })(id);
    return { drops, unions };
  }
  const spousesOf = (id) => {
    const s = [];
    familiesOf(id).forEach((f) => (f.conjoints || []).forEach((c) => {
      if (c !== id && !s.includes(c)) s.push(c);
    }));
    return s;
  };
  // nombre total de descendants (mémoïsé) — sert à équilibrer l'étalement
  const descCache = new Map();
  function descCount(id) {
    if (descCache.has(id)) return descCache.get(id);
    descCache.set(id, 0);  // garde-fou anti-boucle
    let n = 0;
    childrenOf(id).forEach((c) => { n += 1 + descCount(c); });
    descCache.set(id, n);
    return n;
  }
  const childrenOf = (id) => {
    const c = [];
    familiesOf(id).forEach((f) => (f.enfants || []).forEach((k) => { if (!c.includes(k)) c.push(k); }));
    return c;
  };
  // nombre de générations d'ascendance connues au-dessus de `id`
  function ancestryDepth(id) {
    let d = 0, cur = id;
    for (let i = 0; i < 40; i++) {
      const pf = parentFamilyOf(cur);
      if (!pf || !(pf.conjoints || []).length) return d;
      cur = (pf.conjoints || []).find((c) => parentFamilyOf(c)) || pf.conjoints[0];
      d++;
    }
    return d;
  }
  function topmostAncestor(id) {
    let cur = id;
    for (let i = 0; i < 40; i++) {
      const pf = parentFamilyOf(cur);
      if (pf && (pf.conjoints || []).length) {
        const withAsc = (pf.conjoints || []).filter((c) => parentFamilyOf(c));
        // deux lignées possibles → on remonte par la plus profonde (le plus de
        // générations connues), pour afficher le plus grand arbre
        cur = withAsc.length
          ? withAsc.reduce((a, b) => (ancestryDepth(a) >= ancestryDepth(b) ? a : b))
          : pf.conjoints[0];
        continue;
      }
      // pas de parents connus : si la personne a rejoint la famille par
      // mariage, on remonte plutôt par un·e conjoint·e qui a une ascendance
      const sp = spousesOf(cur).find((s) => parentFamilyOf(s));
      if (!sp) return cur;
      cur = sp;
    }
    return cur;
  }

  // tous les ancêtres directs de `id` (par les deux parents), `id` compris
  function ancestorsOf(id) {
    const s = new Set([id]);
    (function up(x) {
      const pf = parentFamilyOf(x);
      if (!pf) return;
      (pf.conjoints || []).forEach((p) => { if (!s.has(p)) { s.add(p); up(p); } });
    })(id);
    return s;
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

  // chaque bulle est dans une « cellule » qui peut porter, au-dessus, un petit
  // couple = ses parents connus s'ils ne sont pas déjà ailleurs dans l'arbre
  // (utile pour les conjoint·es entré·es dans la famille).
  function cell(node, pid) {
    const c = document.createElement("div");
    c.className = "couple-cell";
    const pf = parentFamilyEntryOf(pid);
    const parents = pf ? (pf.conjoints || []).filter((x) => x !== pid) : [];
    if (parents.length && !parents.some((x) => nodeById.has(x))) {
      const cap = document.createElement("div");
      cap.className = "cell-parents";
      cap.dataset.fid = pf.fid;
      cap.dataset.child = pid;
      parents.forEach((ppid) => {
        const pn = nodeDiv(ppid);
        pn.classList.add("is-mini");
        cap.appendChild(pn);
      });
      c.appendChild(cap);
    }
    c.appendChild(node);
    return c;
  }

  // arbre COMPLET à partir de `id` : toute la descendance, tous les conjoint·es.
  function personLi(id, depth) {
    depth = depth || 0;
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

    // 0-1 conjoint·e : « personne — conjoint·e ». Plusieurs : on encadre la
    // personne (conjoint·e — PERSONNE — conjoint·e) pour que chaque trait
    // relie des bulles adjacentes.
    const primCell = cell(prim, id);
    if (spouseNodes.length <= 1) {
      couple.appendChild(primCell);
      spouseNodes.forEach((sn) => couple.appendChild(cell(sn, sn.dataset.id)));
    } else {
      const half = Math.floor(spouseNodes.length / 2);
      spouseNodes.slice(0, half).forEach((sn) => couple.appendChild(cell(sn, sn.dataset.id)));
      couple.appendChild(primCell);
      spouseNodes.slice(half).forEach((sn) => couple.appendChild(cell(sn, sn.dataset.id)));
    }
    li.appendChild(couple);

    // toute la descendance (garde-fou de profondeur contre une donnée en boucle)
    const kids = [];
    if (depth < 30) {
      fams.forEach((f) => (f.enfants || []).forEach((kid) => {
        const kl = personLi(kid, depth + 1);
        kl.dataset.union = f.fid;
        kids.push({ kl, id: kid, spine: lineToFocus.has(kid) });
      }));
    }
    if (kids.length) {
      const ul = document.createElement("ul");
      // équilibrage : l'enfant de la lignée (ou le plus « lourd ») au centre,
      // les grosses descendances vers l'extérieur, les feuilles près du centre —
      // sinon un enfant sans descendance se retrouve loin sur un côté.
      let ordered = kids;
      if (kids.length > 1) {
        const rest = kids.slice();
        let center = null;
        const si = rest.findIndex((k) => k.spine);
        if (si >= 0) center = rest.splice(si, 1)[0];
        rest.sort((a, b) => descCount(b.id) - descCount(a.id));  // plus lourd d'abord
        const left = [], right = [];
        rest.forEach((k, i) => (i % 2 ? right : left).push(k));
        ordered = left.concat(center ? [center] : [], right.reverse());
      }
      ordered.forEach((k) => ul.appendChild(k.kl));
      li.appendChild(ul);
    }
    return li;
  }

  function render() {
    nodeById.clear();
    scroll.querySelectorAll("#status").forEach((n) => n.remove());

    // changement de branche : l'ancien arbre s'efface dans un voile « nuage »
    // pendant que le nouveau apparaît en fondu
    const old = scroll.querySelector(".tree:not(.tree-fading)");
    if (old) {
      old.classList.add("tree-fading");
      setTimeout(() => old.remove(), 340);
      let veil = scroll.querySelector(".tree-veil");
      if (!veil) {
        veil = document.createElement("div");
        veil.className = "tree-veil";
        scroll.appendChild(veil);
      }
      veil.classList.remove("on");
      void veil.offsetWidth;            // redémarre l'animation
      veil.classList.add("on");
    }

    // le nouvel arbre apparaît directement à son cadrage (aucun déplacement) :
    // seule la transition est le fondu « nuage ».
    lineToFocus = ancestorsOf(focusId);

    tx = 0; ty = 0; ts = 1;
    const ul = document.createElement("ul");
    ul.className = "tree no-anim" + (old ? " tree-in" : "");
    ul.style.transform = "translate(0px,0px) scale(1)";
    ul.addEventListener("animationend", () => ul.classList.remove("tree-in"), { once: true });
    ul.appendChild(personLi(rootId));
    scroll.appendChild(ul);
    if (!nodeById.has(focusId)) focusId = rootId;
    applyFocus(false);
  }

  /* ---------- connecteurs (SVG, coudes arrondis) ---------- */
  const SVGNS = "http://www.w3.org/2000/svg";
  const R = 10; // rayon des coudes

  function drawLines() {
    const tree = scroll.querySelector(".tree:not(.tree-fading)");
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

    // bulles principales d'un <li> : la personne + ses conjoint·es
    // (hors mini-parents dans .cell-parents et hors bulles « flanquantes »)
    const mainNodes = (couple) => [...couple.querySelectorAll(
      ":scope > .node, :scope > .couple-cell > .node")];
    const primNodeOf = (li) => {
      const c = li.querySelector(":scope > .couple");
      return c.querySelector(".node.is-primary") || mainNodes(c)[0];
    };

    // mini-couples « parents connus » → petit trait entre eux + descente vers la
    // bulle. En gueules (fil rouge) quand ce sont des ancêtres du focus.
    tree.querySelectorAll(".cell-parents").forEach((cap) => {
      const minis = [...cap.querySelectorAll(":scope > .node")].map(P);
      const child = P(cap.nextElementSibling);
      const fid = cap.dataset.fid;
      const linkOut = hot.unions.has(fid) ? descentHot : descent;
      const dropOut = hot.drops.has(fid + ">" + cap.dataset.child) ? descentHot : descent;
      if (minis.length === 2) {
        const [l, r] = minis[0].cx < minis[1].cx ? minis : [minis[1], minis[0]];
        const y = (minis[0].midY + minis[1].midY) / 2;
        linkOut.push(`M ${l.right} ${y} L ${r.left} ${y}`);
      }
      const mx = minis.reduce((s, m) => s + m.cx, 0) / minis.length;
      const my = Math.max(...minis.map((m) => m.bot));
      dropOut.push(`M ${mx.toFixed(1)} ${my.toFixed(1)} L ${mx.toFixed(1)} ${child.top.toFixed(1)}`);
    });

    tree.querySelectorAll("li").forEach((li) => {
      const personId = li.dataset.person;
      const couple = li.querySelector(":scope > .couple");
      if (!couple) return;
      const nodeEls = mainNodes(couple);
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

    svg.setAttribute("width", tr.width / ts);
    svg.setAttribute("height", tr.height / ts);
    svg.setAttribute("viewBox", `0 0 ${tr.width / ts} ${tr.height / ts}`);
    svg.innerHTML =
      `<path class="ln-descent" d="${descent.join(" ")}" fill="none"/>` +
      links.map((l) => `<path class="ln-link ${l.cls}" d="${l.d}" fill="none"/>`).join("") +
      `<path class="ln-descent ln-hot" d="${descentHot.join(" ")}" fill="none"/>` +
      linksHot.map((l) => `<path class="ln-link ln-hot ${l.cls}" d="${l.d}" fill="none"/>`).join("");
  }

  function applyFocus(smooth = true) {
    const kin = kinOf(focusId);
    nodeById.forEach((el, id) => {
      el.classList.toggle("is-focus", id === focusId);
      el.classList.toggle("is-kin", id !== focusId && kin.has(id));
    });
    if (rootSel) rootSel.value = focusId;
    const u = new URLSearchParams();
    u.set("p", rootId);
    u.set("f", focusId);
    history.replaceState(null, "", "?" + u.toString());
    drawLines();
    requestAnimationFrame(() => fitView(smooth));
  }

  /* ---------- transform ---------- */
  function applyTransform(smooth) {
    const tree = scroll.querySelector(".tree:not(.tree-fading)");
    if (!tree) return;
    tree.classList.toggle("no-anim", !smooth);
    tree.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${ts.toFixed(4)})`;
  }

  // déplacement fluide : on cumule les deltas et on applique une seule fois
  // par frame (le pavé tactile envoie beaucoup d'événements)
  let panRAF = 0, panDX = 0, panDY = 0, panTree = null, panIdle = 0;
  function panFlush() {
    panRAF = 0;
    tx += panDX; ty += panDY; panDX = panDY = 0;
    const t = panTree || (panTree = scroll.querySelector(".tree:not(.tree-fading)"));
    if (!t) return;
    t.classList.add("no-anim");
    t.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${ts.toFixed(4)})`;
    clearTimeout(panIdle);
    panIdle = setTimeout(() => { panTree = null; }, 250);
  }
  function panBy(dx, dy) {
    panDX += dx; panDY += dy;
    if (!panRAF) panRAF = requestAnimationFrame(panFlush);
  }
  // applyTransform limité à une fois par frame (glisser au doigt / pincement)
  let applyRAF = 0;
  function scheduleApply() {
    if (applyRAF) return;
    applyRAF = requestAnimationFrame(() => { applyRAF = 0; applyTransform(false); });
  }
  function localRect(els) {
    const tree = scroll.querySelector(".tree:not(.tree-fading)");
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
    const tree = scroll.querySelector(".tree:not(.tree-fading)");
    if (!tree || !nodeById.get(focusId)) return;
    const els = fitTargets().map((id) => nodeById.get(id)).filter(Boolean);
    if (!els.length) return;
    const box = localRect(els);
    const vw = scroll.clientWidth, vh = scroll.clientHeight;
    const pad = 52;
    // la fiche (en bas) ne contraint pas le zoom : on garde le calcul sur
    // toute la hauteur, on décale seulement le centrage vertical
    const cardH = (card && !card.hidden) ? Math.min(card.offsetHeight, vh * 0.5) : 0;
    const fit = Math.min(
      (vw - pad) / Math.max(1, box.w),
      (vh - pad) / Math.max(1, box.h),
      FIT_MAX);
    // sur petit écran, ne pas réduire au point de rendre les étiquettes
    // illisibles : on garde une échelle minimale et on cadre sur la personne,
    // le reste se parcourt en glissant.
    const narrow = vw < 640;
    const floor = narrow ? 0.6 : FIT_MIN;
    const s = Math.max(floor, fit);
    const tight = s > fit + 0.001;   // on a dû relever l'échelle → cadrer sur le focus
    let cx = box.x + box.w / 2;
    let cy = box.y + box.h / 2;
    if (tight) {
      const f = localRect([nodeById.get(focusId)]);
      cx = f.x + f.w / 2;
      cy = f.y + f.h / 2;
    }
    tx = vw / 2 - cx * s;
    ty = (vh - cardH) / 2 - cy * s;
    ts = s;
    applyTransform(smooth);
  }

  // sélectionner quelqu'un : si la personne est déjà dans l'arbre affiché, on
  // met juste le « fil rouge » à jour ; sinon on ré-enracine sur son ancêtre le
  // plus haut et on redéploie tout l'arbre (transition « nuage »).
  function setFocus(id) {
    if (!I(id) || id === focusId) return;
    focusId = id;
    const nr = topmostAncestor(id);
    if (nr === rootId && nodeById.has(id)) { applyFocus(true); return; }
    rootId = nr;
    render();
  }

  /* ---------- molette / trackpad ---------- */
  // ⌘/Ctrl + molette, ou pincement trackpad → zoom vers le curseur
  // molette de souris (crans nets, pas de deltaX) → zoom vers le curseur
  // deux doigts sur le pad → déplacement de l'arbre ; un slide horizontal
  // appuyé n'est pas capté → Firefox : page précédente / suivante
  scroll.addEventListener("wheel", (e) => {
    if (!scroll.querySelector(".tree")) return;
    const scale = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? scroll.clientHeight : 1);
    const pinch = e.ctrlKey || e.metaKey;
    const mouseWheel = e.deltaX === 0 && (e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50);

    if (pinch || mouseWheel) {
      e.preventDefault();
      const step = pinch ? 0.012 : 0.0016;
      const ns = Math.max(MIN_S, Math.min(MAX_S, ts * Math.exp(-e.deltaY * scale * step)));
      const k = ns / ts;
      const rect = scroll.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      tx = mx - (mx - tx) * k;
      ty = my - (my - ty) * k;
      ts = ns;
      applyTransform(false);
      return;
    }

    // deux doigts → déplacement. Geste franchement horizontal : on ne le
    // capte pas (le navigateur gère le slide appuyé = précédent / suivant).
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.3) return;
    e.preventDefault();
    panBy(-e.deltaX * scale, -e.deltaY * scale);
  }, { passive: false });

  // un doigt = déplacement ; deux doigts = pincement (zoom) — tactile compris
  const pts = new Map();
  let moved = false, pan = null, pinch = null;
  const rectOf = () => scroll.getBoundingClientRect();
  function twoFingers() {
    const [a, b] = [...pts.values()];
    return {
      mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
      d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    };
  }
  scroll.addEventListener("pointerdown", (e) => {
    if (!scroll.querySelector(".tree")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      moved = false;
      pan = { x: e.clientX, y: e.clientY, tx, ty };
      pinch = null;
    } else if (pts.size === 2) {
      moved = true;
      const g = twoFingers(), r = rectOf();
      pts.forEach((_, id) => { try { scroll.setPointerCapture(id); } catch (_) {} });
      pinch = { mx: g.mx - r.left, my: g.my - r.top, d: g.d, ts, tx, ty };
      pan = null;
    }
  });
  scroll.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch && pts.size >= 2) {
      e.preventDefault();
      const g = twoFingers(), r = rectOf();
      const mx = g.mx - r.left, my = g.my - r.top;
      const ns = Math.max(MIN_S, Math.min(MAX_S, pinch.ts * (g.d / pinch.d)));
      const wx = (pinch.mx - pinch.tx) / pinch.ts;
      const wy = (pinch.my - pinch.ty) / pinch.ts;
      ts = ns; tx = mx - wx * ns; ty = my - wy * ns;
      scheduleApply();
      return;
    }
    if (!pan) return;
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if (!moved && Math.abs(dx) + Math.abs(dy) > 4) {
      moved = true;
      try { scroll.setPointerCapture(e.pointerId); } catch (_) {}
      scroll.classList.add("grabbing");
    }
    if (moved) { tx = pan.tx + dx; ty = pan.ty + dy; scheduleApply(); }
  }, { passive: false });
  function endPtr(e) {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    try { scroll.releasePointerCapture(e.pointerId); } catch (_) {}
    if (pts.size === 1) {
      const [only] = pts.values();
      pan = { x: only.x, y: only.y, tx, ty };
      pinch = null; moved = true;
    } else if (pts.size === 0) {
      scroll.classList.remove("grabbing");
      if (!moved) {
        const onNode = e.target.closest && e.target.closest(".node");
        const onCard = e.target.closest && e.target.closest(".person-card");
        if (!onNode && !onCard) closeCard();
      }
      pan = pinch = null;
    }
  }
  scroll.addEventListener("pointerup", endPtr);
  scroll.addEventListener("pointercancel", endPtr);
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

      // recherche : normalisation minuscule + sans accents
      const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const nameCount = {};
      ids.forEach((id) => { const n = fullName(id); nameCount[n] = (nameCount[n] || 0) + 1; });
      const optLabel = (id) => {
        const n = fullName(id), ls = lifespan(I(id));
        return (nameCount[n] > 1 && ls) ? `${n} (${ls})` : n;
      };
      peopleList.innerHTML = ids.map((id) => `<option value="${escapeHtml(optLabel(id))}">`).join("");

      function resolveSearch(raw) {
        const query = norm((raw || "").trim());
        if (!query) return null;
        let hit = ids.find((id) => norm(optLabel(id)) === query || norm(fullName(id)) === query);
        if (hit) return hit;
        const words = query.split(/\s+/);
        const found = ids.filter((id) => {
          const n = norm(fullName(id));
          return words.every((w) => n.includes(w));
        });
        found.sort((a, b) => {
          const na = norm(fullName(a)), nb = norm(fullName(b));
          return (na.startsWith(query) ? 0 : 1) - (nb.startsWith(query) ? 0 : 1)
            || (nodeById.has(b) ? 1 : 0) - (nodeById.has(a) ? 1 : 0)   // déjà à l'écran d'abord
            || na.length - nb.length;
        });
        return found[0] || null;
      }
      function runSearch() {
        const hit = resolveSearch(search.value);
        if (hit) {
          search.classList.remove("nomatch");
          search.value = fullName(hit);
          search.blur();
          goTo(hit); openCard(hit);
        } else if (search.value.trim()) {
          search.classList.add("nomatch");
        }
      }

      if (rootSel) {
        rootSel.innerHTML = ids
          .map((id) => `<option value="${id}">${escapeHtml(fullName(id))}${lifespanOpt(id)}</option>`)
          .join("");
        rootSel.addEventListener("change", () => goTo(rootSel.value));
      }
      search.addEventListener("change", runSearch);
      search.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); runSearch(); }
      });
      search.addEventListener("input", () => {
        search.classList.remove("nomatch");
        // sélection dans la liste déroulante → on y va immédiatement
        const v = search.value.trim();
        if (v) {
          const exact = ids.find((id) => norm(optLabel(id)) === norm(v));
          if (exact) runSearch();
        }
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
      // on enracine toujours sur l'ancêtre le plus haut de la personne visée :
      // la vue montre toute la lignée, jamais un sous-arbre réduit
      rootId = topmostAncestor(focusId);
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
