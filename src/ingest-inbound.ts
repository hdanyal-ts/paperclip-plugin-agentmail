import type { PluginContext } from "@paperclipai/plugin-sdk";
import { amGetMessage } from "./agentmail-http.js";
import type { AgentmailPluginConfig } from "./config.js";
import {
  evaluateBlogForInbound,
  handleBlogDuplicate,
  recordBlogCandidate,
} from "./blog-dedupe.js";
import { processMessageReceivedEvent } from "./process-message-received.js";
import type { MessageReceivedEvent } from "./parse-webhook.js";
import type { IngestSource, ProcessOutcome } from "./sync-outcomes.js";
import { shouldMarkReadAfter } from "./sync-outcomes.js";

export async function ingestInboundMessage(
  ctx: PluginContext,
  cfg: AgentmailPluginConfig,
  evt: MessageReceivedEvent,
  meta: { requestId: string; source: IngestSource },
  options?: { apiMessage?: unknown },
): Promise<ProcessOutcome> {
  const apiBase = cfg.agentmailApiBase ?? "";
  const mb = cfg.mailboxes.find((m) => m.inboxId === evt.message.inbox_id);
  let apiMessage = options?.apiMessage;
  if (!apiMessage && mb) {
    try {
      apiMessage = await amGetMessage(
        ctx.http,
        apiBase,
        mb.inboxApiKey,
        evt.message.inbox_id,
        evt.message.message_id,
      );
    } catch (e) {
      ctx.logger.warn("agentmail: could not load full message for ingest extras", {
        messageId: evt.message.message_id,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (cfg.blogDedupe.enabled && apiMessage) {
    const blog = await evaluateBlogForInbound(ctx, cfg, evt, apiMessage);
    if (blog.action === "duplicate_internal") {
      return handleBlogDuplicate(ctx, cfg, "internal", blog.preprocess, {
        requestId: meta.requestId,
        messageId: evt.message.message_id,
        inboxId: evt.message.inbox_id,
      });
    }
    if (blog.action === "duplicate_sitemap") {
      return handleBlogDuplicate(ctx, cfg, "sitemap", blog.preprocess, {
        requestId: meta.requestId,
        messageId: evt.message.message_id,
        inboxId: evt.message.inbox_id,
        matchedUrl: blog.matchedUrl,
      });
    }
    if (blog.action === "proceed") {
      const out = await processMessageReceivedEvent(ctx, cfg, evt, meta);
      if (out.kind === "created_issue" && shouldMarkReadAfter(out)) {
        try {
          await recordBlogCandidate(ctx, cfg, blog.preprocess, evt.message.message_id, out.issueId);
        } catch (e) {
          ctx.logger.warn("agentmail: recordBlogCandidate failed", {
            err: e instanceof Error ? e.message : String(e),
          });
        }
        if (blog.preprocess.attachmentNote) {
          try {
            await ctx.issues.createComment(
              out.issueId,
              blog.preprocess.attachmentNote,
              cfg.companyId,
            );
          } catch {
            /* best effort */
          }
        }
      }
      return out;
    }
  }

  return processMessageReceivedEvent(ctx, cfg, evt, meta);
}
