/* ============================================================
   yéni.ch — révisions : carte du canton du Valais
   Quiz « clique la région » + mode révision (survol = nom).
   Données : assets/data/valais.json (géodonnées publiques swisstopo)
   ============================================================ */
(function () {
  if (!YeniCrypto.requireUnlock()) return;

  var SVGNS = "http://www.w3.org/2000/svg";
  var root = document.getElementById("revise");
  var status = document.getElementById("status");

  var CANTONS = [
    { id: "valais", nom: "Valais" },
    { id: "fribourg", nom: "Fribourg" }
  ];
  var cache = {};
  var canton = "valais";
  var DATA = null;
  var set = "districts";      // "districts" | "communes"
  var mode = "quiz";          // "quiz" | "study"
  var order = [], idx = 0, score = 0, missed = [], answered = false, moved = false;
  var svg, gz, labelEl;
  var tx = 0, ty = 0, ts = 1;

  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var selEsc = function (s) { return String(s).replace(/["\\]/g, "\\$&"); };
  var regionByName = function (n) { return svg.querySelector('.rg[data-name="' + selEsc(n) + '"]'); };

  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i];
      a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- construction ---------- */
  function build() {
    var m = DATA[set];
    root.className = "revise";
    root.innerHTML =
      '<div class="revise-bar">' +
        '<div class="seg seg-canton">' +
          CANTONS.map(function (c) {
            return '<button data-canton="' + c.id + '"' + (c.id === canton ? ' class="on"' : "") + '>' + esc(c.nom) + '</button>';
          }).join("") +
        '</div>' +
        '<div class="seg">' +
          '<button data-set="districts"' + (set === "districts" ? ' class="on"' : "") + '>Districts</button>' +
          '<button data-set="communes"' + (set === "communes" ? ' class="on"' : "") + '>Communes</button>' +
        '</div>' +
        '<div class="seg">' +
          '<button data-mode="quiz"' + (mode === "quiz" ? ' class="on"' : "") + '>Quiz</button>' +
          '<button data-mode="study"' + (mode === "study" ? ' class="on"' : "") + '>Réviser</button>' +
        '</div>' +
      '</div>' +
      '<div class="revise-prompt" id="prompt"></div>' +
      '<div class="revise-map" id="mapWrap">' +
        '<svg id="map" viewBox="' + m.viewBox + '" preserveAspectRatio="xMidYMid meet" aria-label="Carte du ' + esc(DATA.titre) + '">' +
          '<g id="gz">' +
            m.regions.map(function (r) {
              return '<path class="rg" data-name="' + esc(r.name) + '" d="' + r.d + '"/>';
            }).join("") +
            '<text id="mapLabel" class="map-label" text-anchor="middle" style="display:none"></text>' +
          '</g>' +
        '</svg>' +
        '<div class="map-zoom">' +
          '<button data-z="in" type="button" aria-label="Zoom avant">+</button>' +
          '<button data-z="out" type="button" aria-label="Zoom arrière">\u2212</button>' +
          '<button data-z="fit" type="button" aria-label="Vue d\'ensemble">\u25A1</button>' +
        '</div>' +
      '</div>' +
      '<div class="revise-foot" id="foot"></div>';

    svg = document.getElementById("map");
    gz = document.getElementById("gz");
    labelEl = document.getElementById("mapLabel");
    tx = ty = 0; ts = 1; applyZoom();
    wireMap();

    if (mode === "quiz") startRound(); else startStudy();
  }

  /* ---------- zoom / déplacement (boutons + glisser ; pas de molette) ---------- */
  function applyZoom() {
    gz.setAttribute("transform", "translate(" + tx.toFixed(1) + " " + ty.toFixed(1) + ") scale(" + ts.toFixed(3) + ")");
  }
  function clampPan() {
    var vb = svg.viewBox.baseVal;
    tx = Math.min(0, Math.max(vb.width - vb.width * ts, tx));
    ty = Math.min(0, Math.max(vb.height - vb.height * ts, ty));
  }
  function zoomBy(f, cx, cy) {
    var vb = svg.viewBox.baseVal;
    if (cx == null) { cx = vb.width / 2; cy = vb.height / 2; }
    var ns = Math.max(1, Math.min(14, ts * f)), k = ns / ts;
    tx = cx - (cx - tx) * k;
    ty = cy - (cy - ty) * k;
    ts = ns;
    clampPan(); applyZoom();
  }
  function fitAll() { tx = ty = 0; ts = 1; applyZoom(); }

  function wireMap() {
    document.querySelector(".map-zoom").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.dataset.z === "in") zoomBy(1.7);
      else if (b.dataset.z === "out") zoomBy(1 / 1.7);
      else fitAll();
    });

    // un doigt = déplacement ; deux doigts = pincement (zoom)
    var pts = new Map(), pan = null, pinch = null;
    function toVb(cx, cy) {
      var r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
      return { x: (cx - r.left) / r.width * vb.width, y: (cy - r.top) / r.height * vb.height };
    }
    function pair() {
      var a = []; pts.forEach(function (p) { a.push(p); });
      var m = toVb((a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2);
      return { m: m, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1 };
    }
    svg.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { moved = false; pan = { v: toVb(e.clientX, e.clientY), tx: tx, ty: ty }; pinch = null; }
      else if (pts.size === 2) {
        moved = true;
        pts.forEach(function (_, id) { try { svg.setPointerCapture(id); } catch (_) {} });
        var g = pair();
        pinch = { m: g.m, d: g.d, ts: ts, tx: tx, ty: ty };
        pan = null;
      }
    });
    svg.addEventListener("pointermove", function (e) {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pinch && pts.size >= 2) {
        e.preventDefault();
        var g = pair();
        var ns = Math.max(1, Math.min(14, pinch.ts * (g.d / pinch.d)));
        var wx = (pinch.m.x - pinch.tx) / pinch.ts, wy = (pinch.m.y - pinch.ty) / pinch.ts;
        ts = ns; tx = g.m.x - wx * ns; ty = g.m.y - wy * ns;
        clampPan(); applyZoom();
        return;
      }
      if (pan) {
        var v = toVb(e.clientX, e.clientY);
        if (!moved && Math.abs(v.x - pan.v.x) + Math.abs(v.y - pan.v.y) > 3) {
          moved = true;
          try { svg.setPointerCapture(e.pointerId); } catch (_) {}
          svg.classList.add("dragging");
        }
        if (moved) { tx = pan.tx + (v.x - pan.v.x); ty = pan.ty + (v.y - pan.v.y); clampPan(); applyZoom(); }
        return;
      }
      showLabel(e.target.closest(".rg") || null);
    }, { passive: false });
    function up(e) {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      try { svg.releasePointerCapture(e.pointerId); } catch (_) {}
      if (pts.size === 1) { var only; pts.forEach(function (p) { only = p; }); pan = { v: toVb(only.x, only.y), tx: tx, ty: ty }; pinch = null; moved = true; }
      else if (pts.size === 0) { svg.classList.remove("dragging"); pan = pinch = null; }
    }
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
    svg.addEventListener("pointerleave", function () { if (!pts.size) showLabel(null); });

    svg.addEventListener("click", function (e) {
      if (moved) return;
      var p = e.target.closest(".rg"); if (!p) return;
      onRegion(p);
    });
  }

  function showLabel(p) {
    if (!p || (mode === "quiz" && !answered && p.dataset.name !== revealName)) {
      labelEl.style.display = "none";
      return;
    }
    var bb = p.getBBox();
    labelEl.setAttribute("x", (bb.x + bb.width / 2).toFixed(1));
    labelEl.setAttribute("y", (bb.y + bb.height / 2).toFixed(1));
    labelEl.textContent = p.dataset.name;
    labelEl.style.display = "";
  }
  var revealName = null;

  /* ---------- quiz ---------- */
  function roundSize() { return set === "districts" ? DATA.districts.regions.length : 12; }

  function startRound() {
    var all = DATA[set].regions.map(function (r) { return r.name; });
    order = shuffle(all).slice(0, roundSize());
    idx = 0; score = 0; missed = []; answered = false; revealName = null;
    clearMarks(); showLabel(null);
    nextQ();
  }
  function clearMarks() {
    [].forEach.call(svg.querySelectorAll(".rg"), function (p) {
      p.classList.remove("ok", "bad", "reveal");
    });
    [].forEach.call(svg.querySelectorAll(".all-label"), function (n) { n.remove(); });
  }
  function nextQ() {
    clearMarks(); showLabel(null);
    answered = false; revealName = null;
    if (idx >= order.length) return finish();
    document.getElementById("prompt").innerHTML =
      '<span class="q-count">' + (idx + 1) + " / " + order.length + '</span>' +
      '<span class="q-name">' + esc(order[idx]) + '</span>' +
      '<button class="q-skip" id="skip" type="button">Passer</button>';
    document.getElementById("skip").addEventListener("click", function () { wrong(null); });
    setFoot(idx / order.length, score + " / " + order.length);
  }
  function onRegion(p) {
    if (mode === "study") { revealName = p.dataset.name; p.classList.add("reveal"); showLabel(p); clearTimeout(p._t); p._t = setTimeout(function () { p.classList.remove("reveal"); }, 1400); return; }
    if (answered) return;
    if (p.dataset.name === order[idx]) {
      answered = true; revealName = p.dataset.name;
      p.classList.add("ok"); showLabel(p);
      score++;
      setTimeout(function () { idx++; nextQ(); }, 520);
    } else {
      wrong(p);
    }
  }
  function wrong(clicked) {
    if (answered) return;
    answered = true;
    missed.push(order[idx]);
    revealName = order[idx];
    if (clicked) clicked.classList.add("bad");
    var t = regionByName(order[idx]);
    if (t) { t.classList.add("reveal"); showLabel(t); }
    setTimeout(function () { idx++; nextQ(); }, 1050);
  }
  function finish() {
    var uniq = missed.filter(function (v, i) { return missed.indexOf(v) === i; });
    document.getElementById("prompt").innerHTML =
      '<span class="q-name">Terminé · ' + score + " / " + order.length + '</span>';
    document.getElementById("foot").innerHTML =
      '<div class="bar"><i style="width:100%"></i></div>' +
      (uniq.length
        ? '<p class="missed"><b>À revoir :</b> ' + uniq.map(esc).join(", ") + '</p>'
        : '<p class="missed">Sans faute \u2713</p>') +
      '<button class="q-restart" id="restart" type="button">Nouvelle série</button>';
    document.getElementById("restart").addEventListener("click", startRound);
    clearMarks();
    uniq.forEach(function (n) { var t = regionByName(n); if (t) t.classList.add("reveal"); });
  }
  function setFoot(frac, txt) {
    document.getElementById("foot").innerHTML =
      '<div class="bar"><i style="width:' + (frac * 100).toFixed(0) + '%"></i></div>' +
      '<span class="score">' + txt + '</span>';
  }

  /* ---------- révision libre ---------- */
  function startStudy() {
    clearMarks(); showLabel(null);
    revealName = null;
    document.getElementById("prompt").innerHTML =
      '<span class="q-name">Mode révision</span>' +
      '<span class="q-hint">survole ou touche une région</span>' +
      '<button class="q-skip" id="showAll" type="button">Tout afficher</button>';
    var on = false;
    document.getElementById("showAll").addEventListener("click", function () {
      on = !on;
      this.textContent = on ? "Masquer" : "Tout afficher";
      svg.classList.toggle("show-all", on);
      [].forEach.call(svg.querySelectorAll(".all-label"), function (n) { n.remove(); });
      if (on) DATA[set].regions.forEach(function (r) {
        var p = regionByName(r.name); if (!p) return;
        var bb = p.getBBox();
        var t = document.createElementNS(SVGNS, "text");
        t.setAttribute("class", "all-label");
        t.setAttribute("x", (bb.x + bb.width / 2).toFixed(1));
        t.setAttribute("y", (bb.y + bb.height / 2).toFixed(1));
        t.setAttribute("text-anchor", "middle");
        t.textContent = r.name;
        gz.appendChild(t);
      });
    });
    document.getElementById("foot").innerHTML =
      '<span class="score">' + DATA[set].regions.length + " " + set + '</span>';
  }

  /* ---------- barre : canton · districts / communes · quiz / réviser ---------- */
  root.addEventListener("click", function (e) {
    var b = e.target.closest("[data-canton],[data-set],[data-mode]");
    if (!b) return;
    if (b.dataset.canton && b.dataset.canton !== canton) { canton = b.dataset.canton; set = "districts"; load(); }
    else if (b.dataset.set && b.dataset.set !== set) { set = b.dataset.set; build(); }
    else if (b.dataset.mode && b.dataset.mode !== mode) { mode = b.dataset.mode; build(); }
  });

  function load() {
    if (cache[canton]) { DATA = cache[canton]; build(); return; }
    if (root.querySelector(".revise-map")) root.querySelector(".revise-map").classList.add("loading");
    fetch("assets/data/" + canton + ".json", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) { cache[canton] = d; DATA = d; build(); })
      .catch(function (err) {
        root.className = "revise";
        root.innerHTML = '<p class="muted">Impossible de charger la carte : ' + esc(err.message) + "</p>";
      });
  }

  load();
})();
