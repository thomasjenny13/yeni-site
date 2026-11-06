/* ============================================================
   yéni.ch — révisions : carte du canton du Valais
   Quiz « clique la région » + mode révision (survol = nom).
   Données : assets/data/valais.json (géodonnées publiques swisstopo)
   Fond : MapLibre + OpenFreeMap, même style que archivir.ch/carte.html
   ============================================================ */
import * as maplibregl from "maplibre-gl";
import { applyMapStyle, DEFAULT_PALETTE } from "./map-style.js?v=110";

(function () {
  if (!YeniCrypto.requireUnlock()) return;

  var root = document.getElementById("revise");
  var status = document.getElementById("status");

  var CANTONS = [
    { id: "valais", nom: "Valais" },
    { id: "fribourg", nom: "Fribourg" }
  ];
  // écran d'accueil : thèmes de révision (pour l'instant, la géographie)
  var SECTIONS = [
    { titre: "Géographie", sous: "Carte des districts et communes", items: CANTONS },
    { titre: "Architecture", sous: "Flash cards", items: [{ deck: "sia102", nom: "Phases SIA 102" }] }
  ];
  var cache = {};
  var canton = null;
  var DATA = null;
  var set = "districts";      // "districts" | "communes"
  var mode = "quiz";          // "quiz" | "study"
  var order = [], idx = 0, score = 0, missed = [], results = [], answered = false;

  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i];
      a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- écran d'accueil : choix du thème / de la carte ---------- */
  function chooser() {
    canton = null; DATA = null; buildId++;
    root.className = "revise revise-home";
    root.innerHTML =
      '<div class="revise-pick">' +
        '<p class="pick-kicker">Révisions</p>' +
        SECTIONS.map(function (s) {
          return '<section class="pick-sec">' +
            '<h2>' + esc(s.titre) + '</h2>' +
            (s.sous ? '<p class="pick-sub">' + esc(s.sous) + '</p>' : "") +
            '<div class="pick-grid">' +
              s.items.map(function (it) {
                var cible = it.deck ? 'data-deck="' + it.deck + '"' : 'data-canton="' + it.id + '"';
                return '<button class="pick-item" ' + cible + ' type="button">' + esc(it.nom) + '</button>';
              }).join("") +
            '</div>' +
          '</section>';
        }).join("") +
      '</div>';
  }

  /* ---------- construction ---------- */
  var buildId = 0;
  function build() {
    var id = ++buildId;
    root.className = "revise";
    root.innerHTML =
      '<div class="revise-bar">' +
        '<button class="revise-back" data-home="1" type="button" aria-label="Choisir une carte">‹ Cartes</button>' +
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
      '<div id="mapSlot" class="revise-slot"></div>' +
      '<div class="revise-foot" id="foot"></div>';

    document.getElementById("mapSlot").appendChild(mapWrap());
    ensureMap();
    map.resize();
    document.getElementById("prompt").innerHTML = '<span class="q-hint">Chargement de la carte…</span>';
    mapReady.then(function () {
      if (id !== buildId) return;
      showRegions();
      if (mode === "quiz") startRound(); else startStudy();
    }).catch(function (err) {
      if (id === buildId) document.getElementById("prompt").innerHTML =
        '<span class="q-hint">Impossible de charger le fond de carte : ' + esc(err.message) + '</span>';
    });
  }

  /* ---------- carte : une seule instance, gardée d'un écran à l'autre ---------- */
  var STYLE = "https://tiles.openfreemap.org/styles/bright";
  var EMPTY = { type: "FeatureCollection", features: [] };
  var map = null, mapReady = null, wrapEl = null;
  var ids = {};                 // nom de région → id de l'entité
  var marks = {};               // id → état affiché
  var hoverId = null;
  var showCtx = true;
  var labelMarker = null, allMarkers = [], voisinMarkers = [];

  function mapWrap() {
    if (wrapEl) return wrapEl;
    wrapEl = document.createElement("div");
    wrapEl.className = "revise-map";
    wrapEl.id = "mapWrap";
    wrapEl.innerHTML =
      '<div id="map"></div>' +
      '<div class="map-zoom">' +
        '<button data-z="in" type="button" aria-label="Zoom avant">+</button>' +
        '<button data-z="out" type="button" aria-label="Zoom arrière">\u2212</button>' +
        '<button data-z="fit" type="button" aria-label="Vue d\'ensemble">\u25A1</button>' +
        '<button data-z="ctx" type="button" class="on" aria-pressed="true" aria-label="Fond de carte" title="Fond de carte">\u25B2</button>' +
      '</div>';
    wrapEl.querySelector(".map-zoom").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b || !map) return;
      if (b.dataset.z === "in") map.zoomIn();
      else if (b.dataset.z === "out") map.zoomOut();
      else if (b.dataset.z === "fit") fitAll();
      else {
        showCtx = !showCtx;
        map.setLayoutProperty("sans-fond", "visibility", showCtx ? "none" : "visible");
        b.classList.toggle("on", showCtx);
        b.setAttribute("aria-pressed", showCtx);
      }
    });
    return wrapEl;
  }

  function ensureMap() {
    if (map) return;
    map = new maplibregl.Map({
      container: wrapEl.querySelector("#map"),
      style: STYLE,
      bounds: DATA.bounds,
      fitBoundsOptions: { padding: 24 },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Limites : swisstopo" }), "bottom-left");
    window.addEventListener("resize", function () { map.resize(); });
    mapReady = new Promise(function (resolve, reject) {
      map.once("style.load", function () { addLayers(); resolve(); });
      map.once("error", function (e) { if (!map.isStyleLoaded()) reject(e.error || new Error("réseau")); });
    });
    wireMap();
  }

  function addLayers() {
    applyMapStyle(map, DEFAULT_PALETTE);
    ["water_name_point_label", "water_name_line_label", "waterway_line_label"].forEach(function (l) {
      map.setLayoutProperty(l, "text-field", ["coalesce", ["get", "name:fr"], ["get", "name"]]);
    });
    // au-dessus des routes, sous les noms des lacs et rivières
    var before = "road_oneway";
    var world = { type: "Polygon", coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] };
    map.addSource("sans-fond", { type: "geojson", data: world });
    map.addLayer({ id: "sans-fond", type: "fill", source: "sans-fond", layout: { visibility: "none" }, paint: { "fill-color": DEFAULT_PALETTE.paper } }, before);
    // le dehors du canton s'efface sous un voile : on garde les repères, sans distraire
    map.addSource("hors", { type: "geojson", data: EMPTY });
    map.addLayer({ id: "hors", type: "fill", source: "hors", paint: { "fill-color": DEFAULT_PALETTE.paper, "fill-opacity": .62 } }, before);
    map.addSource("regions", { type: "geojson", data: EMPTY });
    map.addLayer({
      id: "regions", type: "fill", source: "regions",
      paint: {
        "fill-color": ["match", ["coalesce", ["feature-state", "mark"], ""],
          "ok", "#4d7a58", "bad", "#c23a2c", "reveal", "#b8893a", "#29496b"],
        "fill-opacity": ["case",
          ["!=", ["coalesce", ["feature-state", "mark"], ""], ""], .62,
          ["boolean", ["feature-state", "hover"], false], .16,
          0]
      }
    }, before);
    map.addLayer({
      id: "regions-trait", type: "line", source: "regions",
      paint: { "line-color": "#1b2230", "line-opacity": .75, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 12, 2] }
    }, before);
  }

  // une carte par canton et par niveau : on remplace juste les régions
  function showRegions() {
    ids = {}; marks = {}; hoverId = null;
    map.getSource("regions").setData({
      type: "FeatureCollection",
      features: DATA[set].regions.map(function (r, i) {
        ids[r.name] = i;
        return { type: "Feature", id: i, properties: { name: r.name }, geometry: { type: "MultiPolygon", coordinates: r.coords } };
      })
    });
    map.removeFeatureState({ source: "regions" });
    map.getSource("hors").setData({ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: DATA.hors } });
    voisinMarkers.forEach(function (m) { m.remove(); });
    voisinMarkers = DATA.voisins.map(function (v) { return textMarker("ctx-voisin", v.nom, v.pos); });
    // limites prises sur la vue affichée, pas sur le canton : sinon un canton en
    // hauteur dans un écran en largeur force le zoom et se retrouve coupé
    map.setMaxBounds(null);
    map.setMinZoom(null);
    fitAll(true);
    var v = map.getBounds(), dx = .4 * (v.getEast() - v.getWest()), dy = .4 * (v.getNorth() - v.getSouth());
    map.setMaxBounds([[v.getWest() - dx, v.getSouth() - dy], [v.getEast() + dx, v.getNorth() + dy]]);
    map.setMinZoom(map.getZoom() - .5);
    hideAll();
  }
  function fitAll(now) { map.fitBounds(DATA.bounds, { padding: 24, duration: now ? 0 : 300 }); }

  function textMarker(cls, text, pos) {
    var el = document.createElement("div");
    el.className = cls;
    el.textContent = text;
    return new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(pos).addTo(map);
  }

  function setMark(name, m) {
    var id = ids[name]; if (id == null) return;
    marks[id] = m;
    map.setFeatureState({ source: "regions", id: id }, { mark: m });
  }

  function wireMap() {
    map.on("mousemove", "regions", function (e) {
      var f = e.features[0]; if (!f) return;
      map.getCanvas().style.cursor = "pointer";
      if (hoverId !== f.id) {
        if (hoverId != null) map.setFeatureState({ source: "regions", id: hoverId }, { hover: false });
        hoverId = f.id;
        map.setFeatureState({ source: "regions", id: f.id }, { hover: true });
      }
      showLabel(f.properties.name);
    });
    map.on("mouseleave", "regions", function () {
      map.getCanvas().style.cursor = "";
      if (hoverId != null) map.setFeatureState({ source: "regions", id: hoverId }, { hover: false });
      hoverId = null;
      showLabel(null);
    });
    map.on("click", "regions", function (e) {
      if (e.features[0]) onRegion(e.features[0].properties.name);
    });
  }

  function centerOf(name) {
    var r = DATA[set].regions.filter(function (x) { return x.name === name; })[0];
    var b = new maplibregl.LngLatBounds();
    // le centre du plus grand morceau : les enclaves ne déportent pas le nom
    var largest = r.coords.reduce(function (a, p) { return p[0].length > a[0].length ? p : a; });
    largest[0].forEach(function (c) { b.extend(c); });
    return b.getCenter();
  }

  function showLabel(name) {
    if (labelMarker) { labelMarker.remove(); labelMarker = null; }
    if (!name || (mode === "quiz" && !answered && name !== revealName)) return;
    labelMarker = textMarker("map-label", name, centerOf(name));
  }
  var revealName = null;

  /* ---------- quiz ---------- */
  function roundSize() { return set === "districts" ? DATA.districts.regions.length : 12; }

  function startRound() {
    var all = DATA[set].regions.map(function (r) { return r.name; });
    order = shuffle(all).slice(0, roundSize());
    idx = 0; score = 0; missed = []; results = []; answered = false; revealName = null;
    clearMarks();
    nextQ();
  }
  function clearMarks() {
    Object.keys(marks).forEach(function (id) {
      map.removeFeatureState({ source: "regions", id: +id }, "mark");
    });
    marks = {};
    showLabel(null);
  }
  function nextQ() {
    clearMarks();
    answered = false; revealName = null;
    if (idx >= order.length) return finish();
    document.getElementById("prompt").innerHTML =
      '<span class="q-count">' + (idx + 1) + " / " + order.length + '</span>' +
      '<span class="q-name">' + esc(order[idx]) + '</span>' +
      '<button class="q-skip" id="skip" type="button">Passer</button>';
    document.getElementById("skip").addEventListener("click", function () { wrong(null); });
    setFoot(score + " / " + order.length);
  }
  var studyTimer = {};
  function onRegion(name) {
    if (mode === "study") {
      revealName = name; setMark(name, "reveal"); showLabel(name);
      clearTimeout(studyTimer[name]);
      studyTimer[name] = setTimeout(function () {
        if (ids[name] == null) return;
        delete marks[ids[name]];
        map.removeFeatureState({ source: "regions", id: ids[name] }, "mark");
      }, 1400);
      return;
    }
    if (answered) return;
    if (name === order[idx]) {
      answered = true; revealName = name;
      setMark(name, "ok"); showLabel(name);
      score++; results[idx] = "ok";
      setTimeout(function () { idx++; nextQ(); }, 520);
    } else {
      wrong(name);
    }
  }
  function wrong(clicked) {
    if (answered) return;
    answered = true;
    missed.push(order[idx]);
    results[idx] = "ko";
    revealName = order[idx];
    if (clicked) setMark(clicked, "bad");
    setMark(order[idx], "reveal"); showLabel(order[idx]);
    setTimeout(function () { idx++; nextQ(); }, 1050);
  }
  function finish() {
    var uniq = missed.filter(function (v, i) { return missed.indexOf(v) === i; });
    document.getElementById("prompt").innerHTML =
      '<span class="q-name">Terminé · ' + score + " / " + order.length + '</span>';
    document.getElementById("foot").innerHTML =
      ruler() + '<span class="score">' + score + " / " + order.length + '</span>' +
      (uniq.length
        ? '<p class="missed"><b>À revoir :</b> ' + uniq.map(esc).join(", ") + '</p>'
        : '<p class="missed">Sans faute \u2713</p>') +
      '<button class="q-restart" id="restart" type="button">Nouvelle série</button>';
    document.getElementById("restart").addEventListener("click", startRound);
    clearMarks();
    uniq.forEach(function (n) { setMark(n, "reveal"); });
  }
  // une graduation par question : juste, faux, ou celle en cours
  function ruler() {
    return '<div class="ruler" aria-hidden="true">' + order.map(function (_, i) {
      var c = results[i] || (i === idx ? "now" : "");
      return '<i' + (c ? ' class="' + c + '"' : "") + '></i>';
    }).join("") + '</div>';
  }
  function setFoot(txt) {
    document.getElementById("foot").innerHTML =
      ruler() + '<span class="score">' + txt + '</span>';
  }

  /* ---------- révision libre ---------- */
  function startStudy() {
    clearMarks();
    revealName = null;
    document.getElementById("prompt").innerHTML =
      '<span class="q-name">Mode révision</span>' +
      '<span class="q-hint">survole ou touche une région</span>' +
      '<button class="q-skip" id="showAll" type="button">Tout afficher</button>';
    var on = false;
    document.getElementById("showAll").addEventListener("click", function () {
      on = !on;
      this.textContent = on ? "Masquer" : "Tout afficher";
      hideAll();
      if (on) allMarkers = DATA[set].regions.map(function (r) { return textMarker("all-label", r.name, centerOf(r.name)); });
    });
    document.getElementById("foot").innerHTML =
      '<span class="score">' + DATA[set].regions.length + " " + set + '</span>';
  }

  function hideAll() {
    allMarkers.forEach(function (m) { m.remove(); });
    allMarkers = [];
  }

  /* ---------- barre : canton · districts / communes · quiz / réviser ---------- */
  root.addEventListener("click", function (e) {
    var b = e.target.closest("[data-home],[data-deck],[data-canton],[data-set],[data-mode]");
    if (!b) return;
    if (b.dataset.home) { chooser(); }
    else if (b.dataset.deck) { YeniCartes.open(root, b.dataset.deck); }
    else if (b.dataset.canton && b.dataset.canton !== canton) { canton = b.dataset.canton; set = "districts"; mode = "quiz"; load(); }
    else if (b.dataset.set && b.dataset.set !== set) { set = b.dataset.set; build(); }
    else if (b.dataset.mode && b.dataset.mode !== mode) { mode = b.dataset.mode; build(); }
  });

  function load() {
    if (cache[canton]) { DATA = cache[canton]; build(); return; }
    fetch("assets/data/" + canton + ".json", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) { cache[canton] = d; DATA = d; build(); })
      .catch(function (err) {
        root.className = "revise";
        root.innerHTML = '<p class="muted">Impossible de charger la carte : ' + esc(err.message) + "</p>";
      });
  }

  chooser();
})();
