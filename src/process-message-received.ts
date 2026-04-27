import type { PluginContext } from "@paperclipai/plugin-sdk";
import { amGetMessage } from "./agentmail-http.js";
import { resolveAssignee, type AssigneeResolution } from "./assignee.js";
import { ingestAttachmentsToIssue, resolveAttachmentList } from "./attachments.js";
import { resolvedAttachmentPolicy, type AgentmailPluginConfig } from "./config.js";
import { ENTITY_TYPE_MESSAGE, ENTITY_TYPE_THREAD, PLUGIN_ID, threadEntityExternalId } from "./constants.js";
import { buildFollowUpComment, buildIssueDescription, buildIssueTitle } from "./issue-body.js";
import type { MessageReceivedEvent } from "./parse-webhook.js";
import { replyGraphFromApiMessage } from "./parse-webhook.js";
import type { IngestSource, ProcessOutcome } from "./sync-outcomes.js";

function labelsTriggerSkip(labels: string[], rules: string[]): boolean {
  if (!rules.length) return false;
  const L = labels.map((x) => x.toLowerCase());
  return rules.some((r) => {
    const rr = r.toLowerCase();
    return L.some((l) => l.includes(rr));
  });
}

function threadMappedIssueId(rows: { data: Record<string, unknown> }[]): string | null {
  for (const r of rows) {
    const id = r.data.issueId;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
}

/** Prefer immediate parent, then walk references from newest toward older. */
function replyChainCandidates(m: MessageReceivedEvent["message"]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    const t = id.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  if (m.in_reply_to) push(m.in_reply_to);
  if (m.references?.length) {
    for (let i = m.references.length - 1; i >= 0; i--) push(m.references[i]!);
  }
  return out;
}

async function resolveIssueFromThreadRows(
  ctx: PluginContext,
  companyId: string,
  threadRows: { data: Record<string, unknown> }[],
): Promise<{ id: string } | null> {
  for (const r of threadRows) {
    const id = r.data.issueId;
    if (typeof id !== "string" || !id.trim()) continue;
    const issue = await ctx.issues.get(id.trim(), companyId);
    if (issue) return issue;
  }
  return null;
}

async function resolveIssueIdFromPriorMessages(
  ctx: PluginContext,
  companyId: string,
  m: MessageReceivedEvent["message"],
): Promise<{ id: string } | null> {
  const scope = {
    entityType: ENTITY_TYPE_MESSAGE,
    scopeKind: "company" as const,
    scopeId: companyId,
    limit: 5,
  };
  for (const mid of replyChainCandidates(m)) {
    const rows = await ctx.entities.list({ ...scope, externalId: mid });
    for (const r of rows) {
      const id = (r.data as { issueId?: string }).issueId;
      if (typeof id !== "string" || !id.trim()) continue;
      const issue = await ctx.issues.get(id.trim(), companyId);
      if (issue) return issue;
    }
  }
  return null;
}

async function enrichEventReplyGraphFromApi(
  ctx: PluginContext,
  cfg: AgentmailPluginConfig,
  routing: Extract<AssigneeResolution, { ok: true }>,
  evt: MessageReceivedEvent,
): Promise<MessageReceivedEvent> {
  const m = evt.message;
  if ((m.in_reply_to && m.in_reply_to.trim()) || (m.references?.length ?? 0) > 0) return evt;
  const bearer = routing.mailbox.inboxApiKey;
  const base = cfg.agentmailApiBase!;
  let apiMsg: unknown;
  try {
    apiMsg = await amGetMessage(ctx.http, base, bearer, m.inbox_id, m.message_id);
  } catch {
    return evt;
  }
  const extra = replyGraphFromApiMessage(apiMsg);
  if (!extra.in_reply_to && !(extra.references?.length ?? 0)) return evt;
  return {
    ...evt,
    message: {
      ...m,
      ...(extra.in_reply_to ? { in_reply_to: extra.in_reply_to } : {}),
      ...(extra.references?.length ? { references: extra.references } : {}),
    },
  };
}

async function resolveRoutingAndIssueContext(
  ctx: PluginContext,
  cfg: AgentmailPluginConfig,
  evt: MessageReceivedEvent,
  meta: { requestId: string; source: IngestSource },
): Promise<
  | { ok: true; routing: Extract<AssigneeResolution, { ok: true }> }
  | { ok: false; outcome: Extract<ProcessOutcome, { kind: "failed_routing" | "failed_agent_or_project" }> }
> {
  const routing = resolveAssignee(cfg.mailboxes, evt.message.inbox_id, evt.message.to, evt.message.cc);
  if (!routing.ok) {
    ctx.logger.warn(`agentmail ${meta.source}: assignee not resolved`, {
      reason: routing.reason,
      inboxId: evt.message.inbox_id,
      requestId: meta.requestId,
    });
    return { ok: false, outcome: { kind: "failed_routing" } };
  }

  const agentRecord = await ctx.agents.get(routing.agentId, cfg.companyId);
  if (!agentRecord) {
    ctx.logger.warn(`agentmail ${meta.source}: configured agent not found`, {
      agentId: routing.agentId,
      requestId: meta.requestId,
    });
    return { ok: false, outcome: { kind: "failed_agent_or_project" } };
  }

  if (cfg.projectId) {
    const proj = await ctx.projects.get(cfg.projectId, cfg.companyId);
    if (!proj) {
      ctx.logger.warn(`agentmail ${meta.source}: projectId not found`, {
        projectId: cfg.projectId,
        requestId: meta.requestId,
      });
      return { ok: false, outcome: { kind: "failed_agent_or_project" } };
    }
  }

  return { ok: true, routing };
}

async function runIngestAndFailureComment(params: {
  ctx: PluginContext;
  cfg: AgentmailPluginConfig;
  routing: Extract<AssigneeResolution, { ok: true }>;
  evt: MessageReceivedEvent;
  issueId: string;
  attachmentList: Awaited<ReturnType<typeof resolveAttachmentList>>;
}): Promise<void> {
  const { ctx, cfg, routing, evt, issueId, attachmentList } = params;
  const bearer = routing.mailbox.inboxApiKey;
  const { failures } = await ingestAttachmentsToIssue({
    ctx,
    cfg,
    bearer,
    inboxId: evt.message.inbox_id,
    messageId: evt.message.message_id,
    attachments: attachmentList,
    issueId,
    companyId: cfg.companyId,
  });

  if (failures.length) {
    await ctx.issues.createComment(
      issueId,
      ["Some attachments were not stored:", ...failures.map((f) => `- ${f}`)].join("\n"),
      cfg.companyId,
    );
  }
}

export async function processMessageReceivedEvent(
  ctx: PluginContext,
  cfg: AgentmailPluginConfig,
  evt: MessageReceivedEvent,
  meta: { requestId: string; source: IngestSource },
): Promise<ProcessOutcome> {
  const skipRules = resolvedAttachmentPolicy(cfg.attachmentPolicy).skipIfLabels;
  if (labelsTriggerSkip(evt.message.labels, skipRules)) {
    ctx.logger.info(`agentmail ${meta.source}: skipped by label rules`, {
      requestId: meta.requestId,
      messageId: evt.message.message_id,
    });
    return { kind: "skipped_label" };
  }

  const existing = await ctx.entities.list({
    entityType: ENTITY_TYPE_MESSAGE,
    externalId: evt.message.message_id,
    limit: 5,
  });
  if (existing.some((r) => typeof (r.data as { issueId?: string }).issueId === "string")) {
    ctx.logger.info(`agentmail ${meta.source}: duplicate message_id (idempotent skip)`, {
      messageId: evt.message.message_id,
      requestId: meta.requestId,
    });
    return { kind: "duplicate_message" };
  }

  const resolved = await resolveRoutingAndIssueContext(ctx, cfg, evt, meta);
  if (!resolved.ok) return resolved.outcome;
  const routing = resolved.routing;

  let event = evt;
  let threadKey = threadEntityExternalId(event.message.inbox_id, event.message.thread_id);
  const threadRows = await ctx.entities.list({
    entityType: ENTITY_TYPE_THREAD,
    scopeKind: "company",
    scopeId: cfg.companyId,
    externalId: threadKey,
    limit: 5,
  });
  let existingIssue = await resolveIssueFromThreadRows(ctx, cfg.companyId, threadRows);
  const firstMappedId = threadMappedIssueId(threadRows);
  if (firstMappedId && !existingIssue) {
    ctx.logger.warn(`agentmail ${meta.source}: thread entity issueId stale or issue missing`, {
      requestId: meta.requestId,
      threadKey,
      mappedId: firstMappedId,
    });
  }

  if (!existingIssue) {
    event = await enrichEventReplyGraphFromApi(ctx, cfg, routing, event);
    threadKey = threadEntityExternalId(event.message.inbox_id, event.message.thread_id);
    existingIssue = await resolveIssueIdFromPriorMessages(ctx, cfg.companyId, event.message);
  }

  if (existingIssue) {
    const bearer = routing.mailbox.inboxApiKey;
    const attachmentList = await resolveAttachmentList(
      ctx,
      cfg,
      bearer,
      event.message.inbox_id,
      event.message.message_id,
      event.message.attachments ?? [],
    );

    await ctx.issues.createComment(
      existingIssue.id,
      buildFollowUpComment(event, cfg, attachmentList),
      cfg.companyId,
    );
    await ctx.issues.update(existingIssue.id, { status: "todo" }, cfg.companyId);

    const msgTitle = buildIssueTitle(event, cfg);
    await ctx.entities.upsert({
      entityType: ENTITY_TYPE_MESSAGE,
      scopeKind: "company",
      scopeId: cfg.companyId,
      externalId: event.message.message_id,
      title: msgTitle.slice(0, 200),
      data: {
        issueId: existingIssue.id,
        inboxId: event.message.inbox_id,
        messageId: event.message.message_id,
        eventId: event.eventId,
      },
    });

    await ctx.entities.upsert({
      entityType: ENTITY_TYPE_THREAD,
      scopeKind: "company",
      scopeId: cfg.companyId,
      externalId: threadKey,
      title: msgTitle.slice(0, 200),
      data: {
        issueId: existingIssue.id,
        inboxId: event.message.inbox_id,
        threadId: event.message.thread_id,
      },
    });

    await runIngestAndFailureComment({
      ctx,
      cfg,
      routing,
      evt: event,
      issueId: existingIssue.id,
      attachmentList,
    });

    await ctx.activity.log({
      companyId: cfg.companyId,
      entityType: "issue",
      entityId: existingIssue.id,
      message: `AgentMail updated issue from follow-up message ${event.message.message_id}`,
      metadata: { plugin: PLUGIN_ID, inboxId: event.message.inbox_id, source: meta.source },
    });
    return { kind: "updated_thread", issueId: existingIssue.id };
  }

  const title = buildIssueTitle(event, cfg);
  const description = buildIssueDescription(event, cfg, routing.handlingInstructions);

  const issue = await ctx.issues.create({
    companyId: cfg.companyId,
    projectId: cfg.projectId,
    title,
    description,
    assigneeAgentId: routing.agentId,
  });

  await ctx.entities.upsert({
    entityType: ENTITY_TYPE_MESSAGE,
    scopeKind: "company",
    scopeId: cfg.companyId,
    externalId: event.message.message_id,
    title: title.slice(0, 200),
    data: {
      issueId: issue.id,
      inboxId: event.message.inbox_id,
      messageId: event.message.message_id,
      eventId: event.eventId,
    },
  });

  await ctx.entities.upsert({
    entityType: ENTITY_TYPE_THREAD,
    scopeKind: "company",
    scopeId: cfg.companyId,
    externalId: threadKey,
    title: title.slice(0, 200),
    data: {
      issueId: issue.id,
      inboxId: event.message.inbox_id,
      threadId: event.message.thread_id,
    },
  });

  const bearer = routing.mailbox.inboxApiKey;
  const attachmentList = await resolveAttachmentList(
    ctx,
    cfg,
    bearer,
    event.message.inbox_id,
    event.message.message_id,
    event.message.attachments ?? [],
  );

  const descLines = [
    description,
    "",
    "**Attachments (issue documents):**",
    ...attachmentList.map(
      (a) => `- ${a.filename ?? a.attachment_id} (${a.size} bytes, id \`${a.attachment_id}\`)`,
    ),
  ];
  if (attachmentList.length) {
    await ctx.issues.update(issue.id, { description: descLines.join("\n") }, cfg.companyId);
  }

  await runIngestAndFailureComment({
    ctx,
    cfg,
    routing,
    evt: event,
    issueId: issue.id,
    attachmentList,
  });

  await ctx.activity.log({
    companyId: cfg.companyId,
    entityType: "issue",
    entityId: issue.id,
    message: `AgentMail created issue from message ${event.message.message_id}`,
    metadata: { plugin: PLUGIN_ID, inboxId: event.message.inbox_id, source: meta.source },
  });
  return { kind: "created_issue", issueId: issue.id };
}
