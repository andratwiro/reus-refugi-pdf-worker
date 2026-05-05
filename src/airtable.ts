/**
 * Airtable Web API client scoped to the Casos table.
 * Uses field IDs (not names) for stability by default, but can be switched
 * to field names via `opts.byFieldId: false` (used for the Informes
 * de Vulnerabilitat table, whose field IDs aren't yet in code).
 */

const API_BASE = "https://api.airtable.com/v0";
const CONTENT_BASE = "https://content.airtable.com/v0";

export interface AirtableRecord {
  id: string;
  createdTime: string;
  /** Keys are field IDs (starting with fld...) or names, depending on how the record was fetched. */
  fields: Record<string, unknown>;
}

export class AirtableClient {
  constructor(
    private token: string,
    private baseId: string,
  ) {}

  /**
   * fetch + bounded retry on 429 (Airtable rate limit).
   *
   * Airtable enforces 5 req/sec per base; un burst per damunt bloqueja la
   * base 30s via HTTP 429 amb `Retry-After`. Abans esperàvem fins a 30s
   * dins del worker — però Cloudflare Workers tenen ~30s de wall-time, així
   * que aquell sleep mataba tota la request: el client rebia un Cloudflare
   * 524 amb HTML, i `await response.json()` al script d'Airtable petava amb
   * "JSON.parse: unexpected character at line 1 column 1".
   *
   * Ara cappem l'espera a `MAX_RETRY_MS`. Si Airtable demana més temps,
   * deixem que el 429 bubble out i el client (script d'Airtable) reintenti
   * — millor un error JSON clar que un timeout opac.
   */
  private async fetchWithRetry(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const MAX_RETRY_MS = 5000;
    let resp = await fetch(url, init);
    if (resp.status !== 429) return resp;
    const retryAfterRaw = resp.headers.get("Retry-After");
    const retryAfter = retryAfterRaw ? parseInt(retryAfterRaw, 10) : NaN;
    const requestedMs = (Number.isFinite(retryAfter) ? retryAfter : 5) * 1000;
    if (requestedMs > MAX_RETRY_MS) {
      console.warn(
        `Airtable 429 — Retry-After ${requestedMs}ms exceeds cap ${MAX_RETRY_MS}ms; bubbling 429 to client (${url})`,
      );
      return resp;
    }
    console.warn(`Airtable 429 — waiting ${requestedMs}ms before single retry (${url})`);
    await new Promise((r) => setTimeout(r, requestedMs));
    resp = await fetch(url, init);
    return resp;
  }

  /**
   * GET a record by ID. Returns field values keyed by field ID by default
   * (so our code is stable against renames). Pass `{ byFieldId: false }`
   * to get fields keyed by name instead (used for tables where we don't
   * have field IDs hard-coded yet).
   */
  async getRecord(
    tableId: string,
    recordId: string,
    opts: { byFieldId?: boolean } = {},
  ): Promise<AirtableRecord> {
    const byFieldId = opts.byFieldId !== false;
    const params = byFieldId ? "?returnFieldsByFieldId=true" : "";
    const url = `${API_BASE}/${this.baseId}/${tableId}/${recordId}${params}`;
    const resp = await this.fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Airtable getRecord failed: ${resp.status} ${body}`);
    }
    return (await resp.json()) as AirtableRecord;
  }

  /**
   * Batch fetch multiple records by IDs. Used to resolve linked-record fields
   * (e.g. `Casos vinculats` pointing to dependent cases).
   *
   * Executed as parallel single-record fetches — simpler than the filterByFormula
   * approach and fast enough for family sizes (typically 2–5 members).
   */
  async getRecords(
    tableId: string,
    recordIds: string[],
  ): Promise<AirtableRecord[]> {
    if (recordIds.length === 0) return [];
    return Promise.all(recordIds.map((id) => this.getRecord(tableId, id)));
  }

  /**
   * List records from a table, optionally with a filterByFormula.
   * Auto-paginates fins a `maxRecords` (default 200, suficient per Reus Refugi).
   */
  async listRecords(
    tableId: string,
    opts: {
      byFieldId?: boolean;
      filterByFormula?: string;
      fields?: string[];
      maxRecords?: number;
      pageSize?: number;
    } = {},
  ): Promise<AirtableRecord[]> {
    const byFieldId = opts.byFieldId !== false;
    const maxRecords = opts.maxRecords ?? 200;
    const pageSize = opts.pageSize ?? 100;

    const out: AirtableRecord[] = [];
    let offset: string | undefined;
    do {
      const params = new URLSearchParams();
      if (byFieldId) params.set("returnFieldsByFieldId", "true");
      if (opts.filterByFormula) params.set("filterByFormula", opts.filterByFormula);
      if (opts.fields) for (const f of opts.fields) params.append("fields[]", f);
      params.set("pageSize", String(pageSize));
      if (offset) params.set("offset", offset);

      const url = `${API_BASE}/${this.baseId}/${tableId}?${params}`;
      const resp = await this.fetchWithRetry(url, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Airtable listRecords failed: ${resp.status} ${body}`);
      }
      const page = (await resp.json()) as { records: AirtableRecord[]; offset?: string };
      out.push(...page.records);
      offset = page.offset;
      if (out.length >= maxRecords) break;
    } while (offset);

    return out.slice(0, maxRecords);
  }

  /**
   * Upload a binary attachment directly to a record's attachment field.
   * Uses the content.airtable.com upload endpoint that accepts base64.
   * No external hosting needed.
   *
   * https://airtable.com/developers/web/api/upload-attachment
   */
  async uploadAttachment(params: {
    recordId: string;
    fieldIdOrName: string;
    filename: string;
    contentType: string;
    bytes: Uint8Array;
  }): Promise<AirtableRecord> {
    const { recordId, fieldIdOrName, filename, contentType, bytes } = params;
    const url = `${CONTENT_BASE}/${this.baseId}/${recordId}/${fieldIdOrName}/uploadAttachment`;

    const base64 = uint8ArrayToBase64(bytes);

    const resp = await this.fetchWithRetry(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contentType,
        file: base64,
        filename,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Airtable uploadAttachment failed: ${resp.status} ${body}`);
    }
    return (await resp.json()) as AirtableRecord;
  }

  /**
   * PATCH multiple fields on a record in a single API call.
   * Used by /anexo2 to clear the attachment field AND set the timestamp
   * in one request — saves an Airtable API call against the 5 req/sec
   * per-base limit.
   */
  async updateFields(
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    const url = `${API_BASE}/${this.baseId}/${tableId}/${recordId}`;
    const resp = await this.fetchWithRetry(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Airtable updateFields failed: ${resp.status} ${body}`);
    }
  }

  /** Clear an attachment field. Thin wrapper around updateFields. */
  async clearAttachmentField(
    tableId: string,
    recordId: string,
    fieldIdOrName: string,
  ): Promise<void> {
    await this.updateFields(tableId, recordId, { [fieldIdOrName]: [] });
  }

  /** PATCH a single field. Thin wrapper around updateFields. */
  async updateField(
    tableId: string,
    recordId: string,
    fieldIdOrName: string,
    value: unknown,
  ): Promise<void> {
    await this.updateFields(tableId, recordId, { [fieldIdOrName]: value });
  }
}

/**
 * Convert a Uint8Array to base64 without blowing up the stack on big buffers.
 * Workers have `btoa` but not Buffer.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000; // 32KB chunks
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
