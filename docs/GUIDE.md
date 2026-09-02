# Guide — faire vivre yéni.ch

## 0. Vue d'ensemble

- Le site est **statique**. Aucun build, aucun serveur.
- Le seul « traitement » est le **chiffrement** du contenu privé : tu édites
  du JSON en clair dans `content/private/`, un outil produit les `.enc` dans
  `assets/data/`, tu commit + push, GitHub Pages publie.
- `content/private/` est **gitignoré** : il ne part jamais sur GitHub.
  Garde-le en lieu sûr (kDrive, sauvegarde). Tu peux toujours le reconstituer
  depuis les `.enc` avec le mot de passe (voir § 4).

---

## 1. Travailler en local

```bash
cd yéni-site
python3 -m http.server 8000
```

Ouvre <http://localhost:8000>. Le login accepte le **mot de passe familial**
(celui qui a servi à générer les `.enc` — jamais écrit dans le dépôt).

> Ouvrir les fichiers en `file://` ne marche pas (les `fetch` sont bloqués).
> Il faut le petit serveur ci-dessus.

---

## 2. Modifier l'arbre généalogique

1. Édite `content/private/arbre.json` (schéma : `docs/FORMAT.md`).
2. Rechiffre :

   ```bash
   YENI_PW='le-mot-de-passe' node tools/chiffrer.mjs
   ```

   ou, sans terminal : ouvre `tools/chiffrer.html` dans un navigateur,
   choisis **Lot existant**, fournis `assets/data/probe.enc`, dépose
   `arbre.json`, récupère `arbre.json.enc` et remplace-le dans `assets/data/`.
3. Vérifie en local, puis `git add -A && git commit && git push`.

---

## 3. Ajouter / modifier un paquet de cartes

1. `content/private/flashcards/<id>.json` (schéma : `docs/FORMAT.md`).
2. Ajoute l'entrée correspondante dans `assets/data/flashcards/decks.json`
   (ce fichier reste **en clair**, il ne contient que le titre).
3. Rechiffre (comme § 2). Le script chiffre automatiquement tout
   `content/private/**/*.json`.
4. Commit + push.

---

## 3 bis. Ajouter un texte du Claude (« Les écrits du Claude »)

1. Ouvre `content/private/memoires.json`.
2. Ajoute un objet dans le tableau `textes`. Deux formats possibles :

   **Texte simple** — `{ "titre": "…", "date": "…", "texte": "…" }`.
   Dans `texte`, sépare les paragraphes par une **ligne vide**.

   **Article « journal » (mise en page en colonnes)** — au lieu de `texte`,
   fournis un tableau `corps` de blocs, plus des champs d'en-tête optionnels
   (`kicker`, `tags`, `standfirst`, `meta`, `note`) :

   ```json
   {
     "titre": "…", "date": "Septembre 2026",
     "kicker": "Analyse politique",
     "tags": ["Démocratie directe", "Souveraineté"],
     "standfirst": "Chapô d'une phrase, en italique centré.",
     "meta": { "Rédaction": "…", "Contexte": "…" },
     "note": "Mention légale en pied d'article.",
     "corps": [
       { "type": "lead", "t": "Chapeau d'attaque, pleine largeur." },
       { "type": "h", "t": "Un intertitre" },
       { "type": "p", "dropcap": true, "t": "Paragraphe avec lettrine." },
       { "type": "p", "t": "Paragraphe normal. **gras** et liens https://… ok." },
       { "type": "quote", "t": "Citation détachée.", "src": "Source, date" },
       { "type": "box", "kicker": "Encadré", "titre": "Titre",
         "items": ["Puce 1", "Puce 2"] },
       { "type": "figure", "src": "assets/img/xxx.jpg",
         "alt": "Description", "caption": "**Amorce.** Légende.", "credit": "Source" },
       { "type": "refs", "items": ["**Réf. 1** — …", "**Réf. 2** — …"] }
     ]
   }
   ```

   Tout l'article est **au fer à gauche**. Le corps (`lead`, `p`, `h`, `quote`,
   `box`, `figure`) est coulé en **2 ou 3 colonnes** selon la largeur ; les
   `refs` s'affichent pleine largeur sous les colonnes.

   **Images** — dépose le fichier dans `assets/img/` (photo `.jpg`/`.png` ou
   SVG). Elles sont cadrées à la largeur d'une colonne et rendues en niveaux
   de gris (effet journal). Ces images **ne sont pas chiffrées** : n'y mets
   rien de sensible.
3. Rechiffre (`YENI_PW='…' node tools/chiffrer.mjs`), puis commit + push.

---

## 4. Récupérer les sources en clair depuis les `.enc`

Si tu as perdu `content/private/` mais que tu as le mot de passe :

```bash
YENI_PW='le-mot-de-passe' node tools/chiffrer.mjs --decrypt
```

(ou `tools/chiffrer.html` § 2 · Déchiffrer)

---

## 5. Changer le mot de passe familial

Changer le mot de passe = **tout rechiffrer avec un nouveau sel**.

1. Assure-toi d'avoir `content/private/` complet (au besoin, § 4 avec l'ancien
   mot de passe).
2. Supprime l'ancien témoin et les `.enc` :

   ```bash
   rm assets/data/probe.enc assets/data/arbre.json.enc assets/data/flashcards/*.json.enc
   ```

3. Régénère avec le nouveau mot de passe :

   ```bash
   YENI_PW='nouveau-mot-de-passe' node tools/chiffrer.mjs
   ```

4. Commit + push. Préviens la famille du nouveau mot de passe (par un canal
   sûr, pas par e-mail en clair).

> Note : l'ancien contenu reste lisible dans l'historique Git avec l'ancien
> mot de passe. Si c'est un problème (mot de passe fuité), il faut réécrire
> l'historique (`git filter-repo`) ou repartir d'un dépôt neuf.

---

## 6. Déploiement (première fois)

### a. Dépôt GitHub

```bash
cd yéni-site
git init
git add -A
git commit -m "Site yéni.ch initial"
gh repo create yeni-site --public --source=. --push
```

### b. Activer GitHub Pages

Repo → **Settings → Pages** → Source : `Deploy from a branch` → `main` / `/ (root)`.
Le fichier `CNAME` (déjà présent : `xn--yni-bma.ch`) règle le domaine.

### c. DNS chez le registrar de `yéni.ch`

`yéni.ch` s'écrit `xn--yni-bma.ch` en punycode (domaine internationalisé).
Configure, sur `xn--yni-bma.ch` :

- soit 4 enregistrements `A` vers les IP GitHub Pages :
  `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
- soit un `CNAME` `xn--yni-bma.ch` → `<ton-user>.github.io`
  (selon ce que le registrar autorise pour le domaine apex).

Puis dans Settings → Pages, saisis `xn--yni-bma.ch` comme *Custom domain*,
attends la validation, coche **Enforce HTTPS**.

### d. Vérifier

- <https://yéni.ch> → page publique
- <https://yéni.ch/> (tout est derrière le login) → login → arbre + cartes

---

## 7. Rappels de sécurité

- Ne commit **jamais** `content/private/`.
- Ne mets pas dans l'arbre des infos sur des personnes **vivantes** qui n'ont
  pas donné leur accord (dates de naissance complètes, adresses…).
- Les photos référencées dans l'arbre ne sont **pas** chiffrées.
- `robots` `noindex` est posé sur toutes les pages ; ça n'empêche pas l'accès,
  juste l'indexation.
