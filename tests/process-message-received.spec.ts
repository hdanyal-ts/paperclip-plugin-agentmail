import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { processMessageReceivedEvent } from "../src/process-message-received.js";
import { ENTITY_TYPE_MESSAGE, ENTITY_TYPE_THREAD } from "../src/constants.js";
import type { AgentmailPluginConfig } from "../src/config.js";
import type { MessageReceivedEvent } from "../src/parse-webhook.js";

function baseCfg(): AgentmailPluginConfig {
  return {
    companyId: "co-1",
    agentmailWebhookSecretRef: "sec",
    eventDelivery: "webhook",
    agentmailWebsocketUrl: "wss://ws.agentmail.to/v0",
    agentmailApiBase: "https://api.agentmail.to",
    mailboxes: [
      {
        inboxId: "support@example.com",
        inboxApiKey: "am_key",
        assignments: [{ agentId: "ag-1" }],
      },
    ],
    unreadSyncOnStartup: true,
    unreadSyncIntervalSeconds: 300,
    unreadSyncMaxPerRun: 50,
    blogDedupe: {
      enabled: false,
      sitemapUrls: [],
      markReadOnDuplicate: true,
      createIssueForDuplicate: false,
      sitemapTtlMs: 6 * 60 * 60 * 1000,
      maxExtractBytes: 15 * 1024 * 1024,
      maxExtractTextChars: 500_000,
    },
  };
}

type EntityRow = {
  id: string;
  entityType: string;
  externalId: string | null;
  scopeKind: string;
  scopeId: string | null;
  data: Record<string, unknown>;
};

type IssueRow = { id: string; title: string; status: "todo" | "in_progress"; companyId: string };

