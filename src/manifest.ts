import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import {
  DEFAULT_AGENTMAIL_API_BASE,
  DEFAULT_AGENTMAIL_WS_URL,
  EXPORT_SETTINGS,
  JOB_KEY_UNREAD_SYNC,
  PLUGIN_ID,
  TOOL_NAMES,
  WEBHOOK_KEY,
} from "./constants.js";
import { PLUGIN_VERSION } from "./version.js";

const assignmentItemSchema = {
  type: "object",
  properties: {
    agentId: { type: "string", title: "Agent ID", description: "Paperclip agent UUID (assignee)" },
    handlingInstructions: {
      type: "string",
      title: "Handling instructions",
      description: "Short operator notes injected into the issue (optional).",
    },
    recipientMatch: {
      type: "string",
      title: "Recipient match",
      description:
        "When multiple agents share this inbox: case-insensitive substring matched against To/Cc (required for each row).",
    },
  },
  required: ["agentId"],
  additionalProperties: false,
} as const;

const mailboxItemSchema = {
  type: "object",
  properties: {
    inboxId: {
      type: "string",
      title: "Inbox ID",
      description: "AgentMail inbox address (e.g. support@yourdomain.com).",
    },
    inboxApiKey: {
      type: "string",
      format: "password",
      title: "Inbox API key",
      description: "Raw AgentMail inbox API key (am_…). Stored in plugin instance config.",
    },
    /** @deprecated Prefer `inboxApiKey`. If `inboxApiKey` is absent, this value is read as the raw inbox key. */
    apiKeySecretRef: {
      type: "string",
      format: "password",
      title: "Inbox API key (legacy key name)",
      description: "Deprecated field name; same semantics as inboxApiKey (raw am_… key).",
    },
    displayName: { type: "string", title: "Display name (optional)" },
    assignments: {
      type: "array",
      title: "Agent assignments",
      items: assignmentItemSchema,
      minItems: 1,
    },
  },
  required: ["inboxId", "assignments"],
  additionalProperties: false,
} as const;

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "AgentMail Paperclip",
  description:
    "Creates Paperclip issues from AgentMail inbound email (message.received via webhook and/or WebSocket) with attachments on the issue. Agents use REST tools with inbox-scoped keys.",
  author: "hdanyal",
  categories: ["connector", "automation"],
  capabilities: [
    "companies.read",
    "projects.read",
    "issues.read",
    "issues.create",
    "issues.update",
    "issue.comments.create",
    "issue.documents.write",
    "activity.log.write",
    "webhooks.receive",
    "http.outbound",
    "secrets.read-ref",
    "agents.read",
    "agent.tools.register",
    "instance.settings.register",
    "ui.action.register",
    "jobs.schedule",
    "plugin.state.read",
    "plugin.state.write",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  jobs: [
    {
      jobKey: JOB_KEY_UNREAD_SYNC,
      displayName: "Unread mail reconciliation",
      description:
        "Lists unread messages per mailbox, ingests any missed while Paperclip was down, and marks them read. Respects unreadSyncIntervalSeconds between runs.",
      schedule: "* * * * *",
    },
  ],
  instanceConfigSchema: {
    type: "object",
    properties: {
      companyId: {
        type: "string",
        title: "Company ID",
        description: "All created issues are scoped to this company.",
      },
      projectId: {
        type: "string",
        title: "Default project ID (optional)",
        description: "Optional default project for new issues.",
      },
      agentmailApiBase: {
        type: "string",
        title: "AgentMail API base URL",
        default: DEFAULT_AGENTMAIL_API_BASE,
        description: "Usually https://api.agentmail.to — change only if AgentMail provides a different host.",
      },
      eventDelivery: {
        type: "string",
        title: "Event delivery",
        enum: ["webhook", "websocket", "both"],
        default: "webhook",
        description:
          "How inbound mail events reach Paperclip: HTTPS webhook (Svix-signed), outbound WebSocket to AgentMail (no public URL), or both (deduped by message id).",
      },
      agentmailWebsocketUrl: {
        type: "string",
        title: "AgentMail WebSocket URL",
        default: DEFAULT_AGENTMAIL_WS_URL,
        description:
          "Real-time stream endpoint (path included), e.g. wss://ws.agentmail.to/v0. Override only per AgentMail docs.",
      },
      agentmailWebhookSecretRef: {
        type: "string",
        format: "password",
        title: "Webhook signing secret (secret ref)",
        description:
          "AgentMail webhook signing secret (whsec_…) as a Paperclip secret reference. Required when event delivery includes webhooks; omit for WebSocket-only.",
      },
      titlePrefix: {
        type: "string",
        title: "Issue title prefix",
        description: 'Optional prefix for every issue title (e.g. "[Email] ").',
        default: "",
      },
      descriptionMaxLength: {
        type: "integer",
        title: "Max description length",
        default: 50_000,
        minimum: 1000,
      },
      mailboxes: {
        type: "array",
        title: "Mailboxes",
        items: mailboxItemSchema,
        minItems: 1,
      },
      attachmentPolicy: {
        type: "object",
        title: "Attachment policy (optional)",
        properties: {
          maxCount: { type: "integer", minimum: 0 },
          maxBytesPerFile: { type: "integer", minimum: 0 },
          maxTotalBytes: { type: "integer", minimum: 0 },
          maxInlineDocumentBytes: { type: "integer", minimum: 0 },
          mimeAllowList: { type: "array", items: { type: "string" } },
          mimeDenyList: { type: "array", items: { type: "string" } },
          extensionDenyList: { type: "array", items: { type: "string" } },
          skipIfLabels: {
            type: "array",
            items: { type: "string" },
            description: "Skip issue creation when any message label contains these substrings (case-insensitive). Default includes spam.",
          },
        },
        additionalProperties: false,
      },
      unreadSyncOnStartup: {
        type: "boolean",
        title: "Sync unread on startup",
        default: true,
        description: "When the worker starts, list unread messages and ingest any missed while Paperclip was down.",
      },
      unreadSyncIntervalSeconds: {
        type: "integer",
        title: "Minimum seconds between scheduled unread syncs",
        default: 300,
        minimum: 0,
        maximum: 86400,
        description: "0 disables the scheduled job gate (host still runs the cron; handler no-ops). Default 300 (5 min).",
      },
      unreadSyncMaxPerRun: {
        type: "integer",
        title: "Max messages to process per mailbox per run",
        default: 50,
        minimum: 1,
        maximum: 500,
      },
      blogDedupe: {
        type: "object",
        title: "Blog dedupe (optional)",
        description: "Detect duplicate blog content via fingerprints and optional sitemap URL matching.",
        properties: {
          enabled: { type: "boolean", default: false, title: "Enable blog deduplication" },
          sitemapUrls: {
            type: "array",
            items: { type: "string" },
            title: "Sitemap URLs",
            description: "HTTPS URLs to sitemap.xml files (cached). Used to detect already-published slugs/URLs.",
          },
          markReadOnDuplicate: {
            type: "boolean",
            default: true,
            title: "Mark read when blog duplicate (catch-up only)",
            description: "When a duplicate is detected during unread sync, remove the AgentMail unread label if true.",
          },
          createIssueForDuplicate: {
            type: "boolean",
            default: false,
            title: "Create issue for blog duplicate",
            description: "If true, open a small visibility issue when a duplicate blog email is detected.",
          },
          sitemapTtlMs: {
            type: "integer",
            minimum: 60000,
            default: 21600000,
            title: "Sitemap cache TTL (ms)",
          },
          maxExtractBytes: {
            type: "integer",
            minimum: 1024,
            default: 15728640,
            title: "Max attachment bytes to download for text extraction (PDF/DOCX)",
          },
          maxExtractTextChars: {
            type: "integer",
            minimum: 1000,
            default: 500000,
            title: "Max characters extracted for fingerprinting",
          },
        },
        additionalProperties: false,
      },
    },
    required: ["companyId", "mailboxes"],
    additionalProperties: false,
  },
  webhooks: [
    {
      endpointKey: WEBHOOK_KEY,
      displayName: "AgentMail inbound",
      description: "AgentMail message.received (Svix-signed).",
    },
  ],
  tools: [
    {
      name: TOOL_NAMES.getHandlingContext,
      displayName: "AgentMail handling context",
      description:
        "Returns the AgentMail inbox id, display name, and operator handling instructions for the invoking agent. Call this before other AgentMail tools in a heartbeat.",
      parametersSchema: { type: "object", properties: {} },
    },
    {
      name: TOOL_NAMES.listMessages,
      displayName: "AgentMail list messages",
      description:
        "Lists recent messages in the agent's configured inbox (newest activity first). Use pagination via page_token when needed.",
      parametersSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max messages (default 20)", minimum: 1, maximum: 50 },
          page_token: { type: "string", description: "Pagination token from previous response" },
        },
      },
    },
    {
      name: TOOL_NAMES.getMessage,
      displayName: "AgentMail get message",
      description:
        "Fetches a full message by AgentMail message_id (from the issue description or list messages). Use before replying if you need headers, body, or attachment metadata.",
      parametersSchema: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "AgentMail message_id" },
        },
        required: ["messageId"],
      },
    },
    {
      name: TOOL_NAMES.getThread,
      displayName: "AgentMail get thread",
      description:
        "Loads the full thread for a thread_id (messages in order with bodies). Use thread_id from the issue description or list/get message. If this fails, use agentmail_get_message with a message_id.",
      parametersSchema: {
        type: "object",
        properties: { threadId: { type: "string", description: "AgentMail thread_id" } },
        required: ["threadId"],
      },
    },
    {
      name: TOOL_NAMES.sendMessage,
      displayName: "AgentMail send message",
      description:
        "Sends a new outbound email (starts a new thread) from the agent's configured inbox. For follow-ups in an existing email thread, use agentmail_reply_to_message with the original AgentMail message_id instead.",
      parametersSchema: {
        type: "object",
        properties: {
          to: {
            type: "array",
            items: { type: "string" },
            description: "Recipient addresses",
          },
          subject: { type: "string" },
          text: { type: "string", description: "Plain text body" },
          html: { type: "string", description: "Optional HTML body" },
          cc: { type: "array", items: { type: "string" } },
        },
        required: ["to", "subject", "text"],
      },
    },
    {
      name: TOOL_NAMES.replyToMessage,
      displayName: "AgentMail reply to message",
      description:
        "Replies in-thread to an existing message (AgentMail POST .../messages/{id}/reply). Use the message_id from the Paperclip issue description (inbound mail) or from agentmail_list_messages / agentmail_get_message. Set reply_all true to include all original recipients.",
      parametersSchema: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "AgentMail message_id to reply to" },
          text: { type: "string", description: "Plain text body" },
          html: { type: "string", description: "Optional HTML body" },
          cc: { type: "array", items: { type: "string" }, description: "Optional CC addresses" },
          to: {
            oneOf: [
              { type: "string", description: "Single recipient" },
              { type: "array", items: { type: "string" }, description: "Recipient list" },
            ],
            description: "Optional override recipients; omit when replying only to the original sender",
          },
          reply_all: {
            type: "boolean",
            description: "If true, reply to all recipients of the original message",
          },
        },
        required: ["messageId", "text"],
      },
    },
  ],
  ui: {
    slots: [
      {
        type: "settingsPage",
        id: "agentmail-settings",
        displayName: "AgentMail",
        exportName: EXPORT_SETTINGS,
      },
    ],
  },
};

export default manifest;
