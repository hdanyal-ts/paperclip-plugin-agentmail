import type { PluginContext } from "@paperclipai/plugin-sdk";
import {
  amGetMessage,
  amListMessages,
  amUpdateMessage,
  type ListMessagesQuery,
} from "./agentmail-http.js";
import { listMessagesResponseIds, messageFromApiToEvent } from "./api-message-to-event.js";
import type { AgentmailPluginConfig } from "./config.js";
import { STATE_KEY_LAST_RUN_AT, STATE_KEY_LAST_SUMMARY, STATE_KEY_SYNC_LOCK, STATE_NS_SYNC } from "./constants.js";
import { ingestInboundMessage } from "./ingest-inbound.js";
import type { UnreadSyncMailboxStats, UnreadSyncSummary } from "./sync-outcomes.js";
import type { ProcessOutcome } from "./sync-outcomes.js";
import { shouldMarkReadAfterCatchup } from "./sync-outcomes.js";

const LOCK_TTL_MS = 4 * 60 * 1_000;

type LockPayload = { owner: string; until: number };

function outcomeToStatBump(
  s: UnreadSyncMailboxStats,
  o: ProcessOutcome,
  ok: { markedRead: boolean; err?: string },
): void {
  s.processed += 1;
  if (ok.markedRead) s.markedRead += 1;
  if (ok.err) s.errors.push(ok.err);
  switch (o.kind) {
    case "created_issue":
      s.createdIssues += 1;
      break;
    case "updated_thread":
      s.updatedThreads += 1;
      break;
    case "duplicate_message":
      s.duplicateMessages += 1;
      break;
    case "duplicate_blog_internal":
      s.duplicateBlogInternal += 1;
      break;
    case "duplicate_blog_sitemap":
      s.duplicateBlogSitemap += 1;
      break;
    case "skipped_label":
      s.skippedLabel += 1;
      break;
    case "blog_extraction_failed":
    case "extraction_failed":
      s.extractionFailed += 1;
      break;
    case "failed_routing":
    case "failed_agent_or_project":
    case "processing_failed":
      s.failed += 1;
      break;
    default:
      break;
  }
}

function emptyMailboxStats(inboxId: string): UnreadSyncMailboxStats {
  return {
    inboxId,
    fetched: 0,
    processed: 0,
    markedRead: 0,
    createdIssues: 0,
    updatedThreads: 0,
    duplicateMessages: 0,
    duplicateBlogInternal: 0,
    duplicateBlogSitemap: 0,
    skippedLabel: 0,
    extractionFailed: 0,
    failed: 0,
    errors: [],
  };
}

