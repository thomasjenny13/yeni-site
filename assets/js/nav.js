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
