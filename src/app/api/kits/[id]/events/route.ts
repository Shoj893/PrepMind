import { requireUser, unexpectedErrorResponse } from "@/server/api-helpers";
import { eventQueries, kitQueries } from "@/server/db";
import { isRunning } from "@/server/generation";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Server-Sent Events stream of generation progress. Events are persisted, so
 * a client can connect late (page refresh, second tab) and still receive the
 * full history, then live updates while the run is in flight.
 *
 * Implementation: poll the events table every 700ms and push anything newer
 * than the last seq we sent. Simple, survives in-process background jobs,
 * and needs no shared emitter.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;
    const { id } = await context.params;
    const row = kitQueries.getById(id);
    if (!row || row.user_id !== auth.user.id) {
      return new Response("Not found", { status: 404 });
    }

    const encoder = new TextEncoder();
    let lastSeq = 0;
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        const poll = async () => {
          while (!closed) {
            const events = eventQueries.list(id);
            const fresh = events.filter((e) => e.seq > lastSeq);
            for (const e of fresh) {
              lastSeq = e.seq;
              send({ type: "progress", stage: e.stage, message: e.message, percent: e.percent });
            }
            const current = kitQueries.getById(id);
            const terminal =
              current && ["ready", "failed"].includes(current.status) && !isRunning(id);
            if (terminal) {
              send({
                type: "done",
                status: current!.status,
                error: current!.error ?? undefined,
              });
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 700));
          }
        };
        poll().catch(() => {});
        // Hard stop after 15 minutes to avoid zombie streams.
        setTimeout(() => {
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // already closed
            }
          }
        }, 15 * 60 * 1000);
      },
      cancel() {
        closed = true;
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  } catch (err) {
    return unexpectedErrorResponse(err);
  }
}