export async function runUnreadSync(
  ctx: PluginContext,
  cfg: AgentmailPluginConfig,
  reason: "startup" | "job" | "manual" | "config_changed",
): Promise<UnreadSyncSummary> {
  const startedAt = new Date().toISOString();
  const mailboxes: UnreadSyncMailboxStats[] = [];

  if (reason === "job" && cfg.unreadSyncIntervalSeconds > 0) {
    const lastRaw = await ctx.state.get({
      scopeKind: "instance",
      namespace: STATE_NS_SYNC,
      stateKey: STATE_KEY_LAST_RUN_AT,
    });
    if (typeof lastRaw === "number" && Date.now() - lastRaw < cfg.unreadSyncIntervalSeconds * 1000) {
      return finishSummary(startedAt, new Date().toISOString(), reason, mailboxes);
    }
  }

  const myId = `sync:${reason}:${Math.random().toString(36).slice(2)}`;
  const now = Date.now();
  const existing = (await ctx.state.get({
    scopeKind: "instance",
    namespace: STATE_NS_SYNC,
    stateKey: STATE_KEY_SYNC_LOCK,
  })) as LockPayload | null;
  if (existing && existing.until > now) {
    ctx.logger.info("agentmail unread sync: skipped (lock held)", { reason, until: existing.until });
    return finishSummary(startedAt, new Date().toISOString(), reason, mailboxes);
  }
  await ctx.state.set(
    { scopeKind: "instance", namespace: STATE_NS_SYNC, stateKey: STATE_KEY_SYNC_LOCK },
    { owner: myId, until: now + LOCK_TTL_MS } satisfies LockPayload,
  );

  try {
    for (const mb of cfg.mailboxes) {
      const stats = emptyMailboxStats(mb.inboxId);
      mailboxes.push(stats);
      const apiBase = cfg.agentmailApiBase ?? "https://api.agentmail.to";
      let pageToken: string | undefined;
      let totalHandled = 0;
      const limit = 25;

      while (totalHandled < cfg.unreadSyncMaxPerRun) {
        const query: ListMessagesQuery = {
          limit: Math.min(limit, cfg.unreadSyncMaxPerRun - totalHandled),
          page_token: pageToken,
          labels: ["unread"],
          ascending: true,
        };
        let listBody: unknown;
        try {
          listBody = await amListMessages(ctx.http, apiBase, mb.inboxApiKey, mb.inboxId, query);
        } catch (e) {
          stats.errors.push(
            `list: ${e instanceof Error ? e.message : String(e)}`,
          );
          break;
        }
        const { messages, nextPageToken } = listMessagesResponseIds(listBody);
        stats.fetched += messages.length;
        if (messages.length === 0) break;

        for (const item of messages) {
          if (totalHandled >= cfg.unreadSyncMaxPerRun) break;
          const requestId = `catchup:${item.message_id}`;
          const source =
            reason === "manual" ? "manual" : reason === "job" ? "job" : "catchup";
          let full: unknown;
          try {
            full = await amGetMessage(ctx.http, apiBase, mb.inboxApiKey, item.inbox_id, item.message_id);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            stats.errors.push(`get ${item.message_id}: ${msg}`);
            outcomeToStatBump(
              stats,
              { kind: "processing_failed", stage: "amGetMessage", message: msg },
              { markedRead: false },
            );
            totalHandled += 1;
            continue;
          }
          const eventId = `catchup:${item.message_id}`;
          const evt = messageFromApiToEvent(full, eventId);
          if (!evt) {
            stats.errors.push(`map ${item.message_id}: invalid API message`);
            outcomeToStatBump(
              stats,
              { kind: "processing_failed", stage: "messageFromApiToEvent", message: "invalid API message" },
              { markedRead: false },
            );
            totalHandled += 1;
            continue;
          }
          let outcome: ProcessOutcome;
          try {
            outcome = await ingestInboundMessage(
              ctx,
              cfg,
              evt,
              { requestId, source },
              { apiMessage: full },
            );
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            stats.errors.push(`ingest ${item.message_id}: ${msg}`);
            outcomeToStatBump(
              stats,
              { kind: "processing_failed", stage: "ingestInboundMessage", message: msg },
              { markedRead: false },
            );
            totalHandled += 1;
            continue;
          }
          const mark = shouldMarkReadAfterCatchup(outcome, cfg.blogDedupe.markReadOnDuplicate);
          let readErr: string | undefined;
          if (mark) {
            try {
              await amUpdateMessage(ctx.http, apiBase, mb.inboxApiKey, item.inbox_id, item.message_id, {
                add_labels: "read",
                remove_labels: "unread",
              });
            } catch (e) {
              readErr = e instanceof Error ? e.message : String(e);
            }
          }
          outcomeToStatBump(stats, outcome, {
            markedRead: mark && !readErr,
            err: readErr,
          });
          if (readErr) {
            stats.errors.push(`mark read ${item.message_id}: ${readErr}`);
          }
          totalHandled += 1;
        }
        if (!nextPageToken) break;
        pageToken = nextPageToken;
        if (messages.length === 0) break;
      }
    }
  } finally {
    const cur = (await ctx.state.get({
      scopeKind: "instance",
      namespace: STATE_NS_SYNC,
      stateKey: STATE_KEY_SYNC_LOCK,
    })) as LockPayload | null;
    if (cur?.owner === myId) {
      await ctx.state.delete({
        scopeKind: "instance",
        namespace: STATE_NS_SYNC,
        stateKey: STATE_KEY_SYNC_LOCK,
      });
    }
  }

  const finishedAt = new Date().toISOString();
  const summary = finishSummary(startedAt, finishedAt, reason, mailboxes);
  await ctx.state.set(
    { scopeKind: "instance", namespace: STATE_NS_SYNC, stateKey: STATE_KEY_LAST_RUN_AT },
    Date.now(),
  );
  await ctx.state.set(
    { scopeKind: "instance", namespace: STATE_NS_SYNC, stateKey: STATE_KEY_LAST_SUMMARY },
    summary,
  );
  return summary;
}

function finishSummary(
  startedAt: string,
  finishedAt: string,
  reason: UnreadSyncSummary["reason"],
  mailboxes: UnreadSyncMailboxStats[],
): UnreadSyncSummary {
  return { startedAt, finishedAt, reason, mailboxes };
}
