"""yéni.ch — prépare un dossier de photos pour tools/galerie.mjs.

Usage : python3 tools/redim.py <photos> <sortie>
Sortie : full/<id>.jpg (2560 px), thumb/<id>.jpg (720 px), list.json ;
<id> = nom du fichier sans extension. EXIF retiré (GPS, appareil),
orientation appliquée aux pixels. S'arrête si une photo est illisible
(ex. fichier kDrive « en ligne uniquement », lu comme des zéros)."""
import sys, json
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor
from PIL import Image, ImageOps

FULL, THUMB = 2560, 720

def one(args):
    p, out = args
    im = ImageOps.exif_transpose(Image.open(p)).convert("RGB")
    f = im.copy(); f.thumbnail((FULL, FULL), Image.LANCZOS)
    f.save(out / "full" / f"{p.stem}.jpg", quality=84, optimize=True, progressive=True)
    t = im.copy(); t.thumbnail((THUMB, THUMB), Image.LANCZOS)
    t.save(out / "thumb" / f"{p.stem}.jpg", quality=78, optimize=True, progressive=True)
    return {"id": p.stem, "name": p.name, "w": f.size[0], "h": f.size[1]}

if __name__ == "__main__":
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    files = sorted(x for x in src.iterdir() if x.suffix.lower() in (".jpg", ".jpeg") and not x.name.startswith("."))
    bad = [x.name for x in files if x.read_bytes()[:2] != b"\xff\xd8"]
    if bad:
        sys.exit("Photos illisibles (pas encore téléchargées par kDrive ?) : " + ", ".join(bad[:10]))
    if not files:
        sys.exit("Aucune photo .jpg dans " + str(src))
    (out / "full").mkdir(parents=True, exist_ok=True); (out / "thumb").mkdir(exist_ok=True)
    with ProcessPoolExecutor(max_workers=8) as ex:
        items = list(ex.map(one, [(p, out) for p in files]))
    (out / "list.json").write_text(json.dumps(items, ensure_ascii=False, indent=1))
    print(len(items), "photos préparées")
