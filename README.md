# Reus Refugi — Worker d'automatització

Cloudflare Worker que automatitza la paperassa de regularització administrativa
per a [Reus Refugi](https://reusrefugi.cat), una entitat sense ànim de lucre
que acompanya persones migrades a regularitzar la seva situació a Espanya.

> **Estat**: en producció des d'abril 2026. L'usen voluntaris no-tècnics
> diàriament. Aquest repo està obert per transparència i com a referència per a
> altres entitats del Tercer Sector que vulguin replicar fluxos similars.

---

## Com funciona el flux actual

Tota la paperassa de regularització passa per quatre baules connectades:

- **Tally captura les dades inicials** del sol·licitant en una primera trobada,
  sense haver d'exposar Venus (la base d'Airtable) a persones sense
  preparació tècnica ni accés operatiu. El formulari de Tally escriu
  directament a Airtable.
- **Venus (Airtable) actua com a core de dades.** És la font de veritat única:
  cada cas, document, factor de vulnerabilitat i relació familiar viu aquí.
  Els voluntaris hi treballen el dia a dia.
- **Venus genera l'informe de vulnerabilitat amb un clic** i, a la mateixa
  fila, prepara un esborrany de Gmail amb el PDF adjunt llest per enviar al
  destinatari (típicament la Subdelegació o l'Oficina d'Estrangeria).
- **Un userscript de Tampermonkey automatitza la pujada de dades de Venus
  cap a Mercurio**, omplint els ~144 camps del formulari telemàtic EX-31/EX-32
  perquè el voluntari només hagi de revisar i signar amb AutoFirma.

```
Tally  →  Venus (Airtable)  ─┬─→  Informe de vulnerabilitat (PDF) + draft Gmail
                             ├─→  Dossier EX-31 / EX-32 (PDF)
                             └─→  Mercurio (auto-fill via Tampermonkey)
```

---

## Les dues coses interessants

> La resta del Worker (dossiers EX-31/EX-32 PDF, proxy Gmail) són accessoris.
> El que de debò aporta valor avui és això:

### 🩺 Omplir informes de vulnerabilitat — en producció

`POST /anexo2` — el voluntari prem un botó a la taula *Informes de Vulnerabilitat*
d'Airtable i, en pocs segons, es genera un **certificat de vulnerabilitat**
oficial (Anexo II del procediment EX-32) signat amb les dades de l'entitat
acreditada (RECEX), llest per adjuntar a la sol·licitud i per enviar com a
esborrany de Gmail amb un altre clic.

Estalvia temps real per cas: és el document que substitueix l'informe
d'inserció social municipal — abans calia redactar-lo a mà — i recull els
factors de vulnerabilitat (Casillas 54-64) que el voluntari ja tenia marcats
a Airtable. **Funciona, és estable, i s'usa cada dia.**

Detall tècnic: el PDF es lliura *flatten* (no editable) i renderitza idèntic
a tot arreu (Adobe, Chrome, Drive, Samsung Notes…). Vegeu
[`src/anexo2.ts`](src/anexo2.ts) per la lògica de Strategy A — flatten manual,
sense AcroForm.

### 🤖 Omplir Mercurio automàticament — **beta**

