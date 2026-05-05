# Private entity binaries

Aquest directori conté binaris específics de l'entitat que NO han d'arribar
mai al repo públic. Estan gitignored (vegeu `.gitignore` a l'arrel del worker)
i es serveixen al worker via un **Cloudflare KV namespace privat** (no via
binding ASSETS) — així no s'exposen a cap URL pública.

## Fitxers requerits

- `entity-stamp.png` — Segell de l'entitat. Pintat al certificat A2 (Anexo II)
  a la zona de signatura del representant. Recomanat: PNG amb canal alpha
  (fons transparent), aproximadament 1300×300px.
- `representative-signature.png` — Firma manuscrita del representant legal.
  Pintada sobre el segell al mateix certificat. Recomanat: PNG amb fons
  transparent, ~450×330 px.

Si una key del KV no existeix, el worker generarà el A2 sense aquell element
(no falla).

## Setup d'una vegada

```bash
# 1. Crear el KV namespace (una sola vegada per worker)
npx wrangler kv namespace create PRIVATE_BINARIES
# Output: copia l'ID retornat — alguna cosa com "abc123def456..."

# 2. Edita wrangler.toml — descomenta el bloc [[kv_namespaces]] i hi enganxa
#    l'ID retornat al pas anterior. Fes commit del fitxer.

# 3. Puja els PNGs al KV (els bytes són privats — només accessibles via el
#    binding del worker, mai per URL):
npx wrangler kv key put --binding PRIVATE_BINARIES \
    "entity-stamp" --path src/private/entity-stamp.png

npx wrangler kv key put --binding PRIVATE_BINARIES \
    "representative-signature" --path src/private/representative-signature.png

# 4. Verifica que les keys estan pujades:
npx wrangler kv key list --binding PRIVATE_BINARIES
```

## Per què KV i no `[[rules]] type="Data"` a wrangler.toml?

Cloudflare Workers Builds clona el repo a la seva infraestructura per fer el
build. Com que `src/private/*.png` són gitignored, NO existeixen al checkout
de CF — un import estàtic com `import x from "./private/foo.png"` faria
fallar `esbuild`. KV evita això: els bytes viuen al servei Cloudflare KV i
es llegeixen a runtime.

## Per altres ONGs

Substitueix els dos PNGs pels de la teva entitat abans de fer els 3 comandos
del setup. Tampoc oblidis editar `ENTITAT_*_BASE` a `src/mappings.ts` i
configurar els secrets `REPRESENTANT_*` (vegeu
`wrangler.toml`).
