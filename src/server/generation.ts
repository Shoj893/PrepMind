import { createLLMClientFromEnv, LLMError } from "@/core/llm/client";
import { generateKit, type Progress } from "@/core/llm/pipeline";
import { regenHandlers, type RegenSection } from "./regen-runner";
import { validateKit } from "@/core/kit/validate";
import type { Kit } from "@/core/kit/types";
import {
  createFingerprint,
  eventQueries,
  kitQueries,
  type KitRow,
} from "./db";

/**
 * Generation and regeneration run in the background of the same Node process
 * that serves requests. Every progress event is persisted, so a page refresh
 * (or another tab) reconnects via the SSE endpoint and resumes watching. A
 * run that fails halfway leaves the kit in `failed` with the error stored —
 * the draft from earlier phases is kept, and the user can retry.
 *
 * Double-trigger protection: an in-process `running` set keyed by kit id. A
 * second trigger for the same kit is a no-op; a second submission of the same
 * description/company/days by the same user is deduplicated upstream by
 * fingerprint.
 */

const running = new Set<string>();

export type KitStatus =
  | "queued"
  | "generating"
  | "ready"
  | "failed"
  | "regenerating";

export interface CreateKitParams {
  userId: string;
  jd: string;
  companyUrl: string;
  days: number;
}

export interface CreateKitResult {
  kit: KitRow;
  duplicate: boolean;
}

export async function createKit(params: CreateKitParams): Promise<CreateKitResult> {
  const fingerprint = createFingerprint(params.jd, params.companyUrl, params.days);
  const existing = kitQueries.getByFingerprint(params.userId, fingerprint);

  if (existing) {
    if (existing.status === "failed") {
      // Retry the failed generation on the same row.
      resetForRetry(existing.id);
      void runKitGeneration(existing.id, {
        jd: params.jd,
        companyUrl: params.companyUrl,
        days: params.days,
      });
      return { kit: kitQueries.getById(existing.id)!, duplicate: true };
    }
    return { kit: existing, duplicate: true };
  }

  const now = new Date().toISOString();
  const id = `kit_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const row: KitRow = {
    id,
    user_id: params.userId,
    status: "generating",
    stage: "queued",
    title: "New preparation kit",
    company_url: params.companyUrl,
    days: params.days,
    fingerprint,
    payload: null,
    error: null,
    created_at: now,
    updated_at: now,
  };
  kitQueries.insert(row);
  void runKitGeneration(id, {
    jd: params.jd,
    companyUrl: params.companyUrl,
    days: params.days,
  });
  return { kit: row, duplicate: false };
}

function resetForRetry(kitId: string): void {
  eventQueries.deleteForKit(kitId);
  kitQueries.setTaskRunning(kitId, "generating", "queued");
}

export function isRunning(kitId: string): boolean {
  return running.has(kitId);
}

export async function runKitGeneration(
  kitId: string,
  input: { jd: string; companyUrl: string; days: number },
  deps?: { llm?: ReturnType<typeof createLLMClientFromEnv> }
): Promise<void> {
  if (running.has(kitId)) return; // double-trigger guard
  running.add(kitId);
  const startedAt = Date.now();
  let seq = eventQueries.list(kitId).length;

  const record = (progress: Progress) => {
    seq += 1;
    eventQueries.append(kitId, seq, progress.stage, progress.message, progress.percent);
    kitQueries.setStatus(kitId, "generating", progress.stage);
  };

  try {
    const llm = deps?.llm ?? createLLMClientFromEnv();
    record({ stage: "queued", message: "Starting…", percent: 1 });
    const kit = await generateKit(input, { llm, onProgress: record });
    const validation = validateKit(kit);
    if (!validation.ok) {
      throw new Error(`Generated kit failed validation: ${validation.errors.join("; ")}`);
    }
    kitQueries.setPayload(kitId, JSON.stringify(validation.kit), kit.title);
    seq += 1;
    eventQueries.append(kitId, seq, "done", "Kit ready.", 100);
    kitQueries.setStatus(kitId, "ready", "done", null);
  } catch (err) {
    const message =
      err instanceof LLMError
        ? `Generation failed: ${err.message}`
        : `Generation failed: ${(err as Error).message}`;
    seq += 1;
    eventQueries.append(kitId, seq, "error", message, 100);
    kitQueries.setStatus(kitId, "failed", "error", message.slice(0, 1000));
  } finally {
    running.delete(kitId);
    console.log(`[generation] kit ${kitId} finished in ${Date.now() - startedAt}ms`);
  }
}

/** Fire a section regeneration in the background (SSE carries the progress). */
export async function runSectionRegeneration(kitId: string, section: RegenSection): Promise<void> {
  if (running.has(kitId)) {
    throw new Error("A generation or regeneration is already running for this kit.");
  }
  const row = kitQueries.getById(kitId);
  if (!row?.payload) throw new Error("Kit not found or not ready.");
  const kit = JSON.parse(row.payload) as Kit;

  running.add(kitId);
  kitQueries.setTaskRunning(kitId, "regenerating", `regen:${section}`);
  // Fire and forget: the SSE endpoint streams the outcome.
  void (async () => {
    try {
      const llm = createLLMClientFromEnv();
      const updated = await regenHandlers(kit, section, {
        llm,
        onProgress: (p) => {
          const events = eventQueries.list(kitId);
          eventQueries.append(kitId, events.length + 1, p.stage, p.message, p.percent);
        },
      });
      const validation = validateKit(updated);
      if (!validation.ok) {
        throw new Error(`Regenerated kit failed validation: ${validation.errors.join("; ")}`);
      }
      kitQueries.setPayload(kitId, JSON.stringify(validation.kit), validation.kit!.title);
      const events = eventQueries.list(kitId);
      eventQueries.append(kitId, events.length + 1, "done", `Section regenerated.`, 100);
      kitQueries.setStatus(kitId, "ready", "done", null);
    } catch (err) {
      const message = `Regeneration failed: ${(err as Error).message}`;
      const events = eventQueries.list(kitId);
      eventQueries.append(kitId, events.length + 1, "error", message, 100);
      // Keep the previous payload: a failed regeneration loses nothing.
      kitQueries.setStatus(kitId, "ready", "done", message.slice(0, 1000));
    } finally {
      running.delete(kitId);
    }
  })();
}
