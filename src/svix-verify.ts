import { Webhook } from "svix";

function headerMap(headers: Record<string, string | string[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    out[key] = Array.isArray(v) ? v[0] ?? "" : v;
  }
  return out;
}

/**
 * Verify Svix signature (AgentMail webhooks). Throws on failure.
 */
export function verifyAgentmailWebhook(rawBody: string, headers: Record<string, string | string[]>, secret: string): void {
  const h = headerMap(headers);
  const id = h["svix-id"];
  const timestamp = h["svix-timestamp"];
  const signature = h["svix-signature"];
  if (!id || !timestamp || !signature) {
    throw new Error("Missing Svix headers (svix-id, svix-timestamp, svix-signature)");
  }
  const wh = new Webhook(secret);
  wh.verify(rawBody, {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": signature,
  });
}
