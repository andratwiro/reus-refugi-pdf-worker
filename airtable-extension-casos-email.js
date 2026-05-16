/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AIRTABLE SCRIPTING — Botó "Crear correu presentació" (Casos)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Quan un Cas ja s'ha presentat a Mercurio, el voluntari obre aquesta
 * extensió, selecciona la fila del cas i s'crea un esborrany de Gmail en
 * català dirigit al sol·licitant, amb el justificant de presentació adjunt.
 *
 * Calc de l'extensió "Enviar" dels Informes de Vulnerabilitat, però per a
 * la taula `Casos` i agafant l'adjunt del camp `Certificat Mercurio fitxer`.
 *
 * Envia al Worker /gmail-draft, que fa de proxy cap al Google Apps Script
 * desplegat a info@reusrefugi.cat. El GAS crea un draft a la bústia de
 * info@reusrefugi.cat amb el PDF adjunt i el destinatari del camp Email.
 * El voluntari clica el link generat, obre la carpeta Drafts i l'envia.
 *
 * NOTA: cal estar loggejat com a info@reusrefugi.cat a Gmail (o tenir-lo
 * com a compte secundari). Si no, el link obrirà Gmail demanant login.
 *
 * SETUP A AIRTABLE (fes-ho un cop):
 *  1. Dashboard → Add an extension → Scripting
 *  2. Edit code → enganxa aquest codi
 *  3. Omple SHARED_SECRET amb el mateix valor del Worker
 *  4. Run → seleccionar fila → crea el draft
 *
 *  IMPORTANT: si modifiques aquest fitxer al repo, recorda copiar-lo
 *  manualment a l'extensió — no hi ha sync automàtic.
 * ─────────────────────────────────────────────────────────────────────────
 */

const WORKER_URL = "https://reus-refugi-pdf-worker.info4132.workers.dev";
// ⚠️  Enganxa aquí el mateix secret que has posat al Worker (no el desis al repo) ⚠️
const SHARED_SECRET = "PASTE-THE-SAME-SECRET-YOU-SET-IN-WRANGLER";

const TABLE_NAME = "Casos";
const EMAIL_FIELD = "Email";                     // email — destinatari
const CERT_FIELD = "Certificat Mercurio fitxer"; // multipleAttachments — justificant

const SUBJECT = "La teva sol·licitud de regularització ha estat presentada";
const BODY = [
  "Hola,",
  "",
  "Et confirmem que la teva sol·licitud de regularització ha estat presentada",
  "telemàticament a l'Administració. Adjuntem el justificant de presentació.",
  "",
  "Ens posarem en contacte amb tu quan tinguem novetats o si l'Administració",
  "demana documentació o requeriments addicionals. De moment no cal que facis",
  "cap gestió.",
  "",
  "Qualsevol consulta, pots respondre aquest correu.",
  "",
  "Reus Refugi",
  "info@reusrefugi.cat",
].join("\n");

// URL a la carpeta Drafts de info@reusrefugi.cat específicament.
// Funciona fins i tot si l'usuari té altres comptes Gmail oberts.
const GMAIL_DRAFTS_URL =
  "https://mail.google.com/mail/?authuser=info@reusrefugi.cat#drafts";

const table = base.getTable(TABLE_NAME);
const record = await input.recordAsync("Selecciona el cas", table);

if (!record) {
  output.markdown("❌ No s'ha seleccionat cap fila.");
} else {
  const email = record.getCellValueAsString(EMAIL_FIELD);
  const attachments = record.getCellValue(CERT_FIELD);
  const pdf = attachments && attachments[0];

  if (!email) {
    output.markdown("❌ Falta l'email del destinatari al cas.");
  } else if (!pdf) {
    output.markdown(
      `❌ No hi ha cap fitxer a **${CERT_FIELD}**. Puja el justificant de Mercurio abans de crear el correu.`,
    );
  } else {
    if (attachments.length > 1) {
      output.markdown(`⚠️ **${CERT_FIELD}** té ${attachments.length} fitxers — s'adjunta només el primer.`);
    }
    output.markdown(`⏳ Creant draft per a \`${email}\`...`);

    const resp = await remoteFetchAsync(`${WORKER_URL}/gmail-draft`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SHARED_SECRET}`,
      },
      body: JSON.stringify({
        to: email,
        subject: SUBJECT,
        bodyText: BODY,
        attachmentUrl: pdf.url,
        filename: pdf.filename || "Justificant presentacio.pdf",
      }),
    });

    // Parseja la resposta de forma tolerant. El GAS pot retornar shapes variats
    // ({ok:true,...}, {success:true,...}, "OK", etc.). Tractem HTTP 2xx com a
    // èxit sempre que no hi hagi una clau d'error explícita.
    let data = {};
    try {
      data = await resp.json();
    } catch (_e) {
      data = {};
    }

    const explicitError =
      data && (data.ok === false || data.success === false || data.error);

    if (!resp.ok || explicitError) {
      const errMsg = (data && (data.error || data.message)) || resp.statusText;
      output.markdown(`❌ Error: \`${errMsg}\``);
      if (data && Object.keys(data).length > 0) {
        output.markdown(`_Resposta sencera:_ \`${JSON.stringify(data)}\``);
      }
    } else {
      output.markdown(`✅ **Draft creat a \`info@reusrefugi.cat\`**`);

      // Si el GAS retorna un URL directe al draft, mostra'l. Si no, fallback
      // a la carpeta Drafts. Només un link, sempre — simplicitat.
      const directDraftUrl =
        (data && (data.draftUrl || data.url || data.link)) || null;

      if (directDraftUrl) {
        output.markdown(`### 📧 [Obrir draft](${directDraftUrl})`);
      } else {
        output.markdown(`### 📂 [Obrir Drafts](${GMAIL_DRAFTS_URL})`);
      }
    }
  }
}
