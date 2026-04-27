import { describe, expect, it } from "vitest";
import { mergeAttachmentLists } from "../src/attachments.js";
import { resolveAssignee } from "../src/assignee.js";
import { normalizeEventDelivery, parseConfig, validateMailboxShape } from "../src/config.js";
import { parseWebhookEnvelope, replyGraphFromApiMessage } from "../src/parse-webhook.js";
import { verifyAgentmailWebhook } from "../src/svix-verify.js";

describe("parseWebhookEnvelope", () => {
  it("parses message.received shape", () => {
    const payload = {
      type: "event",
      event_type: "message.received",
      event_id: "evt_1",
      message: {
        inbox_id: "support@example.com",
        thread_id: "th_1",
        message_id: "msg_1",
        labels: [],
        from: "a@b.com",
        to: ["support@example.com"],
        subject: "Hi",
        text: "Body",
        attachments: [
          { attachment_id: "at_1", filename: "f.txt", size: 3, content_type: "text/plain" },
        ],
      },
      thread: { inbox_id: "support@example.com", thread_id: "th_1" },
    };
    const evt = parseWebhookEnvelope(payload);
    expect(evt?.message.message_id).toBe("msg_1");
    expect(evt?.message.attachments?.length).toBe(1);
  });

  it("parses attachments using id alias (OpenAPI-style)", () => {
    const evt = parseWebhookEnvelope({
      event_type: "message.received",
      event_id: "evt_id",
      message: {
        inbox_id: "support@example.com",
        thread_id: "th_1",
        message_id: "msg_1",
        labels: [],
        from: "a@b.com",
        to: ["support@example.com"],
        attachments: [{ id: "at_pdf", filename: "a.pdf", size: 1024, content_type: "application/pdf" }],
      },
    });
    expect(evt?.message.attachments?.length).toBe(1);
    expect(evt?.message.attachments?.[0]?.attachment_id).toBe("at_pdf");
    expect(evt?.message.attachments?.[0]?.content_type).toBe("application/pdf");
  });

  it("parses WebSocket-style message.received envelope", () => {
    const evt = parseWebhookEnvelope({
      type: "event",
      event_type: "message.received",
      event_id: "evt_ws",
      message: {
        inbox_id: "support@example.com",
        thread_id: "th_1",
        message_id: "msg_ws",
        labels: [],
        from: "a@b.com",
        to: ["support@example.com"],
        subject: "Ws",
        text: "Hi",
      },
      thread: { inbox_id: "support@example.com", thread_id: "th_1" },
    });
    expect(evt?.eventId).toBe("evt_ws");
    expect(evt?.message.message_id).toBe("msg_ws");
  });

  it("parses in_reply_to and references", () => {
    const evt = parseWebhookEnvelope({
      event_type: "message.received",
      event_id: "evt_r",
      message: {
        inbox_id: "support@example.com",
        thread_id: "th_1",
        message_id: "msg_2",
        labels: [],
        from: "a@b.com",
        to: ["support@example.com"],
        in_reply_to: "msg_1",
        references: ["msg_0", "msg_1"],
      },
    });
    expect(evt?.message.in_reply_to).toBe("msg_1");
    expect(evt?.message.references).toEqual(["msg_0", "msg_1"]);
  });

  it("returns null for other events", () => {
    expect(
      parseWebhookEnvelope({
        event_type: "other",
        event_id: "x",
        message: {
          inbox_id: "a@b.com",
          thread_id: "t",
          message_id: "m",
          labels: [],
          from: "x@y.com",
          to: ["a@b.com"],
          size: 1,
          updated_at: "2020-01-01T00:00:00Z",
          created_at: "2020-01-01T00:00:00Z",
        },
      }),
    ).toBeNull();
  });
});

describe("replyGraphFromApiMessage", () => {
  it("extracts in_reply_to and references from API JSON", () => {
    const g = replyGraphFromApiMessage({
      message_id: "m2",
      in_reply_to: "m1",
      references: ["m0", "m1"],
    });
    expect(g.in_reply_to).toBe("m1");
    expect(g.references).toEqual(["m0", "m1"]);
  });
});

