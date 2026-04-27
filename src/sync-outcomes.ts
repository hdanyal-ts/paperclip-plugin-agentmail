/** Where an inbound email was ingested from (extends webhook/websocket for catch-up paths). */
export type IngestSource = "webhook" | "websocket" | "catchup" | "poll" | "job" | "manual";

/**
 * Result of `processMessageReceivedEvent` / `ingestInboundMessage`.
 * Drives mark-read in unread catch-up (`shouldMarkReadAfterCatchup`) and sync stats.
 */
export type ProcessOutcome =
  | { kind: "skipped_label" }
  | { kind: "duplicate_message" }
  | { kind: "created_issue"; issueId: string }
  | { kind: "updated_thread"; issueId: string }
  | { kind: "failed_routing" }
  | { kind: "failed_agent_or_project" }
  | { kind: "duplicate_blog_internal"; blogEntityId?: string }
  | { kind: "duplicate_blog_sitemap"; matchedUrl: string }
  | { kind: "blog_extraction_failed"; reason: string }
  /** Non-blog attachment/text extraction could not run; normal issue may still be created elsewhere */
  | { kind: "extraction_failed"; reason: string }
  | { kind: "processing_failed"; stage: string; message: string };

/** Base mark-read policy (webhook/WS and catch-up before blog duplicate override). */
export function shouldMarkReadAfter(outcome: ProcessOutcome): boolean {
  switch (outcome.kind) {
    case "created_issue":
    case "updated_thread":
    case "duplicate_message":
    case "skipped_label":
    case "duplicate_blog_internal":
    case "duplicate_blog_sitemap":
      return true;
    case "failed_routing":
    case "failed_agent_or_project":
    case "blog_extraction_failed":
    case "extraction_failed":
    case "processing_failed":
      return false;
  }
  return false;
}

/**
 * Whether to remove AgentMail `unread` after catch-up for this outcome.
 * Centralizes `blogDedupe.markReadOnDuplicate` (duplicate blog → optional leave unread).
 */
export function shouldMarkReadAfterCatchup(
  outcome: ProcessOutcome,
  blogMarkReadOnDuplicate: boolean,
): boolean {
  const base = shouldMarkReadAfter(outcome);
  if (
    !blogMarkReadOnDuplicate &&
    (outcome.kind === "duplicate_blog_internal" || outcome.kind === "duplicate_blog_sitemap")
  ) {
    return false;
  }
  return base;
}

export type UnreadSyncMailboxStats = {
  inboxId: string;
  fetched: number;
  processed: number;
  markedRead: number;
  createdIssues: number;
  updatedThreads: number;
  duplicateMessages: number;
  duplicateBlogInternal: number;
  duplicateBlogSitemap: number;
  skippedLabel: number;
  extractionFailed: number;
  failed: number;
  errors: string[];
};

export type UnreadSyncSummary = {
  startedAt: string;
  finishedAt: string;
  reason: "startup" | "job" | "manual" | "config_changed";
  mailboxes: UnreadSyncMailboxStats[];
};