function createCtx(
  entityRows: EntityRow[],
  opts?: {
    issuesGetImpl?: (issueId: string) => Promise<IssueRow | null>;
  },
): PluginContext {
  let entId = 0;
  const issuesCreate = vi.fn(async () => ({
    id: "iss-1",
    title: "t",
    status: "todo" as const,
    companyId: "co-1",
  }));
  const defaultIssuesGet = async (issueId: string) =>
    issueId === "iss-1" ? { id: "iss-1", title: "t", status: "in_progress" as const, companyId: "co-1" } : null;
  const issuesGet = vi.fn(opts?.issuesGetImpl ?? defaultIssuesGet);
  const issuesUpdate = vi.fn(async () => ({ id: "iss-1" }));
  const issuesCreateComment = vi.fn(async () => ({ id: "c1" }));
  const documentsUpsert = vi.fn(async () => ({ id: "d1" }));

  const list = vi.fn(
    async (q: {
      entityType?: string;
      externalId?: string;
      scopeKind?: string;
      scopeId?: string;
      limit?: number;
    }) => {
      return entityRows.filter((r) => {
        if (q.entityType && r.entityType !== q.entityType) return false;
        if (q.externalId !== undefined && q.externalId !== null && r.externalId !== q.externalId) return false;
        if (q.scopeKind && r.scopeKind !== q.scopeKind) return false;
        if (q.scopeId !== undefined && q.scopeId !== null && r.scopeId !== q.scopeId) return false;
        return true;
      });
    },
  );

  const upsert = vi.fn(
    async (u: {
      entityType: string;
      scopeKind: string;
      scopeId?: string;
      externalId?: string;
      data: Record<string, unknown>;
    }) => {
      entId += 1;
      const row: EntityRow = {
        id: `e${entId}`,
        entityType: u.entityType,
        externalId: u.externalId ?? null,
        scopeKind: u.scopeKind,
        scopeId: u.scopeId ?? null,
        data: u.data,
      };
      const idx = entityRows.findIndex(
        (r) =>
          r.entityType === u.entityType &&
          r.externalId === (u.externalId ?? null) &&
          r.scopeId === (u.scopeId ?? null),
      );
      if (idx >= 0) entityRows[idx] = row;
      else entityRows.push(row);
      return { ...row, title: null, status: null, createdAt: "", updatedAt: "" };
    },
  );

  const httpFetch = vi.fn(async (url: string) => {
    if (url.includes("/messages/msg-1") && !url.includes("/attachments")) {
      return new Response(JSON.stringify({ attachments: [] }), { status: 200 });
    }
    if (url.includes("/messages/msg-2") && !url.includes("/attachments")) {
      return new Response(JSON.stringify({ attachments: [] }), { status: 200 });
    }
    if (url.includes("/messages/msg-chain-2") && !url.includes("/attachments")) {
      return new Response(
        JSON.stringify({ attachments: [], in_reply_to: "msg-chain-1" }),
        { status: 200 },
      );
    }
    if (url.includes("/messages/msg-stale-") && !url.includes("/attachments")) {
      return new Response(JSON.stringify({ attachments: [] }), { status: 200 });
    }
    if (url.endsWith("/attachments/at1") || url.includes("/attachments/at1")) {
      return new Response(
        JSON.stringify({
          attachment_id: "at1",
          download_url: "https://files.example/a",
          content_type: "application/pdf",
          size: 4,
        }),
        { status: 200 },
      );
    }
    if (url === "https://files.example/a") {
      return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });

  return {
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
    http: { fetch: httpFetch },
    entities: { list, upsert },
    agents: { get: vi.fn(async () => ({ id: "ag-1", status: "idle" })) },
    projects: { get: vi.fn(async () => ({ id: "p1" })) },
    issues: {
      create: issuesCreate,
      get: issuesGet,
      update: issuesUpdate,
      createComment: issuesCreateComment,
      documents: { upsert: documentsUpsert },
    },
    activity: { log: vi.fn(async () => {}) },
  } as unknown as PluginContext;
}

function evt(
  mid: string,
  thread: string,
  text: string,
  attachments?: MessageReceivedEvent["message"]["attachments"],
  reply?: { in_reply_to?: string; references?: string[] },
): MessageReceivedEvent {
  return {
    eventId: `ev-${mid}`,
    message: {
      inbox_id: "support@example.com",
      thread_id: thread,
      message_id: mid,
      labels: [],
      from: "a@b.com",
      to: ["support@example.com"],
      subject: "Subj",
      text,
      attachments,
      ...(reply?.in_reply_to ? { in_reply_to: reply.in_reply_to } : {}),
      ...(reply?.references?.length ? { references: reply.references } : {}),
    },
  };
}

describe("processMessageReceivedEvent", () => {
  let rows: EntityRow[];
  let ctx: PluginContext;

  beforeEach(() => {
    vi.useFakeTimers();
    rows = [];
    ctx = createCtx(rows);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function run(
    c: PluginContext,
    cfg: AgentmailPluginConfig,
    e: MessageReceivedEvent,
    meta: { requestId: string; source: "webhook" | "websocket" | "catchup" },
  ) {
    const p = processMessageReceivedEvent(c, cfg, e, meta);
    await vi.runAllTimersAsync();
    await p;
  }

  it("creates one issue for two messages in the same thread; second adds comment and sets todo", async () => {
    const cfg = baseCfg();
    await run(ctx, cfg, evt("msg-1", "th-1", "first"), {
      requestId: "r1",
      source: "webhook",
    });
    await run(ctx, cfg, evt("msg-2", "th-1", "second"), {
      requestId: "r2",
      source: "webhook",
    });

    const issues = ctx.issues as unknown as {
      create: ReturnType<typeof vi.fn>;
      createComment: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    expect(issues.create).toHaveBeenCalledTimes(1);
    expect(issues.createComment).toHaveBeenCalledTimes(1);
    const todoPatch = issues.update.mock.calls.find((c) => c[1]?.status === "todo");
    expect(todoPatch).toBeDefined();

    const threads = rows.filter((r) => r.entityType === ENTITY_TYPE_THREAD);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.data.issueId).toBe("iss-1");
    const messages = rows.filter((r) => r.entityType === ENTITY_TYPE_MESSAGE);
    expect(messages).toHaveLength(2);
  });

  it("skips duplicate message_id (idempotent)", async () => {
    const cfg = baseCfg();
    const e = evt("msg-dup", "th-d", "once");
    await run(ctx, cfg, e, { requestId: "r1", source: "webhook" });
    await run(ctx, cfg, e, { requestId: "r2", source: "webhook" });

    const issues = ctx.issues as unknown as { create: ReturnType<typeof vi.fn> };
    expect(issues.create).toHaveBeenCalledTimes(1);
  });

  it("ingests PDF attachment on follow-up into the existing issue", async () => {
    const cfg = baseCfg();
    await run(ctx, cfg, evt("msg-1", "th-pdf", "first"), {
      requestId: "r1",
      source: "webhook",
    });

    await run(
      ctx,
      cfg,
      evt("msg-2", "th-pdf", "with pdf", [
        { attachment_id: "at1", filename: "doc.pdf", size: 4, content_type: "application/pdf" },
      ]),
      { requestId: "r2", source: "webhook" },
    );

    const docs = ctx.issues.documents as unknown as { upsert: ReturnType<typeof vi.fn> };
    expect(docs.upsert).toHaveBeenCalled();
    const pdfUpsert = docs.upsert.mock.calls.find((c) => c[0]?.key === "email/att-at1");
    expect(pdfUpsert).toBeDefined();
  });

  it("creates one issue when second message has different thread_id but in_reply_to matches first message", async () => {
    const cfg = baseCfg();
    await run(ctx, cfg, evt("msg-chain-1", "th-a", "first"), { requestId: "r1", source: "webhook" });
    await run(
      ctx,
      cfg,
      evt("msg-chain-2", "th-b", "second", undefined, { in_reply_to: "msg-chain-1" }),
      { requestId: "r2", source: "webhook" },
    );

    const issues = ctx.issues as unknown as {
      create: ReturnType<typeof vi.fn>;
      createComment: ReturnType<typeof vi.fn>;
    };
    expect(issues.create).toHaveBeenCalledTimes(1);
    expect(issues.createComment).toHaveBeenCalledTimes(1);
  });

  it("merges in_reply_to from GET message when webhook omits it (different thread_id)", async () => {
    const cfg = baseCfg();
    await run(ctx, cfg, evt("msg-chain-1", "th-a", "first"), { requestId: "r1", source: "webhook" });
    await run(ctx, cfg, evt("msg-chain-2", "th-b", "second"), { requestId: "r2", source: "webhook" });

    const issues = ctx.issues as unknown as {
      create: ReturnType<typeof vi.fn>;
      createComment: ReturnType<typeof vi.fn>;
    };
    expect(issues.create).toHaveBeenCalledTimes(1);
    expect(issues.createComment).toHaveBeenCalledTimes(1);
  });

  it("resolves issue via reply chain when thread entity points at missing issue", async () => {
    const customCtx = createCtx(rows, {
      issuesGetImpl: async (issueId: string) =>
        issueId === "iss-1"
          ? { id: "iss-1", title: "t", status: "in_progress", companyId: "co-1" }
          : null,
    });
    const cfg = baseCfg();
    await run(customCtx, cfg, evt("msg-stale-1", "th-stale", "first"), {
      requestId: "r1",
      source: "webhook",
    });

    const threadIdx = rows.findIndex((r) => r.entityType === ENTITY_TYPE_THREAD);
    expect(threadIdx).toBeGreaterThanOrEqual(0);
    rows[threadIdx] = {
      ...rows[threadIdx]!,
      data: { ...rows[threadIdx]!.data, issueId: "iss-stale" },
    };

    await run(
      customCtx,
      cfg,
      evt("msg-stale-2", "th-stale", "second", undefined, { in_reply_to: "msg-stale-1" }),
      { requestId: "r2", source: "webhook" },
    );

    const issues = customCtx.issues as unknown as {
      create: ReturnType<typeof vi.fn>;
      createComment: ReturnType<typeof vi.fn>;
    };
    expect(issues.create).toHaveBeenCalledTimes(1);
    expect(issues.createComment).toHaveBeenCalledTimes(1);
  });
});
