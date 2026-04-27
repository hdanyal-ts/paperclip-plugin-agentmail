import {
  DEFAULT_AGENTMAIL_API_BASE,
  DEFAULT_AGENTMAIL_WS_URL,
  DEFAULT_EXTENSION_DENYLIST,
} from "./constants.js";

export type MailboxAssignment = {
  agentId: string;
  handlingInstructions?: string;
  recipientMatch?: string;
};

export type MailboxConfig = {
  inboxId: string;
  /** Raw AgentMail inbox API key (`am_…`). Not a Paperclip secret reference. */
  inboxApiKey: string;
  displayName?: string;
  assignments: MailboxAssignment[];
};

export type AttachmentPolicy = {
  maxCount?: number;
  maxBytesPerFile?: number;
  maxTotalBytes?: number;
  /** Skip storing document bodies larger than this (still records comment). */
  maxInlineDocumentBytes?: number;
  mimeAllowList?: string[];
  mimeDenyList?: string[];
  extensionDenyList?: string[];
  /** Lowercase label substrings; default skips spam-like labels. */
  skipIfLabels?: string[];
};

/** How inbound mail events reach the worker. Default `webhook`. */
export type EventDeliveryMode = "webhook" | "websocket" | "both";

export function normalizeEventDelivery(v: unknown): EventDeliveryMode {
  if (v === "websocket" || v === "both" || v === "webhook") return v;
  return "webhook";
}

export function needsWebhookSecret(mode: EventDeliveryMode): boolean {
  return mode === "webhook" || mode === "both";
}

export function usesWebsocketDelivery(mode: EventDeliveryMode): boolean {
  return mode === "websocket" || mode === "both";
}

export type BlogDedupeConfig = {
  enabled: boolean;
  sitemapUrls: string[];
  markReadOnDuplicate: boolean;
  createIssueForDuplicate: boolean;
  sitemapTtlMs: number;
  maxExtractBytes: number;
  maxExtractTextChars: number;
};

const DEFAULT_BLOG_DEDUPE: BlogDedupeConfig = {
  enabled: false,
  sitemapUrls: [],
  markReadOnDuplicate: true,
  createIssueForDuplicate: false,
  sitemapTtlMs: 6 * 60 * 60 * 1000,
  maxExtractBytes: 15 * 1024 * 1024,
  maxExtractTextChars: 500_000,
};

export function parseBlogDedupe(raw: unknown): BlogDedupeConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_BLOG_DEDUPE };
  const o = raw as Record<string, unknown>;
  const sitemapUrls = Array.isArray(o.sitemapUrls)
    ? o.sitemapUrls.filter((u): u is string => typeof u === "string" && u.trim().length > 0).map((u) => u.trim())
    : [];
  return {
    enabled: o.enabled === true,
    sitemapUrls,
    markReadOnDuplicate: o.markReadOnDuplicate !== false,
    createIssueForDuplicate: o.createIssueForDuplicate === true,
    sitemapTtlMs:
      typeof o.sitemapTtlMs === "number" && o.sitemapTtlMs >= 60_000 ? o.sitemapTtlMs : DEFAULT_BLOG_DEDUPE.sitemapTtlMs,
    maxExtractBytes:
      typeof o.maxExtractBytes === "number" && o.maxExtractBytes > 0
        ? o.maxExtractBytes
        : DEFAULT_BLOG_DEDUPE.maxExtractBytes,
    maxExtractTextChars:
      typeof o.maxExtractTextChars === "number" && o.maxExtractTextChars > 0
        ? o.maxExtractTextChars
        : DEFAULT_BLOG_DEDUPE.maxExtractTextChars,
  };
}

