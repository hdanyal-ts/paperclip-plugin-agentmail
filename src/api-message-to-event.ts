import type { MessageReceivedEvent } from "./parse-webhook.js";
import { attachmentsFromApiMessage, replyGraphFromApiMessage } from "./parse-webhook.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Map AgentMail `GET /v0/inboxes/{inbox_id}/messages/{message_id}` JSON to the same
 * shape as a `message.received` webhook, for catch-up and polling.
 */
export function messageFromApiToEvent(
  apiMessage: unknown,
  eventId: string,
): MessageReceivedEvent | null {
  const m = asRecord(apiMessage);
  if (!m) return null;
  const inbox_id = typeof m.inbox_id === "string" ? m.inbox_id : "";
  const thread_id = typeof m.thread_id === "string" ? m.thread_id : "";
  const message_id = typeof m.message_id === "string" ? m.message_id : "";
  if (!inbox_id || !thread_id || !message_id) return null;
  if (!eventId.trim()) return null;

  const labels = Array.isArray(m.labels) ? m.labels.filter((x): x is string => typeof x === "string") : [];
  const to = Array.isArray(m.to) ? m.to.filter((x): x is string => typeof x === "string") : [];
  const cc = Array.isArray(m.cc) ? m.cc.filter((x): x is string => typeof x === "string") : undefined;

  const extra = replyGraphFromApiMessage(apiMessage);

  return {
    eventId,
    message: {
      inbox_id,
      thread_id,
      message_id,
      labels,
      from: typeof m.from === "string" ? m.from : "",
      to,
      cc,
      subject: typeof m.subject === "string" ? m.subject : undefined,
      text: typeof m.text === "string" ? m.text : undefined,
      html: typeof m.html === "string" ? m.html : undefined,
      attachments: attachmentsFromApiMessage(apiMessage),
      ...(extra.in_reply_to ? { in_reply_to: extra.in_reply_to } : {}),
      ...(extra.references?.length ? { references: extra.references } : {}),
    },
  };
}

export type ListMessagesItem = {
  inbox_id: string;
  thread_id: string;
  message_id: string;
};

/** Parse a row from `GET .../messages` list response. */
export function listItemFromApi(m: unknown): ListMessagesItem | null {
  const o = asRecord(m);
  if (!o) return null;
  const inbox_id = typeof o.inbox_id === "string" ? o.inbox_id : "";
  const thread_id = typeof o.thread_id === "string" ? o.thread_id : "";
  const message_id = typeof o.message_id === "string" ? o.message_id : "";
  if (!inbox_id || !thread_id || !message_id) return null;
  return { inbox_id, thread_id, message_id };
}

export function listMessagesResponseIds(body: unknown): { messages: ListMessagesItem[]; nextPageToken: string | null } {
  const o = asRecord(body);
  if (!o) return { messages: [], nextPageToken: null };
  const raw = o.messages;
  const next =
    typeof o.next_page_token === "string" && o.next_page_token.trim() ? o.next_page_token.trim() : null;
  if (!Array.isArray(raw)) return { messages: [], nextPageToken: next };
  const messages: ListMessagesItem[] = [];
  for (const item of raw) {
    const row = listItemFromApi(item);
    if (row) messages.push(row);
  }
  return { messages, nextPageToken: next };
}