[Mercurio](https://mercurio.delegaciondelgobierno.gob.es) és la plataforma
oficial per presentar EX-31 i EX-32 telemàticament: ~144 camps de formulari
que els voluntaris havien de copiar-pegar manualment des d'Airtable cas per
cas. **Aquí hi ha el potencial gros.**

Un **userscript de Tampermonkey** servit per `GET /mercurio.user.js`:

1. Detecta quan ets a la pantalla d'EX-31 o EX-32 a Mercurio.
2. Mostra un panell flotant amb cercador de casos d'Airtable Venus.
3. Quan cliques un cas, omple els 144 camps automàticament — incloent les
   cascades AJAX (província → municipi → localitat), radio buttons dinàmics,
   checkboxes condicionals i el bloc reagrupant (DA 21ª) si el cas té un
   referent familiar.
4. **No submiteja.** El voluntari revisa les dades i prem "Firmar y registrar"
   amb AutoFirma. La signatura amb certificat digital és un acte intencional,
   mai automatitzat.

És **beta**: codis confirmats per a DA 21ª Laboral/Familiar/Vulnerabilitat;
codis de DA 20ª (PI) encara s'estan validant amb casos reals. La pujada de
documents adjunts (passaport, antecedents, etc.) encara no està implementada
i és el següent pas natural.

Endpoints relacionats:

- `GET /mercurio.user.js` — userscript autoinstal·lable (auto-update diari).
- `GET /mercurio/cases?q=text` — cerca casos a Airtable.
- `GET /mercurio/payload?caso=recXXX` — retorna els 144 camps mapats per a un cas.

Codi a [`src/mercurio/`](src/mercurio/):

- `mapping.ts` — Airtable case → payload Mercurio (143 camps + lògica DA 20ª/DA 21ª).
- `catalogs.ts` — codis estàtics del DOM Mercurio (sexe, província, parentesco…).
- `userscriptCode.ts` — template del userscript Tampermonkey.

---

## Altres endpoints (accessoris)

També hi ha codi al Worker per a aquestes coses, però **no són el focus** del
projecte ara mateix. Els documentem aquí perquè existeixen i funcionen:

- **`POST /generate` — dossier EX-31 / EX-32 en PDF.** Genera el PDF complet
  del formulari (dades + signatura digital + fulls de Sección 5 per a familiars
  simultanis). Era la funció original del repo abans que entrés Mercurio.
  Útil només si presentes en paper o vols arxiu local. *Possible amb això,
  però no important.*
- **`POST /gmail-draft` — proxy a Google Apps Script.** Crea un esborrany a
  Gmail amb el PDF adjunt. Existeix perquè GAS retorna 302 que el navegador
  no pot seguir; aquest endpoint fa la crida server-side.

---

## Captura de dades inicial — Tally → Airtable

Les dades inicials del cas (la primera trobada amb el sol·licitant) es capturen
amb un formulari de [Tally](https://tally.so) que els voluntaris fan servir
com a portafoli d'entrada. El formulari escriu directament a la base **Venus**
d'Airtable via la integració nativa Tally → Airtable.

A partir d'aquí, els voluntaris enriqueixen el cas dins d'Airtable (documents,
situació familiar, factors de vulnerabilitat, etc.) i el Worker treballa sobre
aquestes dades.

> 💡 **Possible integració futura**: avui el flow Tally → Airtable usa la
> integració nativa de Tally. Es podria moure a un webhook Tally → Worker per
> validar/normalitzar dades a l'entrada, generar IDs de cas, o disparar
> automàticament la creació d'una fila d'Informe de Vulnerabilitat. No és
> prioritari ara mateix.

---

## Arquitectura

```
┌──────────────────┐  ┌──────────────────┐  ┌────────────────────────┐
│  Tally (entrada) │  │ Airtable (Venus) │  │ Mercurio (gov.es)      │
└────────┬─────────┘  └────────┬─────────┘  └──────────┬─────────────┘
         │  webhook              │  REST API           │ userscript injecta DOM
         └────────────►──────────┘                     │
                                 │                     │
                       ┌─────────▼─────────────────────▼──────────┐
                       │   Cloudflare Worker (aquest repo)        │
                       │   - /generate     dossier EX-31/EX-32     │
                       │   - /anexo2       informe vulnerabilitat  │
                       │   - /mercurio/*   cerca + payload + JS    │
                       │   - /gmail-draft  proxy a GAS             │
                       │   secrets: AIRTABLE_TOKEN, SHARED_SECRET  │
                       │   assets: plantilles PDF oficials         │
                       └──────────────────────────────────────────┘
```

---

## Setup des de zero

### Prereqs

- Node.js 20+
- Compte de Cloudflare (el pla gratuït cobre el volum d'una entitat petita).
- Personal Access Token d'Airtable amb scopes `data.records:read` i
  `data.records:write` limitats a la teva base.

### Passos

```bash
# 1. Clona i instal·la
git clone https://github.com/andratwiro/reus-refugi-pdf-worker
cd reus-refugi-pdf-worker
npm install

# 2. Login a Cloudflare (obre el navegador)
npx wrangler login

# 3. Defineix els secrets bàsics
npx wrangler secret put AIRTABLE_TOKEN     # Personal Access Token
npx wrangler secret put SHARED_SECRET      # openssl rand -hex 32

# 4. Defineix el presentador (representant acreditat de la teva entitat)
#    — només cal si vols usar la integració Mercurio
npx wrangler secret put PRESENTADOR_NOMBRE   # "COGNOM1 COGNOM2 NOM" majúscules
npx wrangler secret put PRESENTADOR_NIE
npx wrangler secret put PRESENTADOR_TIPODOC  # NF (NIE) | NV (DNI) | PA (passaport)
npx wrangler secret put PRESENTADOR_MOBIL
npx wrangler secret put PRESENTADOR_EMAIL

# 5. Defineix els secrets de Gmail (opcional, només si uses /gmail-draft)
npx wrangler secret put GAS_WEBAPP_URL
npx wrangler secret put GAS_SHARED_SECRET

# 6. Edita wrangler.toml amb els IDs de la teva base d'Airtable
# (AIRTABLE_BASE_ID, CASOS_TABLE_ID, INFORMES_VULN_TABLE_ID, etc.)

# 7. Push a main → Cloudflare Workers Builds desplega automàticament.
git push origin main
```

### Comprovar que funciona

```bash
curl https://<el-teu-worker>.workers.dev/
# → {"ok":true,"service":"reus-refugi-pdf-worker"}

curl https://<el-teu-worker>.workers.dev/mercurio.user.js | head -30
# → ha de retornar el userscript de Tampermonkey amb @match a Mercurio
```

### Connectar Airtable

Per a `/generate` i `/anexo2`: crea un camp Button a la taula corresponent que
dispari una Automation tipus "Run script". Enganxa el codi de
[`airtable-automation.js`](airtable-automation.js) i actualitza les dues
primeres línies amb el teu `WORKER_URL` i `SHARED_SECRET`.

Per a Mercurio: instal·la Tampermonkey al navegador, obre la URL
`https://<el-teu-worker>.workers.dev/mercurio.user.js` i Tampermonkey detectarà
el script automàticament.

---

## Estructura del repo

```
src/
  index.ts             ← router principal (totes les rutes HTTP)
  airtable.ts          ← client Airtable (read, listRecords, uploadAttachment)
  mappings.ts          ← IDs de camps Airtable per a la taula Casos
  fillPdf.ts           ← omplir dossier EX-31/EX-32 (decision tree per Via legal)
  anexo2.ts            ← omplir Informe de Vulnerabilitat (Strategy A flatten)
  mercurio/
    mapping.ts         ← Airtable case → 144 camps Mercurio
    catalogs.ts        ← codis DOM (sexe, província, parentesco…)
    userscriptCode.ts  ← template del userscript Tampermonkey

assets/
  EX31_oficial.pdf, EX31_seccion5.pdf
  EX32_oficial.pdf, EX32_seccion5.pdf
  A2_certificado_vulnerabilidad.pdf

mock/                  ← fixtures de casos reals + sintètics per a tests
airtable-automation.js ← codi per enganxar dins d'Airtable (botó → Worker)
wrangler.toml          ← config del Worker (vars públiques, assets binding)
```

---

## Notes per a entitats que vulguin replicar

### Plantilla pública d'Airtable

L'esquema de Venus està publicat com a **plantilla pública** a Airtable Universe:

🔗 **[Venus — Plantilla regularització (RD 1155/2024)](https://www.airtable.com/universe/expouXQDj6Qd9pe8L/venus-plantilla-regularitzacio-rd-3162026)**

Pots clonar-la al teu workspace amb un clic — t'estalvies recrear taules, camps,
vistes i automatitzacions des de zero. Després només cal:

1. Connectar el formulari de Tally (o el teu propi punt d'entrada) a la taula `Casos`.
2. Substituir els IDs de base i taula a `wrangler.toml` pels de la teva còpia.
3. Configurar els secrets de l'entitat (`PRESENTADOR_*`).

### Hard-codings específics

- El **presentador** (representant acreditat que signa les sol·licituds) es
  configura via els 5 secrets `PRESENTADOR_*`. Cada entitat ha de fer-ho amb
  les seves pròpies dades — no hi ha valors per defecte al codi.
- `wrangler.toml` apunta a la base d'Airtable Venus de Reus Refugi
  (`appWuXncpGWaFTR4M`). Cada entitat té la seva pròpia base; cal canviar tots
  els IDs.
- L'esquema d'Airtable reflecteix el flux operatiu de Reus Refugi i s'ha anat
  construint segons les necessitats dels voluntaris. La plantilla pública és
  un punt de partida raonable, però potser voldràs adaptar-la.

Si treballes en una entitat similar i vols adaptar això, obre un issue —
mirarem d'extreure les peces reutilitzables (sobretot `mercurio/catalogs.ts`,
que conté codis del DOM Mercurio que són universals).

---

## Notes de seguretat

- Els secrets viuen només a Cloudflare; mai al repo.
- `/generate`, `/anexo2`, `/gmail-draft`, `/mercurio/cases` i `/mercurio/payload`
  exigeixen `Authorization: Bearer <SHARED_SECRET>`.
- `GET /mercurio.user.js` és **obert** (qualsevol pot baixar el userscript).
  El `SHARED_SECRET` queda embedded al JS servit; el threat model assumeix que
  l'entitat acreditada és de confiança i que Cloudflare té audit logs si calgués
  investigar abús.
- L'Airtable token ha de tenir scope limitat a la base (no a totes les bases).
- No es loguegen dades personals — només IDs d'Airtable i mètriques.

---

## Llicència

[MIT](LICENSE). Pots forkar, modificar i redistribuir lliurement — inclòs ús
comercial — sempre que mantinguis l'avís de copyright. Sense garanties.

---

## Crèdits

Construït per [Reus Refugi](https://reusrefugi.cat) amb assistència
de Claude Code. Si trobes alguna cosa útil aquí o vols col·laborar, escriu
a `regularitzacio@reusrefugi.cat`.
