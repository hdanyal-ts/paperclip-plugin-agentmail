import {
  definePlugin,
  runWorker,
  type PluginContext,
  type PluginJobContext,
  type PluginWebhookInput,
  type ToolResult,
  type ToolRunContext,
} from "@paperclipai/plugin-sdk";
import { runAgentmailWebsocketHub } from "./agentmail-ws.js";
import {
  amGetInbox,
  amGetMessage,
  amGetThread,
  amListMessages,
  amReplyToMessage,
  amSendMessage,
} from "./agentmail-http.js";
import { resolveAssignee } from "./assignee.js";
import { ingestAttachmentsToIssue, resolveAttachmentList } from "./attachments.js";
import {
  needsWebhookSecret,
  parseConfig,
  usesWebsocketDelivery,
  validateMailboxShape,
  type AgentmailPluginConfig,
  type MailboxConfig,
} from "./config.js";
import { runUnreadSync } from "./catchup-unread.js";
import { markBlogEntityPublished } from "./blog-published.js";
import { JOB_KEY_UNREAD_SYNC, STATE_KEY_LAST_SUMMARY, STATE_NS_SYNC, TOOL_NAMES, WEBHOOK_KEY } from "./constants.js";
import { ingestInboundMessage } from "./ingest-inbound.js";
import { parseWebhookEnvelope } from "./parse-webhook.js";
import { verifyAgentmailWebhook } from "./svix-verify.js";

function mailboxForAgent(cfg: AgentmailPluginConfig, agentId: string): MailboxConfig | null {
  for (const mb of cfg.mailboxes) {
    if (mb.assignments.some((a) => a.agentId === agentId)) return mb;
  }
  return null;
}

function assignmentForAgent(mb: MailboxConfig, agentId: string) {
  return mb.assignments.find((a) => a.agentId === agentId);
}

async function loadConfig(ctx: PluginContext): Promise<AgentmailPluginConfig | null> {
  const raw = (await ctx.config.get()) as Record<string, unknown>;
  return parseConfig(raw);
}

let workerContext: PluginContext | null = null;
let wsHub: { stop: () => void } | null = null;

function stopWsHub() {
  wsHub?.stop();
  wsHub = null;
}

async function startWsHubIfNeeded() {
  const ctx = workerContext;
  if (!ctx) return;
  stopWsHub();
  const cfg = await loadConfig(ctx);
  if (!cfg || !usesWebsocketDelivery(cfg.eventDelivery)) return;

  wsHub = runAgentmailWebsocketHub(ctx, () => loadConfig(ctx), async (text) => {
    const c = workerContext;
    if (!c) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    const rec = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    if (rec?.type === "subscribed") {
      c.logger.info("agentmail ws subscribed", { inboxIds: rec.inbox_ids });
      return;
    }
    if (rec?.type === "error") {
      c.logger.warn("agentmail ws server error", {
        name: rec.name,
        message: rec.message,
      });
      return;
    }
    const evt = parseWebhookEnvelope(parsed);
    if (!evt) return;
    const fresh = await loadConfig(c);
    if (!fresh) return;
    void ingestInboundMessage(c, fresh, evt, {
      requestId: `ws:${evt.eventId}`,
      source: "websocket",
    }).catch((e) => {
      c.logger.error("agentmail ws ingest failed", { err: e instanceof Error ? e.message : String(e) });
    });
  });
}