export type AgentmailPluginConfig = {
  companyId: string;
  projectId?: string;
  agentmailApiBase?: string;
  /** Required when `eventDelivery` is `webhook` or `both`; may be empty for `websocket`-only. */
  agentmailWebhookSecretRef: string;
  /** Default `webhook`. WebSocket uses outbound connections to AgentMail (no public HTTP URL). */
  eventDelivery: EventDeliveryMode;
  /** WebSocket endpoint including path, e.g. `wss://ws.agentmail.to/v0`. */
  agentmailWebsocketUrl: string;
  titlePrefix?: string;
  descriptionMaxLength?: number;
  mailboxes: MailboxConfig[];
  attachmentPolicy?: AttachmentPolicy;
  /** Reconcile AgentMail `unread` on startup and on an interval. */
  unreadSyncOnStartup: boolean;
  unreadSyncIntervalSeconds: number;
  unreadSyncMaxPerRun: number;
  blogDedupe: BlogDedupeConfig;
};

const DEFAULT_ATTACHMENT: Required<
  Pick<AttachmentPolicy, "maxCount" | "maxBytesPerFile" | "maxTotalBytes" | "maxInlineDocumentBytes">
> & { skipIfLabels: string[] } = {
  maxCount: 25,
  maxBytesPerFile: 15 * 1024 * 1024,
  maxTotalBytes: 80 * 1024 * 1024,
  maxInlineDocumentBytes: 2 * 1024 * 1024,
  skipIfLabels: ["spam"],
};

export function resolvedAttachmentPolicy(policy: AttachmentPolicy | undefined): {
  maxCount: number;
  maxBytesPerFile: number;
  maxTotalBytes: number;
  maxInlineDocumentBytes: number;
  mimeAllowList?: string[];
  mimeDenyList?: string[];
  extensionDenyList: string[];
  skipIfLabels: string[];
} {
  return {
    maxCount: policy?.maxCount ?? DEFAULT_ATTACHMENT.maxCount,
    maxBytesPerFile: policy?.maxBytesPerFile ?? DEFAULT_ATTACHMENT.maxBytesPerFile,
    maxTotalBytes: policy?.maxTotalBytes ?? DEFAULT_ATTACHMENT.maxTotalBytes,
    maxInlineDocumentBytes: policy?.maxInlineDocumentBytes ?? DEFAULT_ATTACHMENT.maxInlineDocumentBytes,
    mimeAllowList: policy?.mimeAllowList,
    mimeDenyList: policy?.mimeDenyList,
    extensionDenyList:
      policy?.extensionDenyList !== undefined
        ? policy.extensionDenyList
        : [...DEFAULT_EXTENSION_DENYLIST],
    skipIfLabels:
      policy?.skipIfLabels !== undefined
        ? [...policy.skipIfLabels]
        : [...DEFAULT_ATTACHMENT.skipIfLabels],
  };
}

