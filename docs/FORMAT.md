# Format des données

Toutes les données privées sont des fichiers **JSON** dans `content/private/`.
Après édition, on les (re)chiffre vers `assets/data/` (voir `GUIDE.md`).

---

## 1. Arbre généalogique — `content/private/arbre.json`

```jsonc
{
  "meta": {
    "titre": "Arbre de la famille Jenny",
    "racine": "I001",        // (optionnel) fallback si "focus" absent
    "focus":  "I042",        // (optionnel) personne au centre à l'ouverture
    "maj": "2026-09-01"
  },

  "individus": {
    "I001": {                             // identifiant libre mais UNIQUE et STABLE
      "prenom": "Johann Kaspar",
      "nom": "Jenny",
      "sexe": "M",                        // "M" | "F" | autre chaîne
      "naissance": { "date": "1878-04-19", "lieu": "Glarus (GL)" },
      "deces":     { "date": "1951-11-30", "lieu": "Lausanne (VD)" },
      "profession": "Contremaître textile",
      "note": "Texte libre, souvenirs, sources…",
      "photo": "assets/img/personnes/i001.jpg"   // optionnel, chemin relatif
    }
    // …
  },

  "familles": {
    "F001": {
      "conjoints": ["I001", "I002"],      // 1 ou 2 identifiants d'individus
      "mariage": { "date": "1906-05-19", "lieu": "Lausanne (VD)" },
      "fin": { "type": "divorce", "date": "1968-02-24" },  // optionnel : divorce / séparation
      "enfants": ["I003", "I004"]         // identifiants d'individus
    },
    "F002": {                             // compagne/compagnon actuel·le,
      "conjoints": ["I001", "I099"],      // sans enfants communs
      "statut": "actuelle",
      "enfants": []
    }
    // …
  }
}
```

### Règles

- **Les identifiants (`I001`, `F001`…) ne doivent jamais changer** une fois
  utilisés : ils lient tout ensemble. Le préfixe `I`/`F` est une convention,
  pas une obligation.
- Un individu peut apparaître comme conjoint dans **plusieurs** familles
  (remariages, compagne/compagnon différent·e de l'autre parent…) : ajoute
  autant d'entrées `familles` que nécessaire. Les enfants sont rattachés à
  **l'union précise** dont ils sont issus ; le trait de descendance part de
  cette union-là. Avec ≥ 2 conjoint·es, la personne est encadrée par ses
  conjoint·es et chaque trait relie des bulles adjacentes.
- Les **dates** : idéalement `AAAA-MM-JJ`, mais `AAAA` seul ou `"vers 1880"`
  fonctionnent (seule l'année est extraite pour l'affichage court).
- Champs tous optionnels sauf, en pratique, `prenom`/`nom`.
- L'arbre affiché est **descendant** (racine → enfants → petits-enfants…),
  avec les conjoint·es en bulles reliées. La vue met en avant la personne
  « au centre » et sa famille proche (le reste en transparence) et zoome
  automatiquement dessus ; « Voir large » dézoome sur toute la lignée.
- `fin` : `type` vaut `"divorce"` ou `"separation"` — trait en pointillé fin.
  `date` optionnelle.
- `statut: "actuelle"` sur une union (sans `fin`) : compagne/compagnon du
  moment (sert au texte de la fiche ; le trait reste plein).

### Photos (optionnel)

Mets les images dans `assets/img/personnes/`, référence-les par
`"photo": "assets/img/personnes/xxx.jpg"`. Elles ne sont **pas** chiffrées
(le dépôt étant public, ne mets pas de photo que tu ne voudrais pas voir
publique — ou héberge-les ailleurs).

---

## 2. Cartes de mémorisation

### Manifeste — `assets/data/flashcards/decks.json` (EN CLAIR)

Liste des paquets. Ne contient que des titres/descriptions, donc pas chiffré.

```json
[
  {
    "id": "rues-lausanne",
    "titre": "Noms de rues — Lausanne",
    "description": "Situer les rues du centre de Lausanne.",
    "fichier": "assets/data/flashcards/rues-lausanne.json.enc"
  }
]
```

### Un paquet — `content/private/flashcards/<id>.json`

```jsonc
{
  "titre": "Noms de rues — Lausanne",
  "description": "Situer les rues du centre de Lausanne.",
  "cartes": [
    {
      "recto": "Rue de Bourg",
      "verso": "Rue commerçante entre Saint-François et Georgette.",
      "indice": "quartier du Bourg",     // optionnel, affiché sous le verso
      "id": "bourg"                        // optionnel : fige la progression
                                           // même si tu réordonnes les cartes
    }
  ]
}
```

- Sans `id`, la progression d'une carte est repérée par sa position + son
  recto ; si tu réordonnes beaucoup, ajoute des `id` stables.
- La progression (répétition espacée, système de Leitner) est stockée dans le
  `localStorage` du navigateur de chaque personne — rien de sensible, non
  synchronisé, non chiffré.

### Ajouter un paquet

1. Créer `content/private/flashcards/mon-paquet.json`.
2. Ajouter une entrée dans `assets/data/flashcards/decks.json`.
3. Rechiffrer (voir `GUIDE.md`).
