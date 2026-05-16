import { PDFDocument } from "pdf-lib";

export interface MergeInput {
  bytes: Uint8Array;
  filename: string;
  mimetype: string;
}

export class UnsupportedFormatError extends Error {
  constructor(public filename: string, message: string) {
    super(message);
    this.name = "UnsupportedFormatError";
  }
}

type Kind = "pdf" | "jpg" | "png" | "heic" | "other";

function ext(filename: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename || "");
  return m ? m[1].toLowerCase() : "";
}

function detectKind(input: MergeInput): Kind {
  const t = (input.mimetype || "").toLowerCase();
  const e = ext(input.filename);
  if (/pdf/.test(t) || e === "pdf") return "pdf";
  if (/jpe?g/.test(t) || e === "jpg" || e === "jpeg") return "jpg";
  if (/png/.test(t) || e === "png") return "png";
  if (/heic|heif/.test(t) || e === "heic" || e === "heif") return "heic";
  return "other";
}

// A4 en punts (72 dpi). Orientació segons relació d'aspecte de la imatge per
// evitar marges enormes amb fotos en horitzontal (carnets, contractes, etc.).
function pageDimsForImage(imgW: number, imgH: number): [number, number] {
  return imgW > imgH ? [842, 595] : [595, 842];
}

function aspectFit(imgW: number, imgH: number, pageW: number, pageH: number) {
  const scale = Math.min(pageW / imgW, pageH / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  return { x: (pageW - w) / 2, y: (pageH - h) / 2, w, h };
}

/**
 * Fusiona N adjunts (PDF, JPG o PNG) en un únic PDF. Manté l'ordre rebut.
 *
 * Pre-flight: si algun adjunt és HEIC/HEIF o format no suportat, llença
 * UnsupportedFormatError abans de processar res — així el missatge identifica
 * exactament quin fitxer s'ha de substituir.
 */
export async function mergeToPdf(inputs: MergeInput[]): Promise<Uint8Array> {
  if (inputs.length === 0) {
    throw new Error("mergeToPdf: no inputs");
  }

  for (const i of inputs) {
    const k = detectKind(i);
    if (k === "heic") {
      throw new UnsupportedFormatError(
        i.filename,
        `Format HEIC/HEIF no suportat (${i.filename}). Converteix-lo a JPG o PDF abans de pujar-lo a Airtable.`,
      );
    }
    if (k === "other") {
      throw new UnsupportedFormatError(
        i.filename,
        `Format no suportat per fusió (${i.filename}, type=${i.mimetype || "desconegut"}). Acceptem PDF, JPG i PNG.`,
      );
    }
  }

  const merged = await PDFDocument.create();

  for (const input of inputs) {
    const k = detectKind(input);
    if (k === "pdf") {
      const src = await PDFDocument.load(input.bytes, { ignoreEncryption: true });
      const pages = await merged.copyPages(src, src.getPageIndices());
      for (const p of pages) merged.addPage(p);
    } else if (k === "jpg" || k === "png") {
      const img = k === "jpg"
        ? await merged.embedJpg(input.bytes)
        : await merged.embedPng(input.bytes);
      const [pageW, pageH] = pageDimsForImage(img.width, img.height);
      const fit = aspectFit(img.width, img.height, pageW, pageH);
      const page = merged.addPage([pageW, pageH]);
      page.drawImage(img, { x: fit.x, y: fit.y, width: fit.w, height: fit.h });
    }
  }

  return await merged.save();
}

/** Compta les pàgines d'un PDF ja generat (per surfaçar-ho al voluntari). */
export async function countPdfPages(bytes: Uint8Array): Promise<number> {
  const d = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return d.getPageCount();
}