describe("resolveAssignee", () => {
  const mailboxes = [
    {
      inboxId: "support@example.com",
      inboxApiKey: "am_test",
      assignments: [{ agentId: "agent-1" }],
    },
  ];

  it("single assignment", () => {
    const r = resolveAssignee(mailboxes, "support@example.com", ["support@example.com"], []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.agentId).toBe("agent-1");
  });

  it("recipientMatch disambiguates", () => {
    const mb = [
      {
        inboxId: "support@example.com",
        inboxApiKey: "am_test",
        assignments: [
          { agentId: "a1", recipientMatch: "alice@" },
          { agentId: "a2", recipientMatch: "bob@" },
        ],
      },
    ];
    const r = resolveAssignee(mb, "support@example.com", ["Alice <alice@x.com>"], []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.agentId).toBe("a1");
  });
});

describe("config", () => {
  it("parses minimal config", () => {
    const cfg = parseConfig({
      companyId: "c1",
      agentmailWebhookSecretRef: "sec",
      mailboxes: [
        {
          inboxId: "i@x.com",
          apiKeySecretRef: "k",
          assignments: [{ agentId: "a1" }],
        },
      ],
    });
    expect(cfg?.companyId).toBe("c1");
    expect(cfg?.mailboxes.length).toBe(1);
    expect(cfg?.mailboxes[0]?.inboxApiKey).toBe("k");
    expect(cfg?.eventDelivery).toBe("webhook");
  });

  it("parses inboxApiKey field", () => {
    const cfg = parseConfig({
      companyId: "c1",
      agentmailWebhookSecretRef: "sec",
      mailboxes: [
        {
          inboxId: "i@x.com",
          inboxApiKey: "am_direct",
          assignments: [{ agentId: "a1" }],
        },
      ],
    });
    expect(cfg?.mailboxes[0]?.inboxApiKey).toBe("am_direct");
  });

  it("parses websocket-only without webhook secret", () => {
    const cfg = parseConfig({
      companyId: "c1",
      eventDelivery: "websocket",
      mailboxes: [
        {
          inboxId: "i@x.com",
          apiKeySecretRef: "k",
          assignments: [{ agentId: "a1" }],
        },
      ],
    });
    expect(cfg).not.toBeNull();
    expect(cfg!.agentmailWebhookSecretRef).toBe("");
    expect(cfg!.eventDelivery).toBe("websocket");
  });

  it("rejects webhook mode without secret", () => {
    expect(
      parseConfig({
        companyId: "c1",
        eventDelivery: "webhook",
        mailboxes: [
          {
            inboxId: "i@x.com",
            apiKeySecretRef: "k",
            assignments: [{ agentId: "a1" }],
          },
        ],
      }),
    ).toBeNull();
  });

  it("normalizeEventDelivery defaults invalid to webhook", () => {
    expect(normalizeEventDelivery(undefined)).toBe("webhook");
    expect(normalizeEventDelivery("nope")).toBe("webhook");
  });

  it("validateMailboxShape catches duplicate agents", () => {
    const cfg = parseConfig({
      companyId: "c1",
      agentmailWebhookSecretRef: "sec",
      mailboxes: [
        {
          inboxId: "a@x.com",
          inboxApiKey: "k",
          assignments: [{ agentId: "same" }],
        },
        {
          inboxId: "b@x.com",
          inboxApiKey: "k2",
          assignments: [{ agentId: "same" }],
        },
      ],
    });
    expect(cfg).not.toBeNull();
    const v = validateMailboxShape(cfg!);
    expect(v.ok).toBe(false);
  });
});

describe("svix-verify", () => {
  it("throws when headers missing", () => {
    expect(() => verifyAgentmailWebhook("{}", {}, "whsec_test")).toThrow(/Svix/);
  });
});

describe("mergeAttachmentLists", () => {
  it("merges webhook partial row with API row (PDF from API)", () => {
    const webhook = [{ attachment_id: "at1", size: 0 }];
    const api = [{ attachment_id: "at1", filename: "doc.pdf", size: 72500, content_type: "application/pdf" }];
    const m = mergeAttachmentLists(webhook, api);
    expect(m).toHaveLength(1);
    expect(m[0]?.filename).toBe("doc.pdf");
    expect(m[0]?.content_type).toBe("application/pdf");
    expect(m[0]?.size).toBe(72500);
  });
});
