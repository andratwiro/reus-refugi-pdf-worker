# Private entity binaries

Aquest directori conté binaris específics de l'entitat que NO han d'arribar mai
al repo públic. Estan gitignored (vegeu `.gitignore` a l'arrel del worker) i
s'empotren al bundle del worker via `[[rules]] type = "Data"` a `wrangler.toml`,
no via el binding ASSETS — així no s'exposen a cap URL pública.

## Fitxers requerits

- `entity-stamp.png` — Segell de l'entitat. Pintat al certificat A2 (Anexo II)
  a la zona de signatura del representant. Recomanat: PNG amb canal alpha
  (fons transparent), aproximadament 1300×300px, ~500 KB.
- `representative-signature.png` — Firma manuscrita del representant legal.
  Pintada sobre el segell al mateix certificat. Recomanat: PNG amb fons
  transparent, ~450×330 px.

Si un d'aquests fitxers no existeix, el worker generarà el A2 sense aquell
element (no falla).

## Per altres ONGs

Substitueix els dos PNGs pels de la teva entitat abans de fer
`npx wrangler deploy`. Tampoc oblidis editar `ENTITAT_*_BASE` a
`src/mappings.ts` i configurar els secrets `ENTITAT_TELEFON` /
`REPRESENTANT_*` (vegeu `wrangler.toml`).
