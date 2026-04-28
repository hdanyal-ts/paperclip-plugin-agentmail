export const PLUGIN_ID = "hdanyal.paperclip-plugin-agentmail";
export const WEBHOOK_KEY = "agentmail-inbound";
export const EXPORT_SETTINGS = "AgentmailSettingsPage";
export const ENTITY_TYPE_MESSAGE = "agentmail.message";
export const ENTITY_TYPE_THREAD = "agentmail.thread";
export const ENTITY_TYPE_BLOG = "agentmail.blog";

/** Scheduled job: periodic unread reconciliation (host cron + interval gate in handler). */
export const JOB_KEY_UNREAD_SYNC = "unread_sync";

export const STATE_NS_SYNC = "agentmail.sync";
export const STATE_KEY_LAST_RUN_AT = "lastUnreadSyncAt";
export const STATE_KEY_LAST_SUMMARY = "lastUnreadSyncSummary";
export const STATE_KEY_SYNC_LOCK = "unreadSyncLock";
export const STATE_NS_SITEMAP = "agentmail.sitemap";

/** Stable plugin-entity key for thread → issue mapping (avoids inbox/thread_id collisions). */
export function threadEntityExternalId(inboxId: string, threadId: string): string {
  return `${inboxId}:${threadId}`;
}

export const TOOL_NAMES = {
  getHandlingContext: "agentmail_get_handling_context",
  listMessages: "agentmail_list_messages",
  getMessage: "agentmail_get_message",
  getThread: "agentmail_get_thread",
  sendMessage: "agentmail_send_message",
  replyToMessage: "agentmail_reply_to_message",
} as const;

export const DEFAULT_AGENTMAIL_API_BASE = "https://api.agentmail.to";

/** AgentMail real-time API WebSocket path (see https://docs.agentmail.to/api-reference/websockets/websockets). */
export const DEFAULT_AGENTMAIL_WS_URL = "wss://ws.agentmail.to/v0";

export const DEFAULT_EXTENSION_DENYLIST = [
  ".exe",
  ".scr",
  ".bat",
  ".cmd",
  ".ps1",
  ".vbs",
  ".hta",
  ".com",
  ".dll",
];
