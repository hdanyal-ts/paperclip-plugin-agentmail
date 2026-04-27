import type { PluginHttpClient } from "@paperclipai/plugin-sdk";

function enc(s: string): string {
  return encodeURIComponent(s);
}

async function readJson(
  http: PluginHttpClient,
  url: string,
  bearer: string,
  method = "GET",
  body?: string,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearer}`,
    Accept: "application/json",
  };
  if (body !== undefined) headers["content-type"] = "application/json";

  const res = await http.fetch(url, { method, headers, body });
  const text = await res.text();
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`AgentMail ${method} ${url} → ${res.status}: ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`AgentMail returned non-JSON (${url})`);
  }
}

export async function amGetMessage(
  http: PluginHttpClient,
  apiBase: string,
  bearer: string,
  inboxId: string,
  messageId: string,
): Promise<unknown> {
  const url = `${apiBase}/v0/inboxes/${enc(inboxId)}/messages/${enc(messageId)}`;
  return readJson(http, url, bearer);
}

/** GET /v0/inboxes/{inbox_id}/threads/{thread_id} — full thread with messages (ascending by time). */
export async function amGetThread(
  http: PluginHttpClient,
  apiBase: string,
  bearer: string,
  inboxId: string,
  threadId: string,
): Promise<unknown> {
  const url = `${apiBase}/v0/inboxes/${enc(inboxId)}/threads/${enc(threadId)}`;
  return readJson(http, url, bearer);
}

export type AttachmentMeta = {
  attachment_id: string;
  filename?: string;
  size: number;
  content_type?: string;
  download_url: string;
  expires_at: string;
};

export async function amGetAttachmentMeta(
  http: PluginHttpClient,
  apiBase: string,
  bearer: string,
  inboxId: string,
  messageId: string,
  attachmentId: string,
): Promise<AttachmentMeta> {
  const url = `${apiBase}/v0/inboxes/${enc(inboxId)}/messages/${enc(messageId)}/attachments/${enc(attachmentId)}`;
  const json = await readJson(http, url, bearer);
  const o = json as Record<string, unknown>;
  return {
    attachment_id: String(o.attachment_id ?? attachmentId),
    filename: typeof o.filename === "string" ? o.filename : undefined,
    size: typeof o.size === "number" ? o.size : 0,
    content_type: typeof o.content_type === "string" ? o.content_type : undefined,
    download_url: String(o.download_url ?? ""),
    expires_at: String(o.expires_at ?? ""),
  };
}

/** Download bytes from signed `download_url` (may be CDN). */
export async function fetchDownloadBytes(
  http: PluginHttpClient,
  downloadUrl: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const res = await http.fetch(downloadUrl, { method: "GET" });
  if (res.status < 200 || res.status >= 300) {
    const text = await res.text();
    throw new Error(`Attachment download ${res.status}: ${text.slice(0, 200)}`);
  }
  const buf = await res.arrayBuffer();
  const raw = new Uint8Array(buf);
  if (raw.length > maxBytes) {
    throw new Error(`Attachment exceeded maxBytes cap (${raw.length} > ${maxBytes})`);
  }
  return raw;
}

export type ListMessagesQuery = {
  limit?: number;
  page_token?: string;
  /** Filter to messages with these labels, e.g. `["unread"]` */
  labels?: string[];
  /** When true, oldest activity first; useful for catch-up in thread order */
  ascending?: boolean;
  before?: string;
  after?: string;
  include_spam?: boolean;
  include_blocked?: boolean;
  include_trash?: boolean;
};

export async function amListMessages(
  http: PluginHttpClient,
  apiBase: string,
  bearer: string,
  inboxId: string,
  query: ListMessagesQuery,
): Promise<unknown> {
  const q = new URLSearchParams();
  if (query.limit !== undefined) q.set("limit", String(query.limit));
  if (query.page_token) q.set("page_token", query.page_token);
  if (query.labels?.length) {
    for (const label of query.labels) {
      if (label?.trim()) q.append("labels", label.trim());
    }
  }
  if (query.ascending === true) q.set("ascending", "true");
  if (query.ascending === false) q.set("ascending", "false");
  if (query.before) q.set("before", query.before);
  if (query.after) q.set("after", query.after);
  if (query.include_spam === true) q.set("include_spam", "true");
  if (query.include_blocked === true) q.set("include_blocked", "true");
  if (query.include_trash === true) q.set("include_trash", "true");
  const qs = q.toString();
  const url = `${apiBase}/v0/inboxes/${enc(inboxId)}/messages${qs ? `?${qs}` : ""}`;
  return readJson(http, url, bearer);
}

export type UpdateMessageLabelsPayload = {
  add_labels?: string | string[];
  remove_labels?: string | string[];
};

/** PATCH /v0/inboxes/{inbox_id}/messages/{message_id} — add/remove labels (e.g. read / unread). */
export async function amUpdateMessage(
  http: PluginHttpClient,
  apiBase: string,
  bearer: string,
  inboxId: string,
  messageId: string,
  payload: UpdateMessageLabelsPayload,
): Promise<unknown> {
  const url = `${apiBase}/v0/inboxes/${enc(inboxId)}/messages/${enc(messageId)}`;
  const body = JSON.stringify({
    add_labels: payload.add_labels,
    remove_labels: payload.remove_labels,
  });
  return readJson(http, url, bearer, "PATCH", body);
}

export async function amSendMessage(
  http: PluginHttpClient,
  apiBase: string,
  bearer: string,
  inboxId: string,
  payload: { to: string[]; subject: string; text: string; html?: string; cc?: string[] },
): Promise<unknown> {
  const url = `${apiBase}/v0/inboxes/${enc(inboxId)}/messages/send`;
  const body = JSON.stringify({
    to: payload.to,
    cc: payload.cc,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
  return readJson(http, url, bearer, "POST", body);
}

/** POST /v0/inboxes/{inbox_id}/messages/{message_id}/reply — threaded reply (AgentMail OpenAPI). */
export async function amReplyToMessage(
  http: PluginHttpClient,
  apiBase: string,
  bearer: string,
  inboxId: string,
  messageId: string,
  payload: {
    text: string;
    html?: string;
    cc?: string[];
    to?: string | string[];
    reply_all?: boolean;
  },
): Promise<unknown> {
  const url = `${apiBase}/v0/inboxes/${enc(inboxId)}/messages/${enc(messageId)}/reply`;
  const bodyObj: Record<string, unknown> = { text: payload.text };
  if (payload.html !== undefined) bodyObj.html = payload.html;
  if (payload.cc !== undefined) bodyObj.cc = payload.cc;
  if (payload.to !== undefined) bodyObj.to = payload.to;
  if (payload.reply_all !== undefined) bodyObj.reply_all = payload.reply_all;
  const body = JSON.stringify(bodyObj);
  return readJson(http, url, bearer, "POST", body);
}

export async function amGetInbox(
  http: PluginHttpClient,
  apiBase: string,
  bearer: string,
  inboxId: string,
): Promise<unknown> {
  const url = `${apiBase}/v0/inboxes/${enc(inboxId)}`;
  return readJson(http, url, bearer);
}
