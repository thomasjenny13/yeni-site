# yéni.ch

Site de la famille Jenny. Statique, hébergé sur GitHub Pages, sur le même
principe que `archivir.ch` / `kaizo.ch` (HTML/CSS/JS écrits à la main, aucun
build). Design repris de **clou.ch** : grotesque, blanc, coins arrondis,
accent violet.

## Tout est privé

`index.html` est un **écran de connexion** (à la page de login d'un NAS) :
rien d'autre n'est visible tant qu'on n'a pas entré le mot de passe de la
famille. Une fois entré, un portail donne accès à `arbre.html` et
`flashcards.html`. Ces pages redirigent vers l'accueil si la session n'est
pas déverrouillée.

Le contenu (généalogie, cartes) est **chiffré côté client** (AES-GCM 256,
clé dérivée du mot de passe familial par PBKDF2). Le dépôt est public mais
seuls des fichiers `.enc` illisibles y figurent. Les sources en clair vivent
dans `content/private/` — **ce dossier est dans `.gitignore`, ne jamais le
committer**.

> Ce n'est pas une sécurité de niveau bancaire : un mot de passe partagé reste
> partageable, et quiconque l'a peut tout lire. C'est du vrai chiffrement,
> suffisant pour de la vie privée familiale.

## Arborescence

```
yéni-site/
├── index.html            écran de connexion + portail (style clou.ch)
├── arbre.html            arbre généalogique (protégé)
├── flashcards.html       cartes de mémorisation (protégé)
├── 404.html
├── CNAME                 xn--yni-bma.ch  (= yéni.ch en punycode)
├── .nojekyll
├── assets/
│   ├── css/style.css     système de design
│   ├── js/
│   │   ├── crypto.js     déverrouillage + déchiffrement
│   │   ├── arbre.js      rendu de l'arbre
│   │   └── flashcards.js moteur de répétition espacée
│   ├── img/favicon.svg
│   └── data/             CONTENU PUBLIÉ (chiffré)
│       ├── probe.enc     fichier témoin (valide le mot de passe)
│       ├── arbre.json.enc
│       └── flashcards/
│           ├── decks.json          manifeste (en clair : juste les titres)
│           └── rues-lausanne.json.enc
├── content/private/      SOURCES EN CLAIR — gitignoré
│   ├── arbre.json
│   └── flashcards/rues-lausanne.json
├── tools/
│   ├── chiffrer.mjs      chiffrement en ligne de commande (Node, sans dépendance)
│   └── chiffrer.html     même chose dans le navigateur (aucune install)
└── docs/
    ├── GUIDE.md          modifier le contenu, changer le mot de passe, déployer
    └── FORMAT.md         schéma des données (arbre + cartes)
```

## Démarrer en local

```bash
cd yéni-site
python3 -m http.server 8000
# http://localhost:8000
```

Mot de passe de démonstration (à changer, voir `docs/GUIDE.md`) : `famille-jenny`

## Publier

Voir `docs/GUIDE.md` § Déploiement. En résumé : créer un dépôt GitHub
`yeni-site`, pousser, activer Pages sur `main` / `/`, et pointer le DNS de
`yéni.ch` (punycode `xn--yni-bma.ch`) vers GitHub Pages.
