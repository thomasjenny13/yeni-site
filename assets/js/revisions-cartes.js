/* ============================================================
   yéni.ch — révisions : paquets de cartes (phases SIA 102…)
   Modes : Cartes, Apprendre, Test, Associer, Ordre, Évolution.
   Sessions : « Thomas » = localStorage (ce navigateur, avec
   historique) ; « Invité » = en mémoire, rien n'est gardé.
   Maîtrise : niveau 0–4 façon Leitner ; un niveau ne se gagne
   qu'une fois par intervalle, donc « maîtrisée » (niveau 3)
   demande plusieurs jours de révision.
   ============================================================ */
var YeniCartes = (function () {
  var DAY = 86400000;
  var INTERVALS = [0, 1, 3, 7, 21];
  var MASTER = 3;
  var ROUND = 7;
  var DUNNO = '<button type="button" class="c-dunno" data-act="dunno">Tu ne sais pas ?</button>';
  var PAIRS = 6;
  var MODES = [
    { v: "cartes", t: "Cartes" }, { v: "apprendre", t: "Apprendre" }, { v: "test", t: "Test" },
    { v: "associer", t: "Associer" }, { v: "ordre", t: "Ordre" }, { v: "evolution", t: "Évolution" }
  ];
  var WHO_KEY = "yeni.rev.who";

  var root, deck, who = null, st, mode = "cartes", scope = "all", dir = "code";
  var wrap, stage, acts = {}, onKey = null, timer = null, runId = 0, storageOk = true;

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
  var isPhase = function (c) { return c.code.length === 3; };
  var parentOf = function (c) {
    return deck.cartes.filter(function (p) { return p.code === c.code.slice(0, 3); })[0];
  };
  function scoped() {
    return deck.cartes.filter(function (c) {
      return scope === "all" || (scope === "phases") === isPhase(c);
    });
  }
  var ask = function (c) { return dir === "code" ? c.code : c.nom; };
  var ans = function (c) { return dir === "code" ? c.nom : c.code; };
  function context(c) {
    if (!isPhase(c)) { var p = parentOf(c); return "Phase " + p.code + " · " + p.nom; }
    return deck.cartes.filter(function (s) { return !isPhase(s) && s.code.slice(0, 3) === c.code; })
      .map(function (s) { return s.code + " " + s.nom; }).join(" · ");
  }

  /* ---------- progression ---------- */
  function blank() { return { cards: {}, sessions: [], days: {}, rev: {} }; }
  var storeKey = function () { return "yeni.rev." + deck.id + ".thomas"; };
  function loadState() {
    storageOk = true;
    if (who !== "thomas") return blank();
    try {
      var o = JSON.parse(localStorage.getItem(storeKey()));
      if (o && o.cards) return { cards: o.cards, sessions: o.sessions || [], days: o.days || {}, rev: o.rev || {} };
    } catch (_) { storageOk = false; }
    return blank();
  }
  function save() {
    if (who !== "thomas") return;
    try { localStorage.setItem(storeKey(), JSON.stringify(st)); }
    catch (_) { storageOk = false; }
  }
  function dayKey(t) {
    var d = new Date(t), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function startOfDay(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  var levelOf = function (c) { var s = st.cards[c.code]; return s ? s.lvl : 0; };
  var isDue = function (c) { var s = st.cards[c.code]; return !s || s.due <= Date.now(); };
  function masteredCount() {
    return deck.cartes.filter(function (c) { return levelOf(c) >= MASTER; }).length;
  }
  function grade(c, ok) {
    var now = Date.now();
    var s = st.cards[c.code] || (st.cards[c.code] = { lvl: 0, ok: 0, ko: 0, seen: 0, due: 0 });
    if (ok) {
      s.ok++;
      if (now >= s.due) {
        s.lvl = Math.min(INTERVALS.length - 1, s.lvl + 1);
        s.due = startOfDay(now) + INTERVALS[s.lvl] * DAY;
      }
    } else {
      s.ko++;
      s.lvl = Math.max(0, s.lvl - 1);
      s.due = now;
    }
    s.seen = now;
    var dk = dayKey(now), r = st.rev[dk] || (st.rev[dk] = { n: 0, ko: 0 });
    r.n++;
    if (!ok) r.ko++;
    st.days[dk] = masteredCount();
    save();
  }
  function logSession(m, n, ok, t0, extra) {
    var e = { t: Date.now(), m: m, sc: scope, n: n, ok: ok, ms: Date.now() - t0 };
    if (extra) for (var k in extra) e[k] = extra[k];
    st.sessions.push(e);
    if (st.sessions.length > 500) st.sessions.shift();
    save();
  }

  /* ---------- réponses écrites : sans accents ni ponctuation, petites fautes admises ---------- */
  function norm(s) {
    return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ").trim();
  }
  function distance(a, b) {
    var row = [], i, j;
    for (j = 0; j <= b.length; j++) row[j] = j;
    for (i = 1; i <= a.length; i++) {
      var prev = row[0];
      row[0] = i;
      for (j = 1; j <= b.length; j++) {
        var tmp = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return row[b.length];
  }
  function sameAnswer(given, c) {
    var g = norm(given), r = norm(ans(c));
    if (!g) return false;
    if (dir !== "code") return g === r;
    return distance(g, r) <= Math.floor(r.length * 0.12);
  }
  function choices(c) {
    var pool = deck.cartes.filter(function (o) { return o !== c && isPhase(o) === isPhase(c); });
    return shuffle(shuffle(pool).slice(0, 3).concat([c]));
  }

  /* ---------- petits morceaux d'interface ---------- */
  function seg(attr, opts, cur) {
    return '<div class="seg">' + opts.map(function (o) {
      return '<button type="button" data-' + attr + '="' + o.v + '"' + (o.v === cur ? ' class="on"' : "") + '>' + esc(o.t) + '</button>';
    }).join("") + '</div>';
  }
  function ruler(marks) {
    return '<div class="ruler" aria-hidden="true">' + marks.map(function (m) {
      return '<i' + (m ? ' class="' + m + '"' : "") + '></i>';
    }).join("") + '</div>';
  }
  function fmtTime(ms) {
    var s = Math.round(ms / 100) / 10;
    return s < 60 ? s.toFixed(1) + " s" : Math.floor(s / 60) + " min " + Math.round(s % 60) + " s";
  }
  function fmtDate(t) {
    return new Date(t).toLocaleDateString("fr-CH", { day: "numeric", month: "short" });
  }
  function endScreen(title, sub, missed, buttons) {
    stage.innerHTML =
      '<div class="c-end">' +
        '<p class="c-score">' + esc(title) + '</p>' +
        (sub ? '<p class="c-sub">' + esc(sub) + '</p>' : "") +
        (missed && missed.length
          ? '<h3 class="c-h">À revoir</h3><ul class="c-missed">' + missed.map(function (c) {
              return '<li><span class="c-code">' + esc(c.code) + '</span> ' + esc(c.nom) + '</li>';
            }).join("") + '</ul>'
          : "") +
        '<div class="c-actions">' + buttons.map(function (b, i) {
          return '<button type="button" class="' + (i ? "c-btn" : "c-btn c-primary") + '" data-act="' + b.act + '">' + esc(b.t) + '</button>';
        }).join("") + '</div>' +
      '</div>';
  }

  /* ---------- Cartes : recto / verso, je sais / à revoir ---------- */
  function modeCartes(list) {
    var q = list || scoped(), i = 0, marks = [], again = [], known = 0, t0 = Date.now();
    var fc = function () { return stage.querySelector(".fc"); };
    function draw() {
      if (i >= q.length) return end();
      var c = q[i], big = dir === "code";
      stage.innerHTML =
        '<div class="c-prog">' + ruler(q.map(function (_, k) { return marks[k] || (k === i ? "now" : ""); })) +
          '<span class="c-count">' + (i + 1) + " / " + q.length + '</span></div>' +
        '<div class="fc" role="button" tabindex="0" aria-label="Retourner la carte" data-act="flip"><div class="fc-in">' +
          '<div class="fc-f"><p class="fc-t' + (big ? " fc-big" : "") + '">' + esc(ask(c)) + '</p></div>' +
          '<div class="fc-f fc-b"><p class="fc-t' + (big ? "" : " fc-big") + '">' + esc(ans(c)) + '</p>' +
            '<p class="fc-ctx">' + esc(context(c)) + '</p></div>' +
        '</div></div>' +
        '<div class="c-actions c-split">' +
          '<button type="button" class="c-btn" data-act="mark" data-v="0">✗ À revoir</button>' +
          '<button type="button" class="c-btn" data-act="mix">Mélanger</button>' +
          '<button type="button" class="c-btn" data-act="mark" data-v="1">✓ Je sais</button>' +
        '</div>' +
        '<p class="c-hint">Espace : retourner · ← à revoir · → je sais</p>';
    }
    function mark(ok) {
      var c = q[i];
      grade(c, ok);
      marks[i] = ok ? "ok" : "ko";
      if (ok) known++; else again.push(c);
      i++;
      draw();
    }
    function end() {
      logSession("cartes", q.length, known, t0);
      acts.again = function () { modeCartes(again); };
      acts.restart = function () { modeCartes(); };
      endScreen(known + " / " + q.length + " sues", null, again,
        again.length ? [{ act: "again", t: "Revoir les " + again.length + " à revoir" }, { act: "restart", t: "Tout recommencer" }]
                     : [{ act: "restart", t: "Recommencer" }]);
    }
    acts = {
      flip: function () { var f = fc(); if (f) f.classList.toggle("flipped"); },
      mark: function (v) { mark(v === "1"); },
      mix: function () { q = shuffle(q); i = 0; marks = []; again = []; known = 0; t0 = Date.now(); draw(); }
    };
    onKey = function (e) {
      if (i >= q.length) return;
      if (e.key === " ") { e.preventDefault(); acts.flip(); }
      else if (e.key === "ArrowLeft") mark(false);
      else if (e.key === "ArrowRight") mark(true);
    };
    draw();
  }

  /* ---------- Apprendre : QCM puis réponse écrite, les erreurs reviennent ---------- */
  function modeApprendre() {
    var pool = scoped();
    var pick = shuffle(pool).sort(function (a, b) {
      return (isDue(b) - isDue(a)) || (levelOf(a) - levelOf(b));
    }).slice(0, ROUND);
    var items = pick.map(function (c) { return { c: c, stage: 0, missed: false }; });
    var queue = items.slice(), cur = null, locked = false, t0 = Date.now();
    var run = runId;

    function prog() {
      var marks = [];
      items.forEach(function (it) { marks.push(it.stage > 0 ? "ok" : ""); marks.push(it.stage > 1 ? "ok" : ""); });
      var done = marks.filter(Boolean).length;
      return '<div class="c-prog">' + ruler(marks) + '<span class="c-count">' + done + " / " + marks.length + '</span></div>';
    }
    function next() {
      if (!queue.length) return end();
      cur = queue.shift(); locked = false;
      if (cur.stage === 0) drawMcq(); else drawWritten();
    }
    function question() {
      return '<p class="c-q' + (dir === "code" ? " c-q-code" : "") + '">' + esc(ask(cur.c)) + '</p>';
    }
    function drawMcq() {
      var opts = choices(cur.c);
      stage.innerHTML = prog() + '<div class="c-panel">' + question() +
        '<p class="c-q-label">Choisis la bonne réponse</p>' +
        '<div class="c-choices">' + opts.map(function (o, k) {
          return '<button type="button" class="c-choice" data-act="choose" data-v="' + o.code + '"><span class="c-key">' + (k + 1) + '</span><span>' + esc(ans(o)) + '</span></button>';
        }).join("") + '</div>' + DUNNO + '<div id="cFb" class="c-fb" aria-live="polite"></div></div>';
    }
    function drawWritten() {
      stage.innerHTML = prog() + '<div class="c-panel">' + question() +
        '<p class="c-q-label">Écris la bonne réponse</p>' +
        '<form class="c-write" id="cWrite">' +
          '<input id="cInput" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"' +
            (dir === "code" ? "" : ' inputmode="decimal"') + ' placeholder="' + (dir === "code" ? "Écris l'intitulé" : "Écris le numéro") + '" aria-label="Ta réponse">' +
          '<button type="submit" class="c-btn c-primary">Valider</button>' +
        '</form>' + DUNNO + '<div id="cFb" class="c-fb" aria-live="polite"></div></div>';
      var inp = document.getElementById("cInput");
      inp.focus();
      document.getElementById("cWrite").addEventListener("submit", function (e) {
        e.preventDefault();
        if (locked || !inp.value.trim()) return;
        inp.readOnly = true;
        answered(sameAnswer(inp.value, cur.c), true);
      });
    }
    function answered(ok, written) {
      locked = true;
      var fb = document.getElementById("cFb"), dunno = stage.querySelector(".c-dunno");
      if (dunno) dunno.remove();
      if (ok) {
        fb.innerHTML = '<p class="c-right">✓ Juste</p>';
        setTimeout(function () { if (run === runId) apply(true); }, 650);
      } else {
        fb.innerHTML = '<p class="c-wrong">✗ Réponse : <b>' + esc(ans(cur.c)) + '</b></p>' +
          '<div class="c-actions"><button type="button" id="cGo" class="c-btn c-primary" data-act="go">Continuer</button>' +
          (written ? '<button type="button" class="c-btn" data-act="override">J\'avais juste</button>' : "") + '</div>';
        document.getElementById("cGo").focus();
      }
    }
    function showRight() {
      [].forEach.call(stage.querySelectorAll(".c-choice"), function (b) {
        if (b.dataset.v === cur.c.code) b.classList.add("ok");
      });
    }
    function apply(ok) {
      if (ok) {
        cur.stage++;
        if (cur.stage >= 2) { if (!cur.missed) grade(cur.c, true); }
        else queue.push(cur);
      } else {
        if (!cur.missed) { cur.missed = true; grade(cur.c, false); }
        queue.splice(Math.min(2, queue.length), 0, cur);
      }
      next();
    }
    function end() {
      var clean = items.filter(function (it) { return !it.missed; }).length;
      logSession("apprendre", items.length, clean, t0);
      acts.restart = function () { modeApprendre(); };
      var dueLeft = pool.filter(isDue).length;
      endScreen(clean + " / " + items.length + " du premier coup",
        dueLeft ? dueLeft + " carte" + (dueLeft > 1 ? "s" : "") + " à voir encore aujourd'hui." : "Plus rien à voir aujourd'hui dans cette sélection.",
        items.filter(function (it) { return it.missed; }).map(function (it) { return it.c; }),
        [{ act: "restart", t: "Série suivante" }]);
    }
    acts = {
      choose: function (code, btn) {
        if (locked) return;
        var ok = code === cur.c.code;
        btn.classList.add(ok ? "ok" : "ko");
        if (!ok) showRight();
        answered(ok, false);
      },
      dunno: function () {
        if (locked) return;
        showRight();
        var inp = document.getElementById("cInput");
        if (inp) inp.readOnly = true;
        answered(false, false);
      },
      go: function () { apply(false); },
      override: function () { apply(true); }
    };
    onKey = function (e) {
      var n = parseInt(e.key, 10);
      if (locked || !cur || cur.stage !== 0 || !(n >= 1 && n <= 4)) return;
      var b = stage.querySelectorAll(".c-choice")[n - 1];
      if (b) b.click();
    };
    next();
  }

  /* ---------- Test : vrai/faux, QCM et écrit sur une page, corrigé à la fin ---------- */
  function modeTest() {
    var kinds = ["vf", "qcm", "ecrit"], t0 = Date.now();
    var qs = shuffle(scoped()).map(function (c, i) {
      var k = kinds[i % 3], q = { c: c, k: k };
      if (k === "vf") {
        q.vrai = Math.random() < 0.5;
        q.shown = q.vrai ? c : shuffle(deck.cartes.filter(function (o) { return o !== c && isPhase(o) === isPhase(c); }))[0];
      }
      if (k === "qcm") q.opts = choices(c);
      return q;
    });
    function label(q) {
      if (q.k === "vf") return esc(q.c.code) + ' correspond à « ' + esc(q.shown.nom) + ' »';
      return (dir === "code" ? "Intitulé de " : "Numéro de ") + '<b>' + esc(ask(q.c)) + '</b>';
    }
    function radio(i, v, t, k) {
      return '<label class="c-choice"><input type="radio" name="q' + i + '" value="' + esc(v) + '"><span class="c-key">' + k + '</span><span>' + esc(t) + '</span></label>';
    }
    var hint = { vf: "Vrai ou faux ?", qcm: "Choisis la bonne réponse", ecrit: "Écris la bonne réponse" };
    stage.innerHTML =
      '<form id="cTest" class="c-test">' + qs.map(function (q, i) {
        return '<div class="c-panel c-tq" role="group"><div class="c-tq-head"><p class="c-q">' + label(q) + '</p><span class="c-count">' + (i + 1) + " / " + qs.length + '</span></div>' +
          '<p class="c-q-label">' + hint[q.k] + '</p>' +
          (q.k === "vf" ? '<div class="c-choices">' + radio(i, "1", "Vrai", 1) + radio(i, "0", "Faux", 2) + '</div>' : "") +
          (q.k === "qcm" ? '<div class="c-choices">' + q.opts.map(function (o, k) { return radio(i, o.code, ans(o), k + 1); }).join("") + '</div>' : "") +
          (q.k === "ecrit" ? '<input type="text" name="q' + i + '" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Ta réponse">' : "") +
          '<p class="c-corr" hidden></p></div>';
      }).join("") +
      '<div class="c-actions"><button type="submit" class="c-btn c-primary">Corriger</button></div></form>';
    var form = document.getElementById("cTest");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var score = 0, sets = form.querySelectorAll(".c-tq");
      qs.forEach(function (q, i) {
        var f = form.elements["q" + i], v = f ? f.value : "", ok;
        if (q.k === "vf") ok = v !== "" && (v === "1") === q.vrai;
        else if (q.k === "qcm") ok = v === q.c.code;
        else ok = sameAnswer(v, q.c);
        if (ok) score++;
        grade(q.c, ok);
        var right = q.k === "vf" ? (q.vrai ? "1" : "0") : q.c.code;
        [].forEach.call(sets[i].querySelectorAll(".c-choice"), function (l) {
          var r = l.querySelector("input");
          if (r.value === right) l.classList.add("ok");
          else if (r.checked) l.classList.add("ko");
        });
        var p = sets[i].querySelector(".c-corr");
        p.hidden = false;
        p.className = "c-corr " + (ok ? "c-right" : "c-wrong");
        p.innerHTML = ok ? "✓ Juste" : "✗ " + esc(q.c.code) + " : <b>" + esc(q.c.nom) + "</b>";
      });
      [].forEach.call(form.querySelectorAll("input"), function (n) { n.disabled = true; });
      logSession("test", qs.length, score, t0);
      var bar = form.querySelector(".c-actions");
      bar.innerHTML = '<button type="button" class="c-btn c-primary" data-act="restart">Nouveau test</button>';
      form.insertAdjacentHTML("afterbegin",
        '<p class="c-score">' + score + " / " + qs.length + '</p><p class="c-sub">' + Math.round(score / qs.length * 100) + " % · " + fmtTime(Date.now() - t0) + '</p>');
      root.scrollTop = 0;
    });
    acts = { restart: function () { modeTest(); } };
  }

  /* ---------- Associer : relier numéros et intitulés le plus vite possible ---------- */
  function modeAssocier() {
    var pairs = shuffle(scoped()).slice(0, PAIRS), left = pairs.length, errors = 0, sel = null, busy = false, t0 = Date.now();
    var tiles = shuffle(pairs.map(function (c) { return { c: c, t: c.code, code: true }; })
      .concat(pairs.map(function (c) { return { c: c, t: c.nom, code: false }; })));
    stage.innerHTML =
      '<div class="c-prog c-match-head"><span class="c-timer" id="cTimer">0.0 s</span><span class="c-count" id="cErr">0 erreur</span></div>' +
      '<div class="c-match">' + tiles.map(function (t, i) {
        return '<button type="button" class="c-tile' + (t.code ? " c-tile-code" : "") + '" data-act="tile" data-v="' + i + '">' + esc(t.t) + '</button>';
      }).join("") + '</div>';
    var clock = document.getElementById("cTimer");
    timer = setInterval(function () {
      if (!clock.isConnected) { clearInterval(timer); return; }
      clock.textContent = fmtTime(Date.now() - t0);
    }, 100);
    acts = {
      tile: function (v, btn) {
        if (busy) return;
        if (btn === sel) { btn.classList.remove("sel"); sel = null; return; }
        if (!sel) { sel = btn; btn.classList.add("sel"); return; }
        var a = tiles[+sel.dataset.v], b = tiles[+v], first = sel;
        sel = null;
        first.classList.remove("sel");
        if (a.c === b.c && a.code !== b.code) {
          first.classList.add("gone"); btn.classList.add("gone");
          first.disabled = btn.disabled = true;
          if (--left === 0) end();
        } else {
          errors++;
          document.getElementById("cErr").textContent = errors + (errors > 1 ? " erreurs" : " erreur");
          first.classList.add("ko"); btn.classList.add("ko");
          busy = true;
          setTimeout(function () { first.classList.remove("ko"); btn.classList.remove("ko"); busy = false; }, 500);
        }
      }
    };
    function end() {
      clearInterval(timer);
      var ms = Date.now() - t0;
      var prev = st.sessions.filter(function (s) { return s.m === "associer" && s.sc === scope; })
        .reduce(function (m, s) { return Math.min(m, s.ms); }, Infinity);
      logSession("associer", pairs.length, Math.max(0, pairs.length - errors), t0, { err: errors });
      acts.restart = function () { modeAssocier(); };
      endScreen(fmtTime(ms),
        (errors ? errors + (errors > 1 ? " erreurs" : " erreur") : "Sans erreur") +
          (prev === Infinity ? "" : ms < prev ? " · nouveau record" : " · record : " + fmtTime(prev)),
        null, [{ act: "restart", t: "Rejouer" }]);
    }
  }

  /* ---------- Ordre : remettre les phases dans la chronologie ---------- */
  function modeOrdre() {
    var want = scoped(), pos = 0, errors = 0, busy = false, t0 = Date.now();
    var pile = shuffle(want);
    function draw() {
      stage.innerHTML =
        '<p class="c-q-label">Touche ce qui vient ensuite, du début du projet à l\'exploitation.</p>' +
        '<div class="c-prog">' + ruler(want.map(function (_, k) { return k < pos ? "ok" : k === pos ? "now" : ""; })) +
          '<span class="c-count">' + errors + (errors > 1 ? " erreurs" : " erreur") + '</span></div>' +
        '<div class="c-order">' +
          '<ol class="c-order-done">' + want.slice(0, pos).map(function (c) {
            return '<li><span class="c-code">' + esc(c.code) + '</span> ' + esc(c.nom) + '</li>';
          }).join("") + '</ol>' +
          '<div class="c-order-pile">' + pile.map(function (c) {
            return '<button type="button" class="c-opt" data-act="place" data-v="' + c.code + '">' + esc(c.nom) + '</button>';
          }).join("") + '</div>' +
        '</div>';
    }
    acts = {
      place: function (code, btn) {
        if (busy) return;
        if (code === want[pos].code) {
          pile = pile.filter(function (c) { return c.code !== code; });
          pos++;
          if (pos >= want.length) return end();
          draw();
        } else {
          errors++;
          btn.classList.add("ko");
          busy = true;
          var run = runId;
          setTimeout(function () { if (run === runId) { busy = false; draw(); } }, 450);
        }
      }
    };
    function end() {
      logSession("ordre", want.length, Math.max(0, want.length - errors), t0, { err: errors });
      acts.restart = function () { modeOrdre(); };
      endScreen(errors ? errors + (errors > 1 ? " erreurs" : " erreur") : "Sans erreur", fmtTime(Date.now() - t0),
        null, [{ act: "restart", t: "Recommencer" }]);
    }
    draw();
  }

  /* ---------- Évolution ---------- */
  function lineChart(id, title, pts, unit) {
    return '<figure class="c-chart" id="' + id + '"><figcaption>' + esc(title) + '</figcaption>' +
      (pts.length < 2
        ? '<p class="c-sub">La courbe apparaîtra ' + (unit === "%" ? "après le deuxième test." : "dès le deuxième jour de révision.") + '</p>'
        : '<div class="c-plot"></div><div class="c-tip" hidden></div>') +
      '</figure>';
  }
  function drawChart(id, pts, yMax, xs) {
    var fig = document.getElementById(id), box = fig && fig.querySelector(".c-plot");
    if (!box) return;
    var W = Math.max(280, box.clientWidth), H = 170, L = 28, R = 30, T = 16, B = 22;
    var x0 = xs[0], x1 = xs[xs.length - 1];
    var px = function (i) { return L + (xs[i] - x0) / (x1 - x0) * (W - L - R); };
    var py = function (v) { return T + (1 - v / yMax) * (H - T - B); };
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + px(i).toFixed(1) + " " + py(p.y).toFixed(1); }).join("");
    var last = pts.length - 1;
    var area = d + "L" + px(last).toFixed(1) + " " + py(0) + "L" + px(0).toFixed(1) + " " + py(0) + "Z";
    box.innerHTML =
      '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc((fig.querySelector("figcaption") || fig.querySelector(".c-pt-s")).textContent) + '">' +
        '<line class="c-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + py(yMax) + '" y2="' + py(yMax) + '"/>' +
        '<line class="c-base" x1="' + L + '" x2="' + (W - R) + '" y1="' + py(0) + '" y2="' + py(0) + '"/>' +
        '<text class="c-ax" x="' + (L - 7) + '" y="' + (py(yMax) + 3) + '" text-anchor="end">' + yMax + '</text>' +
        '<text class="c-ax" x="' + (L - 7) + '" y="' + (py(0) + 3) + '" text-anchor="end">0</text>' +
        '<text class="c-ax" x="' + L + '" y="' + (H - 5) + '">' + esc(pts[0].x) + '</text>' +
        '<text class="c-ax" x="' + (W - R) + '" y="' + (H - 5) + '" text-anchor="end">' + esc(pts[last].x) + '</text>' +
        '<defs><linearGradient id="' + id + 'G" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a84ff" stop-opacity=".45"/><stop offset="1" stop-color="#0a84ff" stop-opacity="0"/></linearGradient></defs>' +
        '<path d="' + area + '" fill="url(#' + id + 'G)"/>' +
        '<path class="c-line" d="' + d + '"/>' +
        pts.map(function (p, i) {
          return (pts.length <= 12 || i === last) ? '<circle class="c-dot" cx="' + px(i).toFixed(1) + '" cy="' + py(p.y).toFixed(1) + '" r="4"/>' : "";
        }).join("") +
        '<text class="c-val" x="' + (px(last) + 9) + '" y="' + (py(pts[last].y) + 4) + '">' + pts[last].y + '</text>' +
        '<circle class="c-hover" r="5" style="display:none"/>' +
      '</svg>';
    var svg = box.querySelector("svg"), tip = fig.querySelector(".c-tip"), mark = svg.querySelector(".c-hover");
    svg.addEventListener("pointermove", function (e) {
      var r = svg.getBoundingClientRect(), mx = e.clientX - r.left, best = 0;
      pts.forEach(function (_, i) { if (Math.abs(px(i) - mx) < Math.abs(px(best) - mx)) best = i; });
      mark.setAttribute("cx", px(best)); mark.setAttribute("cy", py(pts[best].y));
      mark.style.display = "";
      tip.hidden = false;
      tip.textContent = pts[best].tip;
      tip.style.left = Math.min(W - tip.offsetWidth, Math.max(0, px(best) - tip.offsetWidth / 2)) + "px";
      tip.style.top = (svg.offsetTop + py(pts[best].y) - tip.offsetHeight - 10) + "px";
    });
    svg.addEventListener("pointerleave", function () { tip.hidden = true; mark.style.display = "none"; });
  }
  var MODE_NAMES = { cartes: "Cartes", apprendre: "Apprendre", test: "Test", associer: "Associer", ordre: "Ordre" };
  var SCOPE_NAMES = { all: "Tout", phases: "Phases", subs: "Sous-phases" };

  function modeEvolution() {
    var total = deck.cartes.length;
    var due = deck.cartes.filter(function (c) { return st.cards[c.code] && isDue(c); }).length;
    var fresh = deck.cartes.filter(function (c) { return !st.cards[c.code]; }).length;
    var ms = st.sessions.reduce(function (n, s) { return n + s.ms; }, 0);
    var dayKeys = Object.keys(st.days).sort();
    var dayPts = dayKeys.map(function (k) {
      var t = new Date(k + "T12:00:00").getTime();
      return { x: fmtDate(t), y: st.days[k], t: t, tip: fmtDate(t) + " : " + st.days[k] + " / " + total + " maîtrisées" };
    });
    var tests = st.sessions.filter(function (s) { return s.m === "test"; });
    var testPts = tests.map(function (s) {
      var pct = Math.round(s.ok / s.n * 100);
      return { x: fmtDate(s.t), y: pct, tip: fmtDate(s.t) + " · " + SCOPE_NAMES[s.sc] + " : " + s.ok + " / " + s.n + " (" + pct + " %)" };
    });
    function state(c) {
      var s = st.cards[c.code];
      if (!s) return "Nouvelle";
      return (s.lvl >= MASTER ? "Maîtrisée" : "En cours") + (isDue(c) ? " · à revoir" : "");
    }
    var today = Date.now(), todayKey = dayKey(today), rt = st.rev[todayKey] || { n: 0, ko: 0 };
    var revKeys = Object.keys(st.rev).sort();
    var totalRev = revKeys.reduce(function (n, k) { return n + st.rev[k].n; }, 0);
    var prevDay = function (k) { return dayKey(new Date(k + "T12:00:00").getTime() - DAY); };
    var cur = 0, best = 0, run = 0, before = null;
    for (var k = st.rev[todayKey] ? todayKey : prevDay(todayKey); st.rev[k]; k = prevDay(k)) cur++;
    revKeys.forEach(function (key) {
      run = before && prevDay(key) === before ? run + 1 : 1;
      best = Math.max(best, run);
      before = key;
    });
    var month = [], m30 = 0;
    for (var i = 29; i >= 0; i--) {
      var mt = today - i * DAY, mr = st.rev[dayKey(mt)];
      if (mr) m30++;
      month.push({ x: fmtDate(mt), y: mr ? mr.n : 0, tip: fmtDate(mt) + " : " + (mr ? mr.n : 0) + " cartes" });
    }
    var monthTotal = month.reduce(function (n, p) { return n + p.y; }, 0);
    var monthMax = Math.max(5, Math.max.apply(null, month.map(function (p) { return p.y; })));
    var graded = st.sessions.filter(function (s) { return (s.m === "cartes" || s.m === "apprendre" || s.m === "test") && s.t > today - 7 * DAY; });
    var gN = graded.reduce(function (n, s) { return n + s.n; }, 0), gMs = graded.reduce(function (n, s) { return n + s.ms; }, 0);
    var mastered = masteredCount(), pct = Math.round(mastered / total * 100);
    var learning = deck.cartes.filter(function (c) { return st.cards[c.code] && levelOf(c) < MASTER; }).length;
    var R = 84, C = 2 * Math.PI * R;
    var msg = pct === 100 ? "Tout est maîtrisé" : pct >= 70 ? "Presque !" : pct > 0 ? "Ça avance" : "La maîtrise vient avec les jours";
    var ICONS = {
      flame: '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .3 1.5 1 2 2 2 0-3-.5-5 1-8z"/>',
      cards: '<rect x="5" y="8" width="14" height="12" rx="2"/><path d="M8 4h8"/>',
      again: '<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4"/>',
      clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
      bars: '<path d="M6 20v-6M12 20V6M18 20V10"/>',
      stack: '<path d="M4 9h16v11H4zM6 5h12M10 14h4"/>',
      cup: '<path d="M8 4h8v6a4 4 0 0 1-8 0zM12 14v4M8 20h8"/>'
    };
    var statRow = function (ic, col, val, lab) {
      return '<li><svg class="c-ic" style="color:' + col + '" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[ic] + '</svg><div><b>' + esc(val) + '</b><span>' + esc(lab) + '</span></div></li>';
    };
    // activité : 16 semaines, du lundi au dimanche
    var WEEKS = 16, d0 = new Date(today);
    d0.setHours(12, 0, 0, 0);
    d0 = new Date(d0.getTime() - (((d0.getDay() + 6) % 7) + (WEEKS - 1) * 7) * DAY);
    var cells = "";
    for (var c = 0; c < WEEKS * 7; c++) {
      var ct = d0.getTime() + c * DAY, ck = dayKey(ct), cr = st.rev[ck], cn = cr ? cr.n : 0;
      var lv = cn === 0 ? 0 : cn < 10 ? 1 : cn < 25 ? 2 : cn < 50 ? 3 : 4;
      cells += ct > today + DAY / 2 ? '<i class="fut"></i>' : '<i class="l' + lv + '" title="' + esc(fmtDate(ct)) + " : " + cn + ' cartes"></i>';
    }
    stage.innerHTML =
      '<section class="c-panel c-ring-box">' +
        '<svg class="c-ring" viewBox="0 0 200 200" role="img" aria-label="' + pct + ' % des cartes maîtrisées">' +
          '<circle class="c-ring-t" cx="100" cy="100" r="' + R + '"/>' +
          '<circle class="c-ring-v" cx="100" cy="100" r="' + R + '" stroke-dasharray="' + (C * pct / 100).toFixed(1) + " " + C.toFixed(1) + '" transform="rotate(-90 100 100)"/>' +
          '<text class="c-ring-n" x="100" y="108" text-anchor="middle">' + pct + '%</text>' +
          '<text class="c-ring-l" x="100" y="130" text-anchor="middle">maîtrisées</text>' +
        '</svg>' +
        '<p class="c-ring-msg">' + esc(msg) + '</p>' +
      '</section>' +
      '<section class="c-panel"><h3 class="c-pt">Aujourd\'hui</h3><dl class="c-stats">' +
        '<div><dt>Revues</dt><dd>' + rt.n + '</dd></div>' +
        '<div><dt>Nouvelles</dt><dd class="c-new">' + fresh + '</dd></div>' +
        '<div><dt>En cours</dt><dd class="c-lrn">' + learning + '</dd></div>' +
        '<div><dt>À revoir</dt><dd class="c-due">' + due + '</dd></div>' +
        '<div><dt>Total</dt><dd>' + total + '</dd></div>' +
      '</dl></section>' +
      '<section class="c-panel c-heat-box">' +
        '<div class="c-heat-days" aria-hidden="true"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>' +
        '<div class="c-heat" role="img" aria-label="Activité des 16 dernières semaines : ' + totalRev + ' cartes revues au total">' + cells + '</div>' +
        '<div class="c-heat-side"><b>' + rt.n + '</b><span>cartes revues aujourd\'hui</span><em>Série : ' + cur + ' j</em></div>' +
      '</section>' +
      '<section class="c-panel c-chart" id="cChart0"><p class="c-pt-s">30 derniers jours</p><p class="c-big">' + monthTotal + ' <small>cartes</small></p><div class="c-plot"></div><div class="c-tip" hidden></div></section>' +
      '<section class="c-panel">' + lineChart("cChart1", "Cartes maîtrisées", dayPts, "cartes") + '</section>' +
      '<section class="c-panel">' + lineChart("cChart2", "Score aux tests, en %", testPts, "%") + '</section>' +
      '<h3 class="c-h">Stats</h3>' +
      '<ul class="c-panel c-statlist">' +
        statRow("flame", "#ff9f0a", cur + (cur > 1 ? " jours" : " jour"), "Série en cours") +
        statRow("cards", "#0a84ff", rt.n + " cartes", "Revues aujourd'hui") +
        statRow("again", "#30d158", rt.n ? Math.round(rt.ko / rt.n * 100) + " %" : "—", "Taux d'erreur du jour") +
        statRow("clock", "#bf5af2", gN ? (gMs / gN / 1000).toFixed(1) + " s / carte" : "—", "Vitesse sur 7 jours") +
        statRow("bars", "#30d158", Math.round(m30 / 30 * 100) + " %", "Régularité sur 30 jours") +
        statRow("stack", "#98989f", totalRev + " cartes", "Total des révisions") +
        statRow("cup", "#ffd60a", best + (best > 1 ? " jours" : " jour"), "Meilleure série") +
        statRow("clock", "#64d2ff", Math.round(ms / 60000) + " min", "Temps total") +
      '</ul>' +
      '<h3 class="c-h">Carte par carte</h3>' +
      '<table class="c-table"><thead><tr><th>N°</th><th>Intitulé</th><th>État</th><th class="c-num">Juste</th><th class="c-num">Faux</th></tr></thead><tbody>' +
        deck.cartes.map(function (c) {
          var s = st.cards[c.code] || { lvl: 0, ok: 0, ko: 0 };
          return '<tr' + (isPhase(c) ? ' class="c-row-phase"' : "") + '><td class="c-code">' + esc(c.code) + '</td><td>' + esc(c.nom) + '</td>' +
            '<td class="c-state"><span class="c-lvl" aria-hidden="true">' + [1, 2, 3, 4].map(function (n) { return '<i' + (s.lvl >= n ? ' class="on"' : "") + '></i>'; }).join("") + '</span>' + esc(state(c)) + '</td>' +
            '<td class="c-num">' + s.ok + '</td><td class="c-num">' + s.ko + '</td></tr>';
        }).join("") +
      '</tbody></table>' +
      '<h3 class="c-h">Dernières sessions</h3>' +
      (st.sessions.length
        ? '<table class="c-table"><thead><tr><th>Date</th><th>Mode</th><th>Sélection</th><th class="c-num">Score</th><th class="c-num">Durée</th></tr></thead><tbody>' +
            st.sessions.slice(-12).reverse().map(function (s) {
              return '<tr><td>' + esc(fmtDate(s.t)) + '</td><td>' + esc(MODE_NAMES[s.m] || s.m) + '</td><td>' + esc(SCOPE_NAMES[s.sc] || "") + '</td>' +
                '<td class="c-num">' + s.ok + " / " + s.n + '</td><td class="c-num">' + esc(fmtTime(s.ms)) + '</td></tr>';
            }).join("") + '</tbody></table>'
        : '<p class="c-sub">Aucune session pour l\'instant.</p>') +
      '<div class="c-actions c-backup">' +
        '<button type="button" class="c-btn" data-act="exp">Exporter</button>' +
        '<button type="button" class="c-btn" data-act="imp">Importer</button>' +
        '<input type="file" id="cFile" accept="application/json,.json" hidden>' +
      '</div>' +
      '<p class="c-sub" id="cBackupMsg">La progression reste dans ce navigateur. Exporter puis importer permet de la passer sur un autre appareil.</p>';
    drawChart("cChart0", month, monthMax, month.map(function (_, i) { return i; }));
    drawChart("cChart1", dayPts, total, dayPts.map(function (p) { return p.t; }));
    drawChart("cChart2", testPts, 100, testPts.map(function (_, i) { return i; }));

    var file = document.getElementById("cFile");
    file.addEventListener("change", function () {
      if (!file.files[0]) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          merge(JSON.parse(fr.result));
          save();
          modeEvolution();
        } catch (_) {
          document.getElementById("cBackupMsg").textContent = "Ce fichier n'est pas une sauvegarde valable.";
        }
      };
      fr.readAsText(file.files[0]);
    });
    acts = {
      exp: function () {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([JSON.stringify(st)], { type: "application/json" }));
        a.download = "yeni-" + deck.id + "-thomas-" + dayKey(Date.now()) + ".json";
        a.click();
        URL.revokeObjectURL(a.href);
      },
      imp: function () { file.click(); }
    };
  }
  // fusion : pour chaque carte le relevé le plus récent, les sessions et les jours des deux côtés
  function merge(o) {
    if (!o || typeof o.cards !== "object" || !Array.isArray(o.sessions)) throw new Error("format");
    Object.keys(o.cards).forEach(function (k) {
      var a = st.cards[k], b = o.cards[k];
      if (!a || (b.seen || 0) > (a.seen || 0)) st.cards[k] = b;
    });
    var seen = {};
    st.sessions.forEach(function (s) { seen[s.t] = 1; });
    st.sessions = st.sessions.concat(o.sessions.filter(function (s) { return !seen[s.t]; }))
      .sort(function (a, b) { return a.t - b.t; });
    Object.keys(o.days || {}).forEach(function (k) {
      st.days[k] = Math.max(st.days[k] || 0, o.days[k]);
    });
    Object.keys(o.rev || {}).forEach(function (k) {
      if (!st.rev[k] || o.rev[k].n > st.rev[k].n) st.rev[k] = o.rev[k];
    });
  }

  /* ---------- coque : session, mode, sélection ---------- */
  function bindClicks() {
    wrap.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act],[data-cwho],[data-cmode],[data-cscope],[data-cdir]");
      if (!b) return;
      var d = b.dataset;
      if (d.act) { if (acts[d.act]) acts[d.act](d.v, b); return; }
      if (d.cwho) { if (d.cwho !== who) setWho(d.cwho); shell(); }
      else if (d.cmode) { mode = d.cmode; shell(); }
      else if (d.cscope) { scope = d.cscope; shell(); }
      else if (d.cdir) { dir = d.cdir; shell(); }
    });
  }
  function setWho(w) {
    who = w;
    try { sessionStorage.setItem(WHO_KEY, w); } catch (_) {}
    st = loadState();
    if (who !== "thomas" && mode === "evolution") mode = "cartes";
  }
  function shell() {
    runId++;
    clearInterval(timer);
    onKey = null; acts = {};
    var count = function (f) { return deck.cartes.filter(f).length; };
    var modes = MODES.filter(function (m) { return who === "thomas" || m.v !== "evolution"; });
    var showScope = mode !== "evolution", showDir = mode === "cartes" || mode === "apprendre" || mode === "test";
    root.className = "revise cartes";
    root.innerHTML =
      '<div class="c-wrap" id="cWrap">' +
        '<div class="revise-bar c-top">' +
          '<button class="revise-back" data-home="1" type="button">‹ Révisions</button>' +
          seg("cwho", [{ v: "thomas", t: "Thomas" }, { v: "invite", t: "Invité" }], who) +
        '</div>' +
        '<h1 class="c-title">' + esc(deck.titre) + '</h1>' +
        '<nav class="c-tabs" aria-label="Modes">' + modes.map(function (m) {
          return '<button type="button" data-cmode="' + m.v + '"' + (m.v === mode ? ' class="on"' : "") + '>' + esc(m.t) + '</button>';
        }).join("") + '</nav>' +
        (showScope
          ? '<div class="revise-bar c-sel">' +
              seg("cscope", [
                { v: "all", t: "Tout (" + deck.cartes.length + ")" },
                { v: "phases", t: "Phases (" + count(isPhase) + ")" },
                { v: "subs", t: "Sous-phases (" + count(function (c) { return !isPhase(c); }) + ")" }
              ], scope) +
              (showDir ? seg("cdir", [{ v: "code", t: "Numéro → intitulé" }, { v: "nom", t: "Intitulé → numéro" }], dir) : "") +
            '</div>'
          : "") +
        '<div class="c-stage" id="cStage"></div>' +
        (who === "invite"
          ? '<p class="c-note">Session invité : rien n\'est enregistré.</p>'
          : storageOk ? "" : '<p class="c-note">Ce navigateur ne garde pas la progression.</p>') +
      '</div>';
    wrap = document.getElementById("cWrap");
    stage = document.getElementById("cStage");
    bindClicks();
    ({ cartes: modeCartes, apprendre: modeApprendre, test: modeTest, associer: modeAssocier, ordre: modeOrdre, evolution: modeEvolution })[mode]();
  }
  function pickWho() {
    root.className = "revise revise-home";
    root.innerHTML =
      '<div class="revise-pick" id="cWrap">' +
        '<p class="pick-kicker">' + esc(deck.titre) + '</p>' +
        '<section class="pick-sec"><h2>Qui révise ?</h2>' +
          '<div class="pick-grid">' +
            '<button class="pick-item" type="button" data-cwho="thomas">Thomas</button>' +
            '<button class="pick-item" type="button" data-cwho="invite">Invité</button>' +
          '</div>' +
          '<p class="pick-sub c-pick-note">Thomas garde sa progression. Invité n\'enregistre rien.</p>' +
        '</section>' +
        '<button class="revise-back c-pick-back" data-home="1" type="button">‹ Révisions</button>' +
      '</div>';
    wrap = document.getElementById("cWrap");
    bindClicks();
  }

  document.addEventListener("keydown", function (e) {
    if (!onKey || !wrap || !wrap.isConnected) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target.tagName;
    if (t === "INPUT" || t === "TEXTAREA" || (t === "BUTTON" && (e.key === " " || e.key === "Enter"))) return;
    onKey(e);
  });

  function open(el, id) {
    root = el;
    document.body.classList.add("c-dark");
    root.className = "revise revise-home";
    root.innerHTML = '<p class="muted">Chargement…</p>';
    fetch("assets/data/" + id + ".json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        deck = d;
        var saved = null;
        try { saved = sessionStorage.getItem(WHO_KEY); } catch (_) {}
        if (saved === "thomas" || saved === "invite") { setWho(saved); shell(); }
        else pickWho();
      })
      .catch(function (err) {
        root.innerHTML = '<p class="muted">Impossible de charger les cartes : ' + esc(err.message) + '</p>';
      });
  }
  return { open: open };
})();