const plugin = definePlugin({
  async setup(ctx) {
    workerContext = ctx;
    ctx.data.register("webhook-info", async () => {
      const path = `/api/plugins/${encodeURIComponent(ctx.manifest.id)}/webhooks/${encodeURIComponent(WEBHOOK_KEY)}`;
      return { webhookPath: path, endpointKey: WEBHOOK_KEY };
    });

    ctx.data.register("unread-sync-summary", async () => {
      const summary = await ctx.state.get({
        scopeKind: "instance",
        namespace: STATE_NS_SYNC,
        stateKey: STATE_KEY_LAST_SUMMARY,
      });
      return { summary: summary ?? null };
    });

    ctx.actions.register("sync-unread-now", async () => {
      const cfg = await loadConfig(ctx);
      if (!cfg) return { ok: false, error: "Invalid plugin config" };
      try {
        const summary = await runUnreadSync(ctx, cfg, "manual");
        return { ok: true, summary };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });

    ctx.actions.register("blog-set-published", async (params) => {
      const cfg = await loadConfig(ctx);
      if (!cfg) return { ok: false, error: "Invalid plugin config" };
      const fingerprintKey = typeof params.fingerprintKey === "string" ? params.fingerprintKey : "";
      const publishedUrl = typeof params.publishedUrl === "string" ? params.publishedUrl : undefined;
      const publishedAt = typeof params.publishedAt === "string" ? params.publishedAt : undefined;
      return markBlogEntityPublished(ctx, cfg, { fingerprintKey, publishedUrl, publishedAt });
    });

    ctx.actions.register("verify-mailbox", async (params) => {
      const inboxId = typeof params.inboxId === "string" ? params.inboxId : "";
      if (!inboxId) return { ok: false, error: "inboxId required" };
      const cfg = await loadConfig(ctx);
      if (!cfg) return { ok: false, error: "Invalid plugin config" };
      const mb = cfg.mailboxes.find((m) => m.inboxId === inboxId);
      if (!mb) return { ok: false, error: "Unknown mailbox" };
      const data = await amGetInbox(ctx.http, cfg.agentmailApiBase!, mb.inboxApiKey, inboxId);
      return { ok: true, inbox: data };
    });

    ctx.tools.register(
      TOOL_NAMES.getHandlingContext,
      {
        displayName: "AgentMail handling context",
        description:
          "Returns the AgentMail inbox id, display name, and operator handling instructions for the invoking agent. Call this before other AgentMail tools in a heartbeat.",
        parametersSchema: { type: "object", properties: {} },
      },
      async (_params, runCtx: ToolRunContext): Promise<ToolResult> => {
        const cfg = await loadConfig(ctx);
        if (!cfg) return { error: "Plugin is not configured" };
        if (runCtx.companyId !== cfg.companyId) {
          return { error: "Company mismatch for this plugin instance" };
        }
        const mb = mailboxForAgent(cfg, runCtx.agentId);
        if (!mb) return { error: "Agent is not assigned in AgentMail plugin config" };
        const a = assignmentForAgent(mb, runCtx.agentId);
        return {
          content: "AgentMail handling context",
          data: {
            inboxId: mb.inboxId,
            displayName: mb.displayName ?? null,
            handlingInstructions: a?.handlingInstructions ?? null,
          },
        };
      },
    );

    ctx.tools.register(
      TOOL_NAMES.listMessages,
      {
        displayName: "AgentMail list messages",
        description:
          "Lists recent messages in the agent's configured inbox (newest activity first). Use pagination via page_token when needed.",
        parametersSchema: {
          type: "object",
          properties: {
            limit: { type: "integer" },
            page_token: { type: "string" },
          },
        },
      },
      async (params, runCtx: ToolRunContext): Promise<ToolResult> => {
        const cfg = await loadConfig(ctx);
        if (!cfg) return { error: "Plugin is not configured" };
        if (runCtx.companyId !== cfg.companyId) return { error: "Company mismatch" };
        const mb = mailboxForAgent(cfg, runCtx.agentId);
        if (!mb) return { error: "Agent is not assigned in AgentMail plugin config" };
        const p = params as { limit?: number; page_token?: string };
        const data = await amListMessages(ctx.http, cfg.agentmailApiBase!, mb.inboxApiKey, mb.inboxId, {
          limit: p.limit ?? 20,
          page_token: p.page_token,
        });
        return { content: "AgentMail messages", data };
      },
    );

    ctx.tools.register(
      TOOL_NAMES.getMessage,
      {
        displayName: "AgentMail get message",
        description:
          "Fetches a full message by AgentMail message_id (from the issue description or list messages). Use before replying if you need headers, body, or attachment metadata.",
        parametersSchema: {
          type: "object",
          properties: { messageId: { type: "string" } },
          required: ["messageId"],
        },
      },
      async (params, runCtx: ToolRunContext): Promise<ToolResult> => {
        const cfg = await loadConfig(ctx);
        if (!cfg) return { error: "Plugin is not configured" };
        if (runCtx.companyId !== cfg.companyId) return { error: "Company mismatch" };
        const mb = mailboxForAgent(cfg, runCtx.agentId);
        if (!mb) return { error: "Agent is not assigned in AgentMail plugin config" };
        const messageId = String((params as { messageId?: string }).messageId ?? "");
        if (!messageId) return { error: "messageId required" };
        const data = await amGetMessage(ctx.http, cfg.agentmailApiBase!, mb.inboxApiKey, mb.inboxId, messageId);
        return { content: "AgentMail message", data };
      },
    );

    ctx.tools.register(
      TOOL_NAMES.getThread,
      {
        displayName: "AgentMail get thread",
        description:
          "Loads the full email thread for an AgentMail thread_id (all messages in chronological order, with bodies). Use the thread_id from the Paperclip issue description (### AgentMail block) or from agentmail_list_messages / agentmail_get_message before replying with agentmail_reply_to_message. If this fails (e.g. 404), fall back to agentmail_get_message with a message_id from the issue or comments.",
        parametersSchema: {
          type: "object",
          properties: { threadId: { type: "string" } },
          required: ["threadId"],
        },
      },
      async (params, runCtx: ToolRunContext): Promise<ToolResult> => {
        const cfg = await loadConfig(ctx);
        if (!cfg) return { error: "Plugin is not configured" };
        if (runCtx.companyId !== cfg.companyId) return { error: "Company mismatch" };
        const mb = mailboxForAgent(cfg, runCtx.agentId);
        if (!mb) return { error: "Agent is not assigned in AgentMail plugin config" };
        const threadId = String((params as { threadId?: string }).threadId ?? "");
        if (!threadId) return { error: "threadId required" };
        try {
          const data = await amGetThread(ctx.http, cfg.agentmailApiBase!, mb.inboxApiKey, mb.inboxId, threadId);
          return { content: "AgentMail thread", data };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { error: msg };
        }
      },
    );

    ctx.tools.register(
      TOOL_NAMES.sendMessage,
      {
        displayName: "AgentMail send message",
        description:
          "Sends a new outbound email (starts a new thread) from the agent's configured inbox. For follow-ups in an existing email thread, use agentmail_reply_to_message with the original AgentMail message_id instead.",
        parametersSchema: {
          type: "object",
          properties: {
            to: { type: "array", items: { type: "string" } },
            cc: { type: "array", items: { type: "string" } },
            subject: { type: "string" },
            text: { type: "string" },
            html: { type: "string" },
          },
          required: ["to", "subject", "text"],
        },
      },
      async (params, runCtx: ToolRunContext): Promise<ToolResult> => {
        const cfg = await loadConfig(ctx);
        if (!cfg) return { error: "Plugin is not configured" };
        if (runCtx.companyId !== cfg.companyId) return { error: "Company mismatch" };
        const mb = mailboxForAgent(cfg, runCtx.agentId);
        if (!mb) return { error: "Agent is not assigned in AgentMail plugin config" };
        const p = params as {
          to: string[];
          cc?: string[];
          subject: string;
          text: string;
          html?: string;
        };
        const data = await amSendMessage(ctx.http, cfg.agentmailApiBase!, mb.inboxApiKey, mb.inboxId, {
          to: p.to,
          cc: p.cc,
          subject: p.subject,
          text: p.text,
          html: p.html,
        });
        return { content: "AgentMail send result", data };
      },
    );

    ctx.tools.register(
      TOOL_NAMES.replyToMessage,
      {
        displayName: "AgentMail reply to message",
        description:
          "Replies in-thread to an existing message (AgentMail POST .../messages/{id}/reply). Use the message_id from the Paperclip issue description (inbound mail) or from agentmail_list_messages / agentmail_get_message. Set reply_all true to include all original recipients.",
        parametersSchema: {
          type: "object",
          properties: {
            messageId: { type: "string" },
            text: { type: "string" },
            html: { type: "string" },
            cc: { type: "array", items: { type: "string" } },
            to: {
              oneOf: [
                { type: "string" },
                { type: "array", items: { type: "string" } },
              ],
            },
            reply_all: { type: "boolean" },
          },
          required: ["messageId", "text"],
        },
      },
      async (params, runCtx: ToolRunContext): Promise<ToolResult> => {
        const cfg = await loadConfig(ctx);
        if (!cfg) return { error: "Plugin is not configured" };
        if (runCtx.companyId !== cfg.companyId) return { error: "Company mismatch" };
        const mb = mailboxForAgent(cfg, runCtx.agentId);
        if (!mb) return { error: "Agent is not assigned in AgentMail plugin config" };
        const p = params as {
          messageId?: string;
          text?: string;
          html?: string;
          cc?: string[];
          to?: string | string[];
          reply_all?: boolean;
        };
        const messageId = String(p.messageId ?? "");
        if (!messageId) return { error: "messageId required" };
        const text = String(p.text ?? "");
        if (!text) return { error: "text required" };
        const data = await amReplyToMessage(
          ctx.http,
          cfg.agentmailApiBase!,
          mb.inboxApiKey,
          mb.inboxId,
          messageId,
          {
            text,
            html: p.html,
            cc: p.cc,
            to: p.to,
            reply_all: p.reply_all,
          },
        );
        return { content: "AgentMail reply result", data };
      },
    );

    ctx.jobs.register(JOB_KEY_UNREAD_SYNC, async (_job: PluginJobContext) => {
      const c = workerContext;
      if (!c) return;
      const cfg = await loadConfig(c);
      if (!cfg) return;
      try {
        await runUnreadSync(c, cfg, "job");
      } catch (e) {
        c.logger.error("agentmail unread sync job failed", {
          err: e instanceof Error ? e.message : String(e),
        });
      }
    });

    await startWsHubIfNeeded();

    const cfg0 = await loadConfig(ctx);
    if (cfg0?.unreadSyncOnStartup) {
      void runUnreadSync(ctx, cfg0, "startup").catch((e) => {
        ctx.logger.error("agentmail startup unread sync failed", {
          err: e instanceof Error ? e.message : String(e),
        });
      });
    }
  },

  async onConfigChanged() {
    await startWsHubIfNeeded();
    const c = workerContext;
    if (!c) return;
    const cfg = await loadConfig(c);
    if (cfg?.unreadSyncOnStartup) {
      void runUnreadSync(c, cfg, "config_changed").catch((e) => {
        c.logger.warn("agentmail config-changed unread sync failed", {
          err: e instanceof Error ? e.message : String(e),
        });
      });
    }
  },

  async onShutdown() {
    stopWsHub();
  },

  async onValidateConfig(config: Record<string, unknown>) {
    const parsed = parseConfig(config);
    if (!parsed) {
      return {
        ok: false,
        errors: [
          "companyId, at least one mailbox (inboxId, inboxApiKey, assignments), and (when using webhooks) webhook signing secret are required",
        ],
      };
    }
    if (needsWebhookSecret(parsed.eventDelivery) && !parsed.agentmailWebhookSecretRef.trim()) {
      return {
        ok: false,
        errors: ["agentmailWebhookSecretRef is required when event delivery includes webhooks (webhook or both)."],
      };
    }
    const shape = validateMailboxShape(parsed);
    if (!shape.ok) return { ok: false, errors: shape.errors };
    return { ok: true, warnings: [] };
  },

  async onWebhook(input: PluginWebhookInput) {
    const ctx = workerContext;
    if (!ctx) {
      throw new Error("AgentMail plugin: worker not initialized");
    }
    if (input.endpointKey !== WEBHOOK_KEY) {
      throw new Error(`Unknown webhook endpoint ${input.endpointKey}`);
    }

    const cfg = await loadConfig(ctx);
    if (!cfg) {
      ctx.logger.warn("agentmail webhook: missing or invalid config");
      return;
    }

    if (cfg.eventDelivery === "websocket") {
      ctx.logger.debug("agentmail webhook: ignored (eventDelivery is websocket-only)", {
        requestId: input.requestId,
      });
      return;
    }

    const webhookSecret = await ctx.secrets.resolve(cfg.agentmailWebhookSecretRef);
    verifyAgentmailWebhook(input.rawBody, input.headers, webhookSecret);

    const evt = parseWebhookEnvelope(input.parsedBody);
    if (!evt) {
      ctx.logger.debug("agentmail webhook: ignored non-message.received or unparsable payload", {
        requestId: input.requestId,
      });
      return;
    }

    await ingestInboundMessage(ctx, cfg, evt, { requestId: input.requestId, source: "webhook" });
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
