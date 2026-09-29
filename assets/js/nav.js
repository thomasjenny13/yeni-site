/* ============================================================
   yéni.ch — menu de section (barre d'outils)
   Le titre de la section ouverte est un bouton ; la flèche
   déroule les autres sections juste en dessous.
   ============================================================ */
(function () {
  var menu = document.querySelector(".tb-menu");
  if (!menu) return;
  var btn = menu.querySelector(".tb-menu-btn");
  var list = menu.querySelector(".tb-menu-list");
  if (!btn || !list) return;

  function close() {
    list.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }
  function open() {
    list.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  }

  // sur grand écran, les sections sont toutes visibles dans l'en-tête
  // (le CSS masque alors le menu déroulant, et l'inverse sur mobile)
  var SECTIONS = [
    { href: "arbre.html", nom: "Arbre" },
    { href: "memoires.html", nom: "Les Écrits du Claude" },
    { href: "revisions.html", nom: "Révisions" }
  ];
  var here = location.pathname.split("/").pop() || "index.html";
  var chapters = document.createElement("nav");
  chapters.className = "tb-chapters";
  chapters.setAttribute("aria-label", "Sections");
  SECTIONS.forEach(function (s) {
    var a = document.createElement("a");
    a.href = s.href;
    a.textContent = s.nom;
    if (s.href === here) a.setAttribute("aria-current", "page");
    chapters.appendChild(a);
  });
  menu.after(chapters);

  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (list.hidden) open(); else close();
  });
  document.addEventListener("click", function (e) {
    if (!menu.contains(e.target)) close();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") close();
  });
})();
