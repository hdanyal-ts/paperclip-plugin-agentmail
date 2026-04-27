/** Normalized attachment from webhook or API message payload. */
export type NormalizedAttachment = {
  attachment_id: string;
  filename?: string;
  size: number;
  content_type?: string;
};

/** Parsed AgentMail `message.received` envelope (see AgentMail docs). */
export type MessageReceivedEvent = {
  eventId: string;
  message: {
    inbox_id: string;
    thread_id: string;
    message_id: string;
    labels: string[];
    from: string;
    to: string[];
    cc?: string[];
    subject?: string;
    text?: string;
    html?: string;
    attachments?: NormalizedAttachment[];
    /** AgentMail message_id this message replies to (optional). */
    in_reply_to?: string;
    /** Prior message ids in thread (optional). */
    references?: string[];
  };
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function attachmentIdFromRecord(o: Record<string, unknown>): string {
  const raw = o.attachment_id ?? o.id ?? o.attachmentId;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return "";
}

function normalizeAttachments(raw: unknown): NormalizedAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: NormalizedAttachment[] = [];
  for (const item of raw) {
    const o = asRecord(item);
    if (!o) continue;
    const id = attachmentIdFromRecord(o);
    const size = typeof o.size === "number" ? o.size : 0;
    if (!id) continue;
    out.push({
      attachment_id: id,
      filename: typeof o.filename === "string" ? o.filename : undefined,
      size,
      content_type: typeof o.content_type === "string" ? o.content_type : undefined,
    });
  }
  return out;
}

/** Extract message object from webhook JSON (handles optional Svix-style wrapping). */
export function parseWebhookEnvelope(parsedBody: unknown): MessageReceivedEvent | null {
  const root = asRecord(parsedBody);
  if (!root) return null;

  const data = asRecord(root.data);
  const inner = data ?? root;

  const eventType = inner.event_type;
  if (eventType !== "message.received") return null;

  const eventId = typeof inner.event_id === "string" ? inner.event_id : "";
  const msg = asRecord(inner.message);
  if (!eventId || !msg) return null;

  const inbox_id = typeof msg.inbox_id === "string" ? msg.inbox_id : "";
  const thread_id = typeof msg.thread_id === "string" ? msg.thread_id : "";
  const message_id = typeof msg.message_id === "string" ? msg.message_id : "";
  if (!inbox_id || !thread_id || !message_id) return null;

  const labels = Array.isArray(msg.labels) ? msg.labels.filter((x): x is string => typeof x === "string") : [];
  const to = Array.isArray(msg.to) ? msg.to.filter((x): x is string => typeof x === "string") : [];
  const cc = Array.isArray(msg.cc) ? msg.cc.filter((x): x is string => typeof x === "string") : undefined;

  const inReplyRaw = msg.in_reply_to;
  const in_reply_to =
    typeof inReplyRaw === "string" && inReplyRaw.trim() ? inReplyRaw.trim() : undefined;
  const refRaw = msg.references;
  const references = Array.isArray(refRaw)
    ? refRaw
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter((x) => x.length > 0)
    : undefined;

  return {
    eventId,
    message: {
      inbox_id,
      thread_id,
      message_id,
      labels,
      from: typeof msg.from === "string" ? msg.from : "",
      to,
      cc,
      subject: typeof msg.subject === "string" ? msg.subject : undefined,
      text: typeof msg.text === "string" ? msg.text : undefined,
      html: typeof msg.html === "string" ? msg.html : undefined,
      attachments: normalizeAttachments(msg.attachments),
      ...(in_reply_to ? { in_reply_to } : {}),
      ...(references?.length ? { references } : {}),
    },
  };
}

/** `in_reply_to` / `references` from AgentMail GET message JSON (for WebSocket parity). */
export function replyGraphFromApiMessage(apiMessage: unknown): {
  in_reply_to?: string;
  references?: string[];
} {
  const m = asRecord(apiMessage);
  if (!m) return {};
  const inReplyRaw = m.in_reply_to;
  const in_reply_to =
    typeof inReplyRaw === "string" && inReplyRaw.trim() ? inReplyRaw.trim() : undefined;
  const refRaw = m.references;
  const references = Array.isArray(refRaw)
    ? refRaw
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter((x) => x.length > 0)
    : undefined;
  return {
    ...(in_reply_to ? { in_reply_to } : {}),
    ...(references?.length ? { references } : {}),
  };
}

/** Map GET message API JSON to the same attachment shape as the webhook. */
export function attachmentsFromApiMessage(apiMessage: unknown): NormalizedAttachment[] {
  const m = asRecord(apiMessage);
  if (!m) return [];
  return normalizeAttachments(m.attachments);
}
