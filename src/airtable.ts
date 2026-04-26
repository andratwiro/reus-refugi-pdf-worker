/**
 * Airtable Web API client scoped to the Casos table.
 * Uses field IDs (not names) for stability by default, but can be switched
 * to field names via `opts.byFieldId: false` (used for the Informes
 * Vulnerabilitat Express table, whose field IDs aren't yet in code).
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
    const resp = await fetch(url, {
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
      const resp = await fetch(url, {
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

    const resp = await fetch(url, {
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
   * Clear an attachment field before uploading (so we get "replace" semantics
   * instead of accumulating versions). This is the user-requested Opció A.
   */
  async clearAttachmentField(
    tableId: string,
    recordId: string,
    fieldIdOrName: string,
  ): Promise<void> {
    const url = `${API_BASE}/${this.baseId}/${tableId}/${recordId}`;
    const resp = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: { [fieldIdOrName]: [] },
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Airtable clearAttachment failed: ${resp.status} ${body}`);
    }
  }

  /**
   * PATCH a single field on a record.
   * Used for timestamps (e.g. "Generat el" on the Anexo II flow).
   */
  async updateField(
    tableId: string,
    recordId: string,
    fieldIdOrName: string,
    value: unknown,
  ): Promise<void> {
    const url = `${API_BASE}/${this.baseId}/${tableId}/${recordId}`;
    const resp = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: { [fieldIdOrName]: value },
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Airtable updateField failed: ${resp.status} ${body}`);
    }
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
