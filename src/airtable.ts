/**
 * Airtable Web API client scoped to the Casos table.
 * Uses field IDs (not names) for stability.
 */

const API_BASE = "https://api.airtable.com/v0";
const CONTENT_BASE = "https://content.airtable.com/v0";

export interface AirtableRecord {
  id: string;
  createdTime: string;
  /** Keys are field IDs (starting with fld...), values are field values. */
  fields: Record<string, unknown>;
}

export class AirtableClient {
  constructor(
    private token: string,
    private baseId: string,
  ) {}

  /**
   * GET a record by ID. Returns field values keyed by field ID.
   * Using returnFieldsByFieldId=true so our code is stable against renames.
   */
  async getRecord(tableId: string, recordId: string): Promise<AirtableRecord> {
    const url = `${API_BASE}/${this.baseId}/${tableId}/${recordId}?returnFieldsByFieldId=true`;
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
