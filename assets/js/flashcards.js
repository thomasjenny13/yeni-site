/* ============================================================
   yéni.ch — cartes de mémorisation (répétition espacée)
   Manifeste : assets/data/flashcards/decks.json  (en clair)
   Paquets   : *.json.enc  (chiffrés)  — voir docs/FORMAT.md
   Progression : localStorage (par appareil, non sensible)
   ============================================================ */

(function () {
  if (!YeniCrypto.requireUnlock()) return;

  document.getElementById("lockBtn").addEventListener("click", () => {
    YeniCrypto.lock();
    location.href = "index.html";
  });

  const MANIFEST = "assets/data/flashcards/decks.json";
  // Leitner : intervalle (en jours) avant re-révision selon la « boîte »
  const INTERVALS = [0, 1, 3, 7, 16, 40];
  const DAY = 86400000;

  const $ = (id) => document.getElementById(id);
  const deckView = $("deckView"), studyView = $("studyView");
  const deckList = $("deckList"), deckStatus = $("deckStatus");

  /* ---------- progression ---------- */
  const progKey = (deckId) => "yeni.fc." + deckId;
  function loadProg(deckId) {
    try { return JSON.parse(localStorage.getItem(progKey(deckId))) || {}; }
    catch (_) { return {}; }
  }
  function saveProg(deckId, prog) {
    try { localStorage.setItem(progKey(deckId), JSON.stringify(prog)); } catch (_) {}
  }
  function cardKey(card, i) {
    return card.id || String(i) + "|" + (card.recto || "").slice(0, 40);
  }
  function dueCount(deck, prog) {
    const now = Date.now();
    return deck.cartes.reduce((n, c, i) => {
      const s = prog[cardKey(c, i)];
      return n + (!s || s.due <= now ? 1 : 0);
    }, 0);
  }

  /* ---------- liste des paquets ---------- */
  let manifest = [];
  fetch(MANIFEST, { cache: "no-store" })
    .then((r) => { if (!r.ok) throw new Error("manifeste introuvable"); return r.json(); })
    .then((list) => {
      manifest = list;
      deckStatus.textContent = list.length + " paquet" + (list.length > 1 ? "s" : "");
      deckList.innerHTML = "";
      list.forEach((d) => {
        const el = document.createElement("div");
        el.className = "deck";
        el.innerHTML =
          `<h3>${esc(d.titre)}</h3>` +
          `<p class="deck-meta">${esc(d.description || "")}</p>` +
          `<div class="deck-meta" data-count>…</div>` +
          `<div class="bar"><i style="width:0"></i></div>`;
        el.addEventListener("click", () => openDeck(d));
        deckList.appendChild(el);
        // compteur « à réviser » = besoin du contenu déchiffré
        YeniCrypto.loadEncrypted(d.fichier).then((deck) => {
          d._deck = deck;
          const prog = loadProg(d.id);
          const total = deck.cartes.length;
          const learned = deck.cartes.filter((c, i) => {
            const s = prog[cardKey(c, i)];
            return s && s.box >= 3;
          }).length;
          el.querySelector("[data-count]").textContent =
            `${dueCount(deck, prog)} à réviser · ${total} cartes`;
          el.querySelector(".bar > i").style.width = (100 * learned / total) + "%";
        }).catch((e) => {
          el.querySelector("[data-count]").textContent = "Erreur : " + e.message;
        });
      });
    })
    .catch((e) => { deckStatus.textContent = "Erreur : " + e.message; });

  /* ---------- session ---------- */
  let session = null; // { deckId, title, cards:[{card,i}], pos, prog, reviewed, reAll }

  function openDeck(d, reAll) {
    const deck = d._deck;
    if (!deck) return;
    const prog = loadProg(d.id);
    const now = Date.now();
    let pool = deck.cartes
      .map((card, i) => ({ card, i }))
      .filter(({ card, i }) => {
        if (reAll) return true;
        const s = prog[cardKey(card, i)];
        return !s || s.due <= now;
      });
    shuffle(pool);

    session = { deckId: d.id, title: deck.titre, cards: pool, pos: 0, prog, reviewed: 0, reAll: !!reAll, d };
    deckView.hidden = true;
    studyView.hidden = false;
    $("studyTitle").textContent = deck.titre;
    $("doneView").hidden = true;
    showCard();
  }

  function showCard() {
    const total = session.cards.length;
    if (session.pos >= total) return finish();
    $("card").hidden = false;
    $("revealRow").hidden = false;
    $("gradeRow").hidden = true;
    $("doneView").hidden = true;
    $("card").classList.remove("flipped", "turning");

    const { card } = session.cards[session.pos];
    $("front").textContent = card.recto;
    $("back").textContent = card.verso;
    $("hint").textContent = card.indice || "";
    $("progressText").textContent = `${session.pos + 1} / ${total}`;
  }

  function reveal() {
    const card = $("card");
    if (card.classList.contains("flipped")) return;
    card.classList.add("turning");
    setTimeout(() => card.classList.remove("turning"), 160);
    setTimeout(() => card.classList.add("flipped"), 90);
    $("revealRow").hidden = true;
    $("gradeRow").hidden = false;
  }
  $("revealBtn").addEventListener("click", reveal);
  $("card").addEventListener("click", () => {
    if (!$("gradeRow").hidden) return;
    reveal();
  });

  $("gradeRow").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-grade]");
    if (!btn) return;
    grade(Number(btn.dataset.grade));
  });

  function grade(g) {
    const { card, i } = session.cards[session.pos];
    const key = cardKey(card, i);
    const s = session.prog[key] || { box: 0, due: 0 };
    if (g === 0) s.box = 1;                      // Encore
    else if (g === 1) s.box = Math.max(1, s.box); // Difficile : reste
    else if (g === 2) s.box = Math.min(INTERVALS.length - 1, s.box + 1); // Bien
    else s.box = Math.min(INTERVALS.length - 1, s.box + 2);              // Facile
    s.due = Date.now() + INTERVALS[s.box] * DAY;
    s.seen = (s.seen || 0) + 1;
    session.prog[key] = s;
    saveProg(session.deckId, session.prog);
    session.reviewed++;

    // « Encore » : la carte revient plus tard dans la même session
    if (g === 0) session.cards.push(session.cards[session.pos]);
    session.pos++;
    showCard();
  }

  function finish() {
    $("card").hidden = true;
    $("revealRow").hidden = true;
    $("gradeRow").hidden = true;
    $("doneView").hidden = false;
    $("progressText").textContent = "";
    $("doneText").textContent = `${session.reviewed} révision${session.reviewed > 1 ? "s" : ""} enregistrée${session.reviewed > 1 ? "s" : ""}.`;
  }

  $("backBtn").addEventListener("click", () => {
    studyView.hidden = true;
    deckView.hidden = false;
    // rafraîchit les compteurs
    manifest.forEach((d) => {
      if (!d._deck) return;
      const prog = loadProg(d.id);
      const el = [...deckList.children].find((c) => c.querySelector("h3").textContent === d._deck.titre);
      if (el) el.querySelector("[data-count]").textContent =
        `${dueCount(d._deck, prog)} à réviser · ${d._deck.cartes.length} cartes`;
    });
  });
  $("againBtn").addEventListener("click", () => openDeck(session.d, true));

  /* ---------- utils ---------- */
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
