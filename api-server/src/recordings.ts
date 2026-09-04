// recordings.ts — the one place the API asks for call audio to be deleted.
//
// R2 credentials and boto3 live in the voice-pipeline container, so deletion
// is a call to its /api/v1/recording/purge endpoint rather than an S3 client
// here. Two callers share this: the retention job (jobs/scheduler.ts) and the
// self-serve "Delete recording" route in index.ts. Both must follow the same
// rule — forget the key on the call row only AFTER R2 confirmed, because a
// row that forgets its key while the object survives is an orphan nobody can
// ever delete.
const PIPELINE_URL = process.env.PIPELINE_URL || "http://127.0.0.1:8000";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "";

export interface PurgeResult {
  ok: boolean;          // false when the pipeline refused or was unreachable
  deleted: number;
  errors: string[];     // keys R2 reported it could not delete
  status?: number;      // pipeline HTTP status, for logs
}

export async function purgeRecordings(keys: string[]): Promise<PurgeResult> {
  const concrete = keys.filter(k => typeof k === "string" && k.length > 0);
  if (!concrete.length) return { ok: true, deleted: 0, errors: [] };
  try {
    const r = await fetch(`${PIPELINE_URL}/api/v1/recording/purge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": INTERNAL_SECRET },
      body: JSON.stringify({ keys: concrete }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) return { ok: false, deleted: 0, errors: concrete, status: r.status };
    const body = await r.json().catch(() => ({})) as { deleted?: number; errors?: string[] };
    return { ok: true, deleted: body.deleted ?? 0, errors: body.errors || [], status: r.status };
  } catch (e: any) {
    console.error("[recordings] purge failed:", e.message);
    return { ok: false, deleted: 0, errors: concrete };
  }
}

// Columns a call row carries about its audio. recording_url is the legacy
// public-URL column from the first schema; r2_object_key/recording_path are
// what the player and the retention job actually read.
export const RECORDING_COLUMNS_CLEARED = {
  r2_object_key:  null,
  recording_path: null,
  recording_url:  null,
} as const;
