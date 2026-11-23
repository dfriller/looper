# Looper

Phrase einspielen, die App erkennt den gemeinten Loop.

- `index.html`: fertige App (GitHub Pages)
- `src/loop.js`: Loop-Erkennung, `src/app.html`: UI-Vorlage
- `tests/`: synthetische Tests (`node tests/test.js`)

Build: `python3 -c "open(\"index.html\",\"w\").write(open(\"src/app.html\").read().replace(\"/*LOOPJS*/\",open(\"src/loop.js\").read()))"`
