# Reus Refugi — PDF Worker

Cloudflare Worker que omple l'EX-32 amb les dades d'un cas d'Airtable i puja
el PDF generat al camp *Dossier generat* de la fila. Es dispara amb un botó.

## Arquitectura

```
Voluntari clica "🔘 Generar dossier" a Airtable
       ↓
Airtable Automation (Run script)
       ↓ POST /generate  {recordId}
       ↓ Authorization: Bearer <SHARED_SECRET>
       ↓
Cloudflare Worker (aquest projecte)
  1. Valida el Bearer token
  2. Fetch del record a Airtable (field IDs, no names)
  3. Carrega EX32_oficial.pdf dels static assets
  4. Omple camps segons "Via legal" (decision tree)
  5. Neteja attachment actual (replace semantics)
  6. Puja PDF nou via content.airtable.com/uploadAttachment
       ↓
Airtable mostra el nou PDF al camp "Dossier generat"
```

## Desplegament — primera vegada

### Prereqs
- Node.js 20+
- Compte de Cloudflare (gratuït)
- Airtable Personal Access Token amb permisos:
  - `data.records:read`
  - `data.records:write`
  - Scope a la base `appWuXncpGWaFTR4M`

### Passos

```bash
# 1. Instal·la dependències
npm install

# 2. Login a Cloudflare (obrirà el navegador)
npx wrangler login

# 3. Defineix els secrets (se't demanarà el valor en cada cas)
npx wrangler secret put AIRTABLE_TOKEN
# → enganxa el Personal Access Token d'Airtable

npx wrangler secret put SHARED_SECRET
# → genera un string aleatori (p.ex. `openssl rand -hex 32`)
#   GUARDA'L, també el necessites a l'Automation d'Airtable

# 4. Desplega
npx wrangler deploy
# → retorna la URL: https://reus-refugi-pdf-worker.<subdomain>.workers.dev
```

Prova ràpida que el Worker respon:

```bash
curl https://reus-refugi-pdf-worker.<subdomain>.workers.dev/
# {"ok":true,"service":"reus-refugi-pdf-worker"}
```

### Configura l'Automation d'Airtable

Segueix les instruccions dins `airtable-automation.js`. Resum:

1. Taula Casos → crea un camp tipus **Button** ("Run script")
2. Automations → nova automation amb trigger "When a button is clicked"
3. Afegeix un pas "Run script"
4. Input variables: `recordId` → `{recordId}` del trigger
5. Enganxa el codi de `airtable-automation.js`
6. Canvia `WORKER_URL` i `SHARED_SECRET` a les dues primeres línies
7. Test! Clica el botó a un cas existent (p. ex. Aminata)

## Iteració

Un cop desplegat, canviar codi i redeployar és ràpid:

```bash
# Edita src/*.ts
npx wrangler deploy
# ↓ en <10 segons està viu
```

Veure logs en temps real:

```bash
npx wrangler tail
```

## Estructura

```
src/
  index.ts       ← handler principal (/generate)
  airtable.ts    ← client de l'API (fetch record, upload attachment)
  mappings.ts    ← IDs dels camps d'Airtable (centralitzat)
  fillPdf.ts     ← lògica d'omplir el PDF + decision tree per Via legal
assets/
  EX32_oficial.pdf ← template bundled amb el Worker
airtable-automation.js ← codi per enganxar dins d'Airtable
wrangler.toml    ← config del Worker (assets binding + vars)
```

## Extensions previstes

- **EX-31** per DA 20ª (solicitants PI) → un segon template + branch al decision tree
- **Signatura digital** → capturada a Tally, descarregada al Worker, inserida al PDF a les pàgines 2/4/5/8
- **Annex I-2 múltiple** → un PDF per cada país a "Països residència 5 anys"
- **Camp de seguiment** "Data última regeneració" perquè el voluntari sàpiga si el dossier està obsolet

## Notes de seguretat

- Els secrets viuen només a Cloudflare (mai al repo)
- El Worker rebutja peticions sense el Bearer token correcte
- L'Airtable token hauria de tenir scope limitat a la base (no a totes les bases)
- Cap dada personal es logueja al `console.log` del Worker (només IDs)

## Debugging

**Error 401 Unauthorized al test**
El `SHARED_SECRET` al script d'Airtable no coincideix amb el del Worker.
Re-executa `npx wrangler secret put SHARED_SECRET` i actualitza el script.

**Error 500 amb "Airtable getRecord failed: 403"**
El Personal Access Token no té accés a la base o li manca scope.
Regenera'l a https://airtable.com/create/tokens amb els scopes correctes.

**El PDF queda buit o amb camps incorrectes**
Pot ser que un camp d'Airtable s'hagi renombrat i l'ID que tenim a `mappings.ts`
ja no existeixi. Comprova amb `npx wrangler tail` els warnings.

**El botó a Airtable no triggereja res**
Comprova que l'Automation estigui activada (toggle verd al cap de dalt).