export function parseConfig(raw: Record<string, unknown>): AgentmailPluginConfig | null {
  const companyId = typeof raw.companyId === "string" ? raw.companyId.trim() : "";
  if (!companyId) return null;

  const eventDelivery = normalizeEventDelivery(raw.eventDelivery);
  const agentmailWebhookSecretRef =
    typeof raw.agentmailWebhookSecretRef === "string" ? raw.agentmailWebhookSecretRef.trim() : "";
  if (needsWebhookSecret(eventDelivery) && !agentmailWebhookSecretRef) return null;

  let agentmailWebsocketUrl = DEFAULT_AGENTMAIL_WS_URL;
  if (typeof raw.agentmailWebsocketUrl === "string" && raw.agentmailWebsocketUrl.trim()) {
    agentmailWebsocketUrl = raw.agentmailWebsocketUrl.trim().replace(/\/$/, "");
  }

  const mailboxesRaw = raw.mailboxes;
  if (!Array.isArray(mailboxesRaw) || mailboxesRaw.length === 0) return null;

  const mailboxes: MailboxConfig[] = [];
  for (const row of mailboxesRaw) {
    if (!row || typeof row !== "object") continue;
    const m = row as Record<string, unknown>;
    const inboxId = typeof m.inboxId === "string" ? m.inboxId.trim() : "";
    const inboxApiKeyRaw =
      (typeof m.inboxApiKey === "string" ? m.inboxApiKey.trim() : "") ||
      (typeof m.apiKeySecretRef === "string" ? m.apiKeySecretRef.trim() : "");
    if (!inboxId || !inboxApiKeyRaw) continue;

    const assignmentsRaw = m.assignments;
    if (!Array.isArray(assignmentsRaw) || assignmentsRaw.length === 0) continue;

    const assignments: MailboxAssignment[] = [];
    for (const a of assignmentsRaw) {
      if (!a || typeof a !== "object") continue;
      const ar = a as Record<string, unknown>;
      const agentId = typeof ar.agentId === "string" ? ar.agentId.trim() : "";
      if (!agentId) continue;
      assignments.push({
        agentId,
        handlingInstructions:
          typeof ar.handlingInstructions === "string" ? ar.handlingInstructions : undefined,
        recipientMatch: typeof ar.recipientMatch === "string" ? ar.recipientMatch.trim() : undefined,
      });
    }
    if (assignments.length === 0) continue;

    mailboxes.push({
      inboxId,
      inboxApiKey: inboxApiKeyRaw,
      displayName: typeof m.displayName === "string" ? m.displayName : undefined,
      assignments,
    });
  }

  if (mailboxes.length === 0) return null;

  const attachmentPolicy =
    raw.attachmentPolicy && typeof raw.attachmentPolicy === "object"
      ? (raw.attachmentPolicy as AttachmentPolicy)
      : undefined;

  const unreadSyncOnStartup = raw.unreadSyncOnStartup !== false;
  const unreadSyncIntervalSecondsRaw = raw.unreadSyncIntervalSeconds;
  const unreadSyncIntervalSeconds =
    typeof unreadSyncIntervalSecondsRaw === "number" && unreadSyncIntervalSecondsRaw >= 0
      ? Math.min(unreadSyncIntervalSecondsRaw, 24 * 60 * 60)
      : 300;
  const unreadSyncMaxPerRunRaw = raw.unreadSyncMaxPerRun;
  const unreadSyncMaxPerRun =
    typeof unreadSyncMaxPerRunRaw === "number" && unreadSyncMaxPerRunRaw > 0
      ? Math.min(unreadSyncMaxPerRunRaw, 500)
      : 50;

  return {
    companyId,
    projectId: typeof raw.projectId === "string" ? raw.projectId.trim() || undefined : undefined,
    agentmailApiBase:
      typeof raw.agentmailApiBase === "string" && raw.agentmailApiBase.trim()
        ? raw.agentmailApiBase.trim().replace(/\/$/, "")
        : DEFAULT_AGENTMAIL_API_BASE,
    agentmailWebhookSecretRef,
    eventDelivery,
    agentmailWebsocketUrl,
    titlePrefix: typeof raw.titlePrefix === "string" ? raw.titlePrefix : undefined,
    descriptionMaxLength:
      typeof raw.descriptionMaxLength === "number" && raw.descriptionMaxLength > 0
        ? raw.descriptionMaxLength
        : 50_000,
    mailboxes,
    attachmentPolicy,
    unreadSyncOnStartup,
    unreadSyncIntervalSeconds,
    unreadSyncMaxPerRun,
    blogDedupe: parseBlogDedupe(raw.blogDedupe),
  };
}

export function validateMailboxShape(cfg: AgentmailPluginConfig): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const inboxIds = new Set<string>();
  const agentIds = new Set<string>();

  for (const mb of cfg.mailboxes) {
    if (inboxIds.has(mb.inboxId)) errors.push(`Duplicate inboxId: ${mb.inboxId}`);
    inboxIds.add(mb.inboxId);
    if (mb.assignments.length > 1) {
      for (const a of mb.assignments) {
        if (!a.recipientMatch?.trim()) {
          errors.push(
            `Mailbox ${mb.inboxId}: multiple assignments require recipientMatch on each row`,
          );
          break;
        }
      }
    }
    for (const a of mb.assignments) {
      if (agentIds.has(a.agentId)) errors.push(`Duplicate agentId across mailboxes: ${a.agentId}`);
      agentIds.add(a.agentId);
    }
  }

  return { ok: errors.length === 0, errors };
}
