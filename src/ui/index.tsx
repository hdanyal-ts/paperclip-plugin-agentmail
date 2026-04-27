import { type FormEvent, useEffect, useState, type CSSProperties } from "react";
import {
  useHostContext,
  usePluginAction,
  usePluginData,
  type PluginSettingsPageProps,
} from "@paperclipai/plugin-sdk/ui";
import { DEFAULT_AGENTMAIL_API_BASE, DEFAULT_AGENTMAIL_WS_URL, PLUGIN_ID } from "../constants.js";
import {
  needsWebhookSecret,
  normalizeEventDelivery,
  parseBlogDedupe,
  parseConfig,
  validateMailboxShape,
  type BlogDedupeConfig,
  type MailboxConfig,
} from "../config.js";

const layout: CSSProperties = { display: "grid", gap: "16px", maxWidth: "920px" };
const card: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "12px",
  padding: "16px",
  display: "grid",
  gap: "18px",
};
const fieldStack: CSSProperties = { display: "grid", gap: "18px" };
const fieldLabel: CSSProperties = { display: "grid", gap: "8px" };
const input: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: "8px",
  border: "1px solid var(--border)",
  background: "var(--background)",
  color: "var(--foreground)",
};
const btn: CSSProperties = {
  padding: "8px 14px",
  borderRadius: "8px",
  border: "1px solid var(--border)",
  cursor: "pointer",
  background: "var(--card)",
};
const btnDanger: CSSProperties = { ...btn, color: "var(--destructive, #c00)" };
const innerCard: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "10px",
  padding: "14px",
  display: "grid",
  gap: "14px",
};

type WebhookInfo = { webhookPath: string; endpointKey: string };

type AgentRow = { id: string; name: string; status: string };

type FormAssignment = {
  agentId: string;
  handlingInstructions: string;
  recipientMatch: string;
};

type FormMailbox = {
  inboxId: string;
  inboxApiKey: string;
  displayName: string;
  assignments: FormAssignment[];
};

function hostFetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  return fetch(path, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  }).then(async (response) => {
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Request failed: ${response.status}`);
    }
    return (await response.json()) as T;
  });
}

function emptyAssignment(): FormAssignment {
  return { agentId: "", handlingInstructions: "", recipientMatch: "" };
}

function emptyMailbox(): FormMailbox {
  return {
    inboxId: "",
    inboxApiKey: "",
    displayName: "",
    assignments: [emptyAssignment()],
  };
}

function mailboxesFromConfig(raw: unknown): FormMailbox[] {
  if (!Array.isArray(raw) || raw.length === 0) return [emptyMailbox()];
  const out: FormMailbox[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const m = row as Record<string, unknown>;
    const assignmentsRaw = m.assignments;
    const assignments: FormAssignment[] = [];
    if (Array.isArray(assignmentsRaw)) {
      for (const a of assignmentsRaw) {
        if (!a || typeof a !== "object") continue;
        const ar = a as Record<string, unknown>;
        assignments.push({
          agentId: typeof ar.agentId === "string" ? ar.agentId : "",
          handlingInstructions: typeof ar.handlingInstructions === "string" ? ar.handlingInstructions : "",
          recipientMatch: typeof ar.recipientMatch === "string" ? ar.recipientMatch : "",
        });
      }
    }
    if (assignments.length === 0) assignments.push(emptyAssignment());
    const key =
      (typeof m.inboxApiKey === "string" ? m.inboxApiKey : "") ||
      (typeof m.apiKeySecretRef === "string" ? m.apiKeySecretRef : "");
    out.push({
      inboxId: typeof m.inboxId === "string" ? m.inboxId : "",
      inboxApiKey: key,
      displayName: typeof m.displayName === "string" ? m.displayName : "",
      assignments,
    });
  }
  return out.length > 0 ? out : [emptyMailbox()];
}

function serializeMailboxes(form: FormMailbox[]): MailboxConfig[] {
  return form.map((mb) => {
    const assignments = mb.assignments.map((a) => {
      const item: {
        agentId: string;
        handlingInstructions?: string;
        recipientMatch?: string;
      } = { agentId: a.agentId.trim() };
      const hi = a.handlingInstructions.trim();
      if (hi) item.handlingInstructions = hi;
      const rm = a.recipientMatch.trim();
      if (rm) item.recipientMatch = rm;
      return item;
    });
    const box: MailboxConfig = {
      inboxId: mb.inboxId.trim(),
      inboxApiKey: mb.inboxApiKey.trim(),
      assignments,
    };
    const dn = mb.displayName.trim();
    if (dn) box.displayName = dn;
    return box;
  });
}

function validateClient(
  config: Record<string, unknown>,
  mailboxes: MailboxConfig[],
): string | null {
  const companyId = typeof config.companyId === "string" ? config.companyId.trim() : "";
  if (!companyId) return "Company ID is required.";

  const mode = normalizeEventDelivery(config.eventDelivery);
  if (needsWebhookSecret(mode)) {
    const wh =
      typeof config.agentmailWebhookSecretRef === "string"
        ? config.agentmailWebhookSecretRef.trim()
        : "";
    if (!wh) return "Webhook signing secret reference is required when delivery includes webhooks.";
  }

  if (mailboxes.length === 0) return "Add at least one mailbox.";

  for (let i = 0; i < mailboxes.length; i++) {
    const mb = mailboxes[i]!;
    if (!mb.inboxId.trim()) return `Mailbox ${i + 1}: inbox email (address) is required.`;
    if (!mb.inboxApiKey.trim()) return `Mailbox ${i + 1}: inbox API key is required.`;
    if (mb.assignments.length === 0)
      return `Mailbox ${i + 1}: add at least one agent assignment.`;
    for (let j = 0; j < mb.assignments.length; j++) {
      if (!mb.assignments[j]!.agentId.trim()) {
        return `Mailbox ${i + 1}, assignment ${j + 1}: select or enter an agent.`;
      }
    }
  }

  return null;
}

export function AgentmailSettingsPage(_props: PluginSettingsPageProps) {
  const host = useHostContext();
  const webhookQuery = usePluginData<WebhookInfo>("webhook-info", {});
  const syncSummaryQuery = usePluginData<{ summary: unknown }>("unread-sync-summary", {});
  const verifyAction = usePluginAction("verify-mailbox");
  const syncUnreadAction = usePluginAction("sync-unread-now");

  const [configJson, setConfigJson] = useState<Record<string, unknown>>({});
  const [mailboxesForm, setMailboxesForm] = useState<FormMailbox[]>([emptyMailbox()]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [verifyInbox, setVerifyInbox] = useState("");
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncActionResult, setSyncActionResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    hostFetchJson<{ configJson?: Record<string, unknown> | null } | null>(`/api/plugins/${PLUGIN_ID}/config`)
      .then((result) => {
        if (cancelled) return;
        const next = { ...(result?.configJson ?? {}) };
        const parsed = parseConfig(next as Record<string, unknown>);
        if (parsed) {
          setConfigJson({
            ...next,
            unreadSyncOnStartup: parsed.unreadSyncOnStartup,
            unreadSyncIntervalSeconds: parsed.unreadSyncIntervalSeconds,
            unreadSyncMaxPerRun: parsed.unreadSyncMaxPerRun,
            blogDedupe: parsed.blogDedupe,
          });
        } else {
          setConfigJson(next);
        }
        setMailboxesForm(mailboxesFromConfig(next.mailboxes));
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const companyId = host.companyId;
    if (!companyId) {
      setAgents([]);
      return;
    }
    hostFetchJson<AgentRow[]>(`/api/companies/${companyId}/agents`)
      .then((rows) => {
        if (cancelled) return;
        const active = rows.filter((a) => a.status !== "terminated");
        const sorted = [...active].sort((a, b) => a.name.localeCompare(b.name));
        setAgents(sorted);
      })
      .catch(() => {
        if (!cancelled) setAgents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [host.companyId]);

  async function save(next: Record<string, unknown>) {
    setSaving(true);
    try {
      await hostFetchJson(`/api/plugins/${PLUGIN_ID}/config`, {
        method: "POST",
        body: JSON.stringify({ configJson: next }),
      });
      setConfigJson(next);
      setMailboxesForm(mailboxesFromConfig(next.mailboxes));
      setError(null);
      setSaved("Saved");
      window.setTimeout(() => setSaved(null), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setSaving(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const mailboxes = serializeMailboxes(mailboxesForm);
    const clientErr = validateClient(configJson, mailboxes);
    if (clientErr) {
      setError(clientErr);
      return;
    }
    const next = { ...configJson, mailboxes };
    const parsed = parseConfig(next as Record<string, unknown>);
    if (!parsed) {
      setError(
        "Configuration could not be validated. Check company, mailboxes, and webhook secret when using webhooks.",
      );
      return;
    }
    const shape = validateMailboxShape(parsed);
    if (!shape.ok) {
      setError(shape.errors.join(" "));
      return;
    }
    await save(next);
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl =
    webhookQuery.data && origin ? `${origin}${webhookQuery.data.webhookPath}` : webhookQuery.data?.webhookPath ?? "";

  function updateMailbox(index: number, patch: Partial<FormMailbox>) {
    setMailboxesForm((prev) => {
      const next = [...prev];
      const cur = next[index];
      if (!cur) return prev;
      next[index] = { ...cur, ...patch };
      return next;
    });
  }

  function updateAssignment(mailboxIndex: number, assignmentIndex: number, patch: Partial<FormAssignment>) {
    setMailboxesForm((prev) => {
      const next = [...prev];
      const mb = next[mailboxIndex];
      if (!mb) return prev;
      const assignments = [...mb.assignments];
      const row = assignments[assignmentIndex];
      if (!row) return prev;
      assignments[assignmentIndex] = { ...row, ...patch };
      next[mailboxIndex] = { ...mb, assignments };
      return next;
    });
  }

  if (loading) {
    return <div style={{ fontSize: "13px", opacity: 0.75 }}>Loading…</div>;
  }

  const canPickAgents = Boolean(host.companyId);
  const deliveryMode = normalizeEventDelivery(configJson.eventDelivery);
  const showWebhookDocs = needsWebhookSecret(deliveryMode);
  const showWebsocketFields = deliveryMode === "websocket" || deliveryMode === "both";
  const blog = parseBlogDedupe(configJson.blogDedupe);

  function patchBlogDedupe(patch: Partial<BlogDedupeConfig>) {
    setConfigJson((c) => ({
      ...c,
      blogDedupe: { ...parseBlogDedupe(c.blogDedupe), ...patch },
    }));
  }

  return (
    <form onSubmit={onSubmit} style={layout}>
      <div style={{ ...card, opacity: 0.95 }}>
        <strong>Agent tools (heartbeats)</strong>
        <p style={{ fontSize: "12px", lineHeight: 1.55, margin: 0 }}>
          Agents use the Paperclip <strong>paperclip</strong> skill to call <code>GET /api/plugins/tools</code> and{" "}
          <code>POST /api/plugins/tools/execute</code> with their run token (same bearer as other <code>/api</code> calls).
          Each agent must be assigned to a mailbox below or tools return an assignment error. The issue description{" "}
          <strong>### AgentMail</strong> block lists <strong>thread_id</strong> and the first <strong>message_id</strong>.
          Use <code>agentmail_get_thread</code> with <strong>thread_id</strong> to read the full conversation, then{" "}
          <code>agentmail_reply_to_message</code> with the appropriate <strong>message_id</strong>; use{" "}
          <code>agentmail_send_message</code> only for new threads.
        </p>
      </div>
      <div style={card}>
        <strong>Core settings</strong>
        <div style={fieldStack}>
          <label style={fieldLabel}>
            <span style={{ fontSize: "12px" }}>Company ID</span>
            <input
              style={input}
              value={String(configJson.companyId ?? "")}
              onChange={(ev) => setConfigJson((c) => ({ ...c, companyId: ev.target.value }))}
            />
          </label>
          <label style={fieldLabel}>
            <span style={{ fontSize: "12px" }}>Event delivery</span>
            <select
              style={input}
              value={deliveryMode}
              onChange={(ev) => setConfigJson((c) => ({ ...c, eventDelivery: ev.target.value }))}
            >
              <option value="webhook">Webhook (HTTPS, Svix-signed)</option>
              <option value="websocket">WebSocket only (outbound to AgentMail)</option>
              <option value="both">Both (dedupe by message id)</option>
            </select>
            {deliveryMode === "websocket" ? (
              <span style={{ fontSize: "11px", lineHeight: 1.45, opacity: 0.85 }}>
                No inbound webhook URL is used. The worker connects to AgentMail over WebSockets (TLS + inbox API keys).
                Choose <strong>Save configuration</strong> so this mode is stored.
              </span>
            ) : null}
            {deliveryMode === "both" ? (
              <span style={{ fontSize: "11px", lineHeight: 1.45, opacity: 0.85 }}>
                Webhook and WebSocket can both deliver events; duplicates are skipped by <code>message_id</code>.
              </span>
            ) : null}
          </label>
          {showWebsocketFields ? (
            <label style={fieldLabel}>
              <span style={{ fontSize: "12px" }}>WebSocket URL (path included)</span>
              <input
                style={input}
                value={String(configJson.agentmailWebsocketUrl ?? DEFAULT_AGENTMAIL_WS_URL)}
                onChange={(ev) => setConfigJson((c) => ({ ...c, agentmailWebsocketUrl: ev.target.value }))}
              />
            </label>
          ) : null}
          <label style={fieldLabel}>
            <span style={{ fontSize: "12px" }}>Default project ID (optional)</span>
            <input
              style={input}
              value={String(configJson.projectId ?? "")}
              onChange={(ev) => setConfigJson((c) => ({ ...c, projectId: ev.target.value }))}
            />
          </label>
          <label style={fieldLabel}>
            <span style={{ fontSize: "12px" }}>AgentMail API base</span>
            <input
              style={input}
              value={String(configJson.agentmailApiBase ?? DEFAULT_AGENTMAIL_API_BASE)}
              onChange={(ev) => setConfigJson((c) => ({ ...c, agentmailApiBase: ev.target.value }))}
            />
          </label>
          {showWebhookDocs ? (
            <label style={fieldLabel}>
              <span style={{ fontSize: "12px" }}>Webhook secret ref (Paperclip secret)</span>
              <input
                style={input}
                type="password"
                autoComplete="off"
                value={String(configJson.agentmailWebhookSecretRef ?? "")}
                onChange={(ev) => setConfigJson((c) => ({ ...c, agentmailWebhookSecretRef: ev.target.value }))}
              />
            </label>
          ) : null}
          <label style={fieldLabel}>
            <span style={{ fontSize: "12px" }}>Title prefix (optional)</span>
            <input
              style={input}
              value={String(configJson.titlePrefix ?? "")}
              onChange={(ev) => setConfigJson((c) => ({ ...c, titlePrefix: ev.target.value }))}
            />
          </label>
        </div>
      </div>

      {showWebhookDocs ? (
        <div style={card}>
          <strong>HTTP webhook (AgentMail → Paperclip)</strong>
          <div style={fieldStack}>
            <p style={{ fontSize: "13px", lineHeight: 1.5, margin: 0 }}>
              Register this URL in AgentMail with your signing secret. Paperclip returns HTTP 200 on success; verification
              failures surface as delivery errors (worker throws → 502 on the host).
            </p>
            {webhookQuery.loading ? (
              <div style={{ fontSize: "12px" }}>Resolving webhook path…</div>
            ) : webhookQuery.error ? (
              <div style={{ fontSize: "12px", color: "var(--destructive, #c00)" }}>{webhookQuery.error.message}</div>
            ) : (
              <label style={fieldLabel}>
                <span style={{ fontSize: "12px" }}>Inbound URL</span>
                <input style={input} readOnly value={webhookUrl} onFocus={(ev) => ev.currentTarget.select()} />
              </label>
            )}
          </div>
        </div>
      ) : null}

      <div style={card}>
        <strong>Mailboxes</strong>
        <div style={fieldStack}>
          <p style={{ fontSize: "12px", lineHeight: 1.5, margin: 0 }}>
            Each inbox is one email address AgentMail delivers to. Paste each inbox&apos;s raw <code>am_…</code> API key
            below (it is stored in this plugin&apos;s config). If several agents share one inbox, set{" "}
            <strong>Only when addressed to</strong> on each row so routing stays unambiguous.
          </p>
          {!canPickAgents ? (
            <p style={{ fontSize: "12px", margin: 0, opacity: 0.85 }}>
              Select a company in the board to pick agents. Without board company context, type each agent UUID in the fields
              below.
            </p>
          ) : null}
          {mailboxesForm.map((mb, mi) => (
            <div key={mi} style={innerCard}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                <strong style={{ fontSize: "13px" }}>Mailbox {mi + 1}</strong>
                <button
                  type="button"
                  style={btnDanger}
                  disabled={mailboxesForm.length <= 1}
                  onClick={() =>
                    setMailboxesForm((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== mi)))
                  }
                >
                  Remove mailbox
                </button>
              </div>
              <div style={fieldStack}>
                <label style={fieldLabel}>
                  <span style={{ fontSize: "12px" }}>Inbox email</span>
                  <input
                    style={input}
                    placeholder="support@yourdomain.com"
                    value={mb.inboxId}
                    onChange={(ev) => updateMailbox(mi, { inboxId: ev.target.value })}
                  />
                </label>
                <label style={fieldLabel}>
                  <span style={{ fontSize: "12px" }}>Display name (optional)</span>
                  <input
                    style={input}
                    value={mb.displayName}
                    onChange={(ev) => updateMailbox(mi, { displayName: ev.target.value })}
                  />
                </label>
                <label style={fieldLabel}>
                  <span style={{ fontSize: "12px" }}>Inbox API key</span>
                  <span style={{ fontSize: "11px", lineHeight: 1.45, opacity: 0.85 }}>
                    Paste the raw AgentMail inbox key (<code>am_…</code>). It is stored in this plugin&apos;s saved
                    configuration.
                  </span>
                  <input
                    style={input}
                    type="password"
                    autoComplete="off"
                    value={mb.inboxApiKey}
                    onChange={(ev) => updateMailbox(mi, { inboxApiKey: ev.target.value })}
                  />
                </label>
                <div style={{ display: "grid", gap: "12px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 600 }}>Who answers this inbox?</span>
                  {mb.assignments.map((a, ai) => (
                    <div
                      key={ai}
                      style={{
                        ...innerCard,
                        padding: "12px",
                        gap: "12px",
                        borderStyle: "dashed",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "12px" }}>Agent assignment {ai + 1}</span>
                        <button
                          type="button"
                          style={btnDanger}
                          disabled={mb.assignments.length <= 1}
                          onClick={() =>
                            setMailboxesForm((prev) => {
                              const copy = [...prev];
                              const box = copy[mi];
                              if (!box || box.assignments.length <= 1) return prev;
                              copy[mi] = {
                                ...box,
                                assignments: box.assignments.filter((_, j) => j !== ai),
                              };
                              return copy;
                            })
                          }
                        >
                          Remove agent
                        </button>
                      </div>
                      <label style={fieldLabel}>
                        <span style={{ fontSize: "12px" }}>Agent</span>
                        {canPickAgents ? (
                          <select
                            style={input}
                            value={a.agentId}
                            onChange={(ev) => updateAssignment(mi, ai, { agentId: ev.target.value })}
                          >
                            <option value="">— Select agent —</option>
                            {agents.map((ag) => (
                              <option key={ag.id} value={ag.id}>
                                {ag.name} ({ag.id.slice(0, 8)}…)
                              </option>
                            ))}
                            {a.agentId && !agents.some((ag) => ag.id === a.agentId) ? (
                              <option value={a.agentId}>{a.agentId} (from config)</option>
                            ) : null}
                          </select>
                        ) : (
                          <input
                            style={input}
                            placeholder="Agent UUID"
                            value={a.agentId}
                            onChange={(ev) => updateAssignment(mi, ai, { agentId: ev.target.value })}
                          />
                        )}
                      </label>
                      <label style={fieldLabel}>
                        <span style={{ fontSize: "12px" }}>Instructions for this agent (optional)</span>
                        <textarea
                          style={{ ...input, minHeight: "72px", resize: "vertical" }}
                          value={a.handlingInstructions}
                          onChange={(ev) => updateAssignment(mi, ai, { handlingInstructions: ev.target.value })}
                        />
                      </label>
                      <label style={fieldLabel}>
                        <span style={{ fontSize: "12px" }}>Only when the email is addressed to (optional)</span>
                        <input
                          style={input}
                          placeholder="Substring matched against To/Cc"
                          title="Use only if several agents share this inbox; case-insensitive match on part of To/Cc."
                          value={a.recipientMatch}
                          onChange={(ev) => updateAssignment(mi, ai, { recipientMatch: ev.target.value })}
                        />
                      </label>
                    </div>
                  ))}
                  <button
                    type="button"
                    style={btn}
                    onClick={() =>
                      setMailboxesForm((prev) => {
                        const copy = [...prev];
                        const box = copy[mi];
                        if (!box) return prev;
                        copy[mi] = { ...box, assignments: [...box.assignments, emptyAssignment()] };
                        return copy;
                      })
                    }
                  >
                    Add another agent to this inbox
                  </button>
                </div>
              </div>
            </div>
          ))}
          <button type="button" style={btn} onClick={() => setMailboxesForm((prev) => [...prev, emptyMailbox()])}>
            Add mailbox
          </button>
        </div>
      </div>

      <div style={card}>
        <strong>Catch-up &amp; blog dedupe</strong>
        <p style={{ fontSize: "12px", lineHeight: 1.5, margin: 0 }}>
          While Paperclip is down, AgentMail may still receive mail. The worker can list <strong>unread</strong> messages
          after restart and mark them read after ingesting. Optional <strong>blog dedupe</strong> fingerprints title+body
          (from the email or PDF/DOCX) and checks an optional sitemap for published URLs.
        </p>
        <div style={fieldStack}>
          <label style={{ ...fieldLabel, flexDirection: "row", alignItems: "center", gap: "8px" }}>
            <input
              type="checkbox"
              checked={configJson.unreadSyncOnStartup !== false}
              onChange={(ev) => setConfigJson((c) => ({ ...c, unreadSyncOnStartup: ev.target.checked }))}
            />
            <span style={{ fontSize: "12px" }}>Run unread catch-up when the worker starts</span>
          </label>
          <label style={fieldLabel}>
            <span style={{ fontSize: "12px" }}>Minimum seconds between scheduled catch-up runs</span>
            <input
              style={input}
              type="number"
              min={0}
              max={86400}
              value={Number(configJson.unreadSyncIntervalSeconds ?? 300)}
              onChange={(ev) =>
                setConfigJson((c) => ({
                  ...c,
                  unreadSyncIntervalSeconds: Number(ev.target.value) || 0,
                }))
              }
            />
            <span style={{ fontSize: "11px", opacity: 0.85 }}>0 disables the interval gate (scheduled job still fires every minute but skips).</span>
          </label>
          <label style={fieldLabel}>
            <span style={{ fontSize: "12px" }}>Max messages per mailbox per run</span>
            <input
              style={input}
              type="number"
              min={1}
              max={500}
              value={Number(configJson.unreadSyncMaxPerRun ?? 50)}
              onChange={(ev) =>
                setConfigJson((c) => ({
                  ...c,
                  unreadSyncMaxPerRun: Number(ev.target.value) || 50,
                }))
              }
            />
          </label>
          <label style={{ ...fieldLabel, flexDirection: "row", alignItems: "center", gap: "8px" }}>
            <input
              type="checkbox"
              checked={blog.enabled}
              onChange={(ev) => patchBlogDedupe({ enabled: ev.target.checked })}
            />
            <span style={{ fontSize: "12px" }}>Enable blog deduplication (fingerprints + optional sitemap)</span>
          </label>
          <label style={fieldLabel}>
            <span style={{ fontSize: "12px" }}>Sitemap URLs (one per line)</span>
            <textarea
              style={{ ...input, minHeight: "72px", fontFamily: "monospace" }}
              placeholder="https://example.com/sitemap.xml"
              value={blog.sitemapUrls.join("\n")}
              onChange={(ev) =>
                patchBlogDedupe({
                  sitemapUrls: ev.target.value
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label style={{ ...fieldLabel, flexDirection: "row", alignItems: "center", gap: "8px" }}>
            <input
              type="checkbox"
              checked={blog.markReadOnDuplicate}
              onChange={(ev) => patchBlogDedupe({ markReadOnDuplicate: ev.target.checked })}
            />
            <span style={{ fontSize: "12px" }}>Mark AgentMail read when a blog duplicate is detected (catch-up)</span>
          </label>
          <label style={{ ...fieldLabel, flexDirection: "row", alignItems: "center", gap: "8px" }}>
            <input
              type="checkbox"
              checked={blog.createIssueForDuplicate}
              onChange={(ev) => patchBlogDedupe({ createIssueForDuplicate: ev.target.checked })}
            />
            <span style={{ fontSize: "12px" }}>Create a small visibility issue for blog duplicates</span>
          </label>
        </div>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            style={btn}
            disabled={syncBusy}
            onClick={() => {
              setSyncBusy(true);
              void syncUnreadAction({})
                .then((r) => {
                  setError(null);
                  setSyncActionResult(JSON.stringify(r, null, 2));
                })
                .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setSyncBusy(false));
            }}
          >
            {syncBusy ? "Syncing…" : "Sync unread now"}
          </button>
          <button
            type="button"
            style={btn}
            onClick={() => void syncSummaryQuery.refresh?.()}
            disabled={syncSummaryQuery.loading}
          >
            Refresh last summary
          </button>
        </div>
        {syncActionResult ? (
          <pre style={{ fontSize: "10px", overflow: "auto", maxHeight: "120px", margin: "8px 0 0" }}>{syncActionResult}</pre>
        ) : null}
        {syncSummaryQuery.data?.summary ? (
          <pre style={{ fontSize: "10px", overflow: "auto", maxHeight: "160px", margin: "8px 0 0" }}>
            {JSON.stringify(syncSummaryQuery.data.summary, null, 2)}
          </pre>
        ) : syncSummaryQuery.loading ? (
          <div style={{ fontSize: "12px" }}>Loading last summary…</div>
        ) : null}
      </div>

      {error ? <div style={{ color: "var(--destructive, #c00)", fontSize: "13px" }}>{error}</div> : null}
      {saved ? <div style={{ fontSize: "13px" }}>{saved}</div> : null}

      <button type="submit" style={btn} disabled={saving}>
        {saving ? "Saving…" : "Save configuration"}
      </button>

      <div style={card}>
        <strong>Verify inbox API key</strong>
        <div style={fieldStack}>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
            <input
              style={{ ...input, flex: "1 1 200px" }}
              placeholder="inboxId (email)"
              value={verifyInbox}
              onChange={(ev) => setVerifyInbox(ev.target.value)}
            />
            <button
              type="button"
              style={btn}
              onClick={() => {
                setVerifyResult(null);
                void verifyAction({ inboxId: verifyInbox.trim() })
                  .then((r) => setVerifyResult(JSON.stringify(r, null, 2)))
                  .catch((e) => setVerifyResult(e instanceof Error ? e.message : String(e)));
              }}
            >
              GET inbox
            </button>
          </div>
          {verifyResult ? (
            <pre style={{ fontSize: "11px", overflow: "auto", maxHeight: "200px", margin: 0 }}>{verifyResult}</pre>
          ) : null}
        </div>
      </div>

      <div style={card}>
        <strong>Hygiene & docs</strong>
        <ul style={{ fontSize: "13px", lineHeight: 1.6, margin: 0, paddingLeft: "18px" }}>
          <li>
            <a href="https://docs.agentmail.to/webhook-setup.mdx" target="_blank" rel="noreferrer">
              Webhook setup
            </a>
          </li>
          <li>
            <a href="https://docs.agentmail.to/webhook-verification.mdx" target="_blank" rel="noreferrer">
              Svix verification
            </a>
          </li>
          <li>
            <a href="https://docs.agentmail.to/spam-virus-detection.mdx" target="_blank" rel="noreferrer">
              Spam & virus detection
            </a>
          </li>
          <li>
            <a href="https://docs.agentmail.to/openapi.json" target="_blank" rel="noreferrer">
              OpenAPI
            </a>
          </li>
          <li>
            <a href="https://docs.agentmail.to/llms.txt" target="_blank" rel="noreferrer">
              llms.txt
            </a>
          </li>
        </ul>
      </div>

      <div style={{ fontSize: "12px", opacity: 0.8 }}>
        Host company context: {host.companyId ?? "none"} (config companyId is independent — must match your routing).
      </div>
    </form>
  );
}
