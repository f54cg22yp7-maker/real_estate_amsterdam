// Receives alert emails from the Gmail script (intake/gmail_to_pand.gs), pulls out the move.nl
// listing links and queues them for the scheduled job. Email bodies are not stored.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_RE = /https:\/\/move\.nl\/exchange-object\/([A-Za-z0-9_-]+)/g;

function objectId(token: string): string | null {
  try {
    const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const m = decoded.match(/^ExchangeObject:(\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const secret = Deno.env.get("INGEST_SECRET");
  if (!secret || req.headers.get("x-ingest-secret") !== secret) return json({ error: "forbidden" }, 403);

  let messages: Array<{ received_at?: string; body?: string; html?: string }> = [];
  try {
    messages = (await req.json()).messages ?? [];
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const rows = new Map<string, { id: string; url: string; email_date: string | null }>();
  for (const m of messages) {
    for (const hit of `${m.body ?? ""}\n${m.html ?? ""}`.matchAll(URL_RE)) {
      const id = objectId(hit[1]);
      if (id && !rows.has(id)) {
        rows.set(id, { id, url: `https://move.nl/exchange-object/${hit[1]}/overzicht`, email_date: m.received_at ?? null });
      }
    }
  }

  if (rows.size) {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error } = await sb.from("intake_queue").upsert([...rows.values()], { onConflict: "id", ignoreDuplicates: true });
    if (error) return json({ error: error.message }, 500);
  }
  return json({ messages: messages.length, listings: rows.size });
});
