import { createHash } from "node:crypto";
import { htmlToText } from "html-to-text";
import type { PluginContext, PluginHttpClient } from "@paperclipai/plugin-sdk";
import mammoth from "mammoth";
import { amGetAttachmentMeta, fetchDownloadBytes } from "./agentmail-http.js";
import type { AgentmailPluginConfig, BlogDedupeConfig } from "./config.js";
import {
  ENTITY_TYPE_BLOG,
  PLUGIN_ID,
  STATE_NS_SITEMAP,
} from "./constants.js";
import type { MessageReceivedEvent, NormalizedAttachment } from "./parse-webhook.js";
import type { ProcessOutcome } from "./sync-outcomes.js";

const FINGERPRINT_VERSION = 1;

export type BlogFingerprint = {
  version: number;
  titleHash: string;
  contentHash: string;
  key: string;
  normalizedTitle: string;
  authorSummary: string;
};

function sha256hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Lowercase, collapse whitespace, trim. */
function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const SIGNATURE_LINE = /^(--|—|__)\s*$/m;

/**
 * Remove quoted replies, common signature blocks, and legal/tracking noise for fingerprinting.
 * Raw message bodies stay on the issue; this is match-only.
 */
export function stripBoilerplateForFingerprint(raw: string): string {
  let t = raw.replace(/\r\n/g, "\n");
  // Remove "On … wrote:" style quotes
  t = t.split(/\nOn .+ wrote:\n/i)[0] ?? t;
  t = t.split(/^>.*$/m)[0] ?? t;
  const sigIdx = t.search(SIGNATURE_LINE);
  if (sigIdx >= 0) t = t.slice(0, sigIdx);
  t = t
    .split("\n")
    .filter((line) => {
      const s = line.trim().toLowerCase();
      if (s.length === 0) return true;
      if (s.startsWith("unsubscribe")) return false;
      if (s.startsWith("this email was sent")) return false;
      if (s.includes("confidentiality notice")) return false;
      if (s.includes("disclaimer") && s.length < 200) return false;
      return true;
    })
    .join("\n");
  return normalizeSpace(t);
}

function htmlToPlain(html: string): string {
  try {
    return htmlToText(html, { wordwrap: false });
  } catch {
    return html;
  }
}

function pickPlainBody(evt: MessageReceivedEvent): string {
  if (evt.message.html?.trim()) {
    return stripBoilerplateForFingerprint(htmlToPlain(evt.message.html));
  }
  if (evt.message.text?.trim()) {
    return stripBoilerplateForFingerprint(evt.message.text);
  }
  return "";
}

const BYLINE_PATTERNS: RegExp[] = [
  /^(?:author|by|written by)\s*:\s*(.+)$/gim,
  /^by\s+([^\n]+)$/gim,
];

function extractAuthorFromText(text: string, sender: string): { label: string; source: "byline" | "sender" } {
  for (const re of BYLINE_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m?.[1]?.trim()) {
      return { label: m[1].trim().slice(0, 200), source: "byline" };
    }
  }
  const f = sender.replace(/<[^>]+>/g, "").trim();
  const emailOnly = f.match(/([^\s<]+@[^\s>]+)/);
  return { label: (emailOnly?.[1] ?? f).slice(0, 200), source: "sender" };
}

function filenameLooksArticle(name: string): boolean {
  const n = name.toLowerCase();
  if (n.includes("invoice") || n.includes("w9") || n.includes("receipt") || n.includes("photo")) {
    return false;
  }
  if (n.endsWith(".pdf") || n.endsWith(".docx") || n.endsWith(".doc")) return true;
  return false;
}

function pickArticleAttachments(attachments: NormalizedAttachment[] | undefined): NormalizedAttachment[] {
  if (!attachments?.length) return [];
  const scored = attachments
    .map((a) => ({
      a,
      ok: filenameLooksArticle(a.filename ?? a.attachment_id) && a.size > 0,
    }))
    .filter((x) => x.ok);
  return scored.map((s) => s.a).sort((a, b) => b.size - a.size);
}

async function extractPdfText(buf: ArrayBuffer, maxTextChars: number): Promise<string> {
  const nodeBuf = Buffer.from(buf);
  const { default: pdfParse } = await import("pdf-parse");
  const res = await pdfParse(nodeBuf);
  const t = String(res.text ?? "");
  return t.length > maxTextChars ? t.slice(0, maxTextChars) : t;
}

async function extractDocxText(buf: ArrayBuffer, maxTextChars: number): Promise<string> {
  const r = await mammoth.extractRawText({ buffer: Buffer.from(buf) });
  const t = r.value ?? "";
  return t.length > maxTextChars ? t.slice(0, maxTextChars) : t;
}

async function extractTextFromAttachment(
  http: PluginHttpClient,
  apiBase: string,
  bearer: string,
  inboxId: string,
  messageId: string,
  att: NormalizedAttachment,
  cfg: BlogDedupeConfig,
): Promise<string | null> {
  const maxBytes = Math.min(cfg.maxExtractBytes, att.size);
  if (maxBytes <= 0) return null;
  let meta: { download_url: string };
  try {
    meta = await amGetAttachmentMeta(http, apiBase, bearer, inboxId, messageId, att.attachment_id);
  } catch {
    return null;
  }
  let bytes: Uint8Array;
  try {
    bytes = await fetchDownloadBytes(http, meta.download_url, maxBytes);
  } catch {
    return null;
  }
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const name = (att.filename ?? "").toLowerCase();
  try {
    if (name.endsWith(".pdf")) {
      return await extractPdfText(buf, cfg.maxExtractTextChars);
    }
    if (name.endsWith(".docx")) {
      return await extractDocxText(buf, cfg.maxExtractTextChars);
    }
  } catch {
    return null;
  }
  return null;
}

export function buildFingerprint(
  title: string,
  bodyText: string,
): BlogFingerprint {
  const normalizedTitle = normalizeSpace(title).toLowerCase();
  const body = stripBoilerplateForFingerprint(bodyText);
  const titleHash = sha256hex(normalizedTitle);
  const contentHash = sha256hex(body);
  const key = `v${FINGERPRINT_VERSION}:${titleHash.slice(0, 16)}:${contentHash.slice(0, 32)}`;
  return {
    version: FINGERPRINT_VERSION,
    titleHash,
    contentHash,
    key,
    normalizedTitle: title,
    authorSummary: "",
  };
}

function inferTitleFromEvent(evt: MessageReceivedEvent, body: string): string {
  if (evt.message.subject?.trim()) return evt.message.subject.trim();
  const first = body.split("\n").find((l) => l.trim().length > 0);
  if (first) return first.trim().slice(0, 200);
  return "untitled";
}

type SitemapCache = { urls: string[]; fetchedAt: number };

function normalizeUrlForMatch(u: string): string {
  try {
    const x = new URL(u);
    x.hash = "";
    for (const k of [...x.searchParams.keys()]) {
      if (k.toLowerCase().startsWith("utm_")) x.searchParams.delete(k);
    }
    let path = x.pathname;
    if (path.endsWith("/") && path.length > 1) path = path.slice(0, -1);
    return `${x.protocol}//${x.host.toLowerCase()}${path}`.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

function pathSlugFromUrl(u: string): string {
  try {
    const p = new URL(u).pathname;
    const seg = p.split("/").filter(Boolean);
    const last = seg[seg.length - 1] ?? "";
    return last.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
  } catch {
    return "";
  }
}

function titleSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function extractHttpUrlsFromText(s: string): string[] {
  const re = /https?:\/\/[^\s<>)\]}]+/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(s)) !== null) {
    out.push(m[0].replace(/[.,;:!?)]+$/, ""));
  }
  return out;
}

export function parseSitemapLocs(xml: string): string[] {
  const locs: string[] = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const u = m[1]?.trim();
    if (u) locs.push(u);
  }
  return locs;
}

export async function loadSitemapWithCache(
  ctx: PluginContext,
  sitemapUrl: string,
  ttlMs: number,
): Promise<string[]> {
  const stateKey = `cache_${sha256hex(sitemapUrl).slice(0, 32)}`;
  const now = Date.now();
  const prev = (await ctx.state.get({
    scopeKind: "instance",
    namespace: STATE_NS_SITEMAP,
    stateKey,
  })) as SitemapCache | null;
  if (prev && now - prev.fetchedAt < ttlMs && Array.isArray(prev.urls)) {
    return prev.urls;
  }
  const res = await ctx.http.fetch(sitemapUrl, { method: "GET" });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Sitemap ${sitemapUrl} → ${res.status}`);
  }
  const text = await res.text();
  let locs = parseSitemapLocs(text);
  if (
    text.includes("<sitemapindex") &&
    locs.length &&
    (locs[0].endsWith(".xml") || text.includes("sitemapindex"))
  ) {
    const nested: string[] = [];
    for (const loc of locs.slice(0, 5)) {
      try {
        const r2 = await ctx.http.fetch(loc, { method: "GET" });
        if (r2.status >= 200 && r2.status < 300) {
          const t2 = await r2.text();
          nested.push(...parseSitemapLocs(t2));
        }
      } catch {
        /* skip nested */
      }
    }
    if (nested.length) locs = nested;
  }
  await ctx.state.set(
    { scopeKind: "instance", namespace: STATE_NS_SITEMAP, stateKey },
    { urls: locs, fetchedAt: now } satisfies SitemapCache,
  );
  return locs;
}

function sitemapMatch(
  fp: BlogFingerprint,
  urlCandidates: string[],
  sitemapLocs: string[],
): { url: string; confidence: "strong" | "weak" } | null {
  const set = new Set(sitemapLocs.map(normalizeUrlForMatch));
  for (const u of urlCandidates) {
    if (set.has(normalizeUrlForMatch(u))) return { url: u, confidence: "strong" };
  }
  const tslug = titleSlug(fp.normalizedTitle);
  for (const loc of sitemapLocs) {
    const pslug = pathSlugFromUrl(loc);
    if (pslug && tslug && (pslug === tslug || pslug.includes(tslug) || tslug.includes(pslug))) {
      return { url: loc, confidence: "weak" };
    }
  }
  return null;
}

export type BlogPreprocessResult = {
  fingerprint: BlogFingerprint;
  author: { label: string; source: "byline" | "sender" };
  attachmentNote?: string;
};

/**
 * Build blog fingerprint from email + optional attachment text extraction.
 */
export async function preprocessBlogForMessage(
  ctx: PluginContext,
  cfg: AgentmailPluginConfig,
  apiBase: string,
  bearer: string,
  evt: MessageReceivedEvent,
  _apiMessage: unknown,
): Promise<BlogPreprocessResult | { error: string }> {
  const bcfg = cfg.blogDedupe;
  const plain = pickPlainBody(evt);
  const articleAtts = pickArticleAttachments(evt.message.attachments);
  let mainBody = plain;
  let attachmentNote: string | undefined;
  if (articleAtts.length) {
    const primary = articleAtts[0]!;
    const extracted = await extractTextFromAttachment(
      ctx.http,
      apiBase,
      bearer,
      evt.message.inbox_id,
      evt.message.message_id,
      primary,
      bcfg,
    );
    if (extracted?.trim().length) {
      if (extracted.length > plain.length) {
        mainBody = stripBoilerplateForFingerprint(extracted);
        attachmentNote = `Blog dedupe: primary text from attachment **${primary.filename ?? primary.attachment_id}**`;
      }
    } else if (articleAtts.length) {
      attachmentNote =
        "Blog dedupe: could not extract text from article-like attachment; fingerprint uses email body only.";
    }
  }
  if (!mainBody.trim() && !plain.trim()) {
    return { error: "no body text" };
  }
  const finalBody = mainBody.trim().length ? mainBody : plain;
  const title = inferTitleFromEvent(evt, finalBody);
  const author = extractAuthorFromText(
    (evt.message.html ? htmlToPlain(evt.message.html) : evt.message.text) ?? finalBody,
    evt.message.from,
  );
  const fp = buildFingerprint(title, finalBody);
  const fp2: BlogFingerprint = { ...fp, authorSummary: author.label };
  if (attachmentNote) {
    return { fingerprint: fp2, author, attachmentNote };
  }
  return { fingerprint: fp2, author };
}

export type BlogEvalResult =
  | { action: "proceed"; preprocess: BlogPreprocessResult }
  | { action: "duplicate_internal"; preprocess: BlogPreprocessResult; reason: string; entityId?: string }
  | { action: "duplicate_sitemap"; preprocess: BlogPreprocessResult; matchedUrl: string; confidence: "strong" | "weak" };

export async function evaluateBlogForInbound(
  ctx: PluginContext,
  cfg: AgentmailPluginConfig,
  evt: MessageReceivedEvent,
  apiMessage: unknown,
): Promise<BlogEvalResult | { action: "skip"; reason: string }> {
  if (!cfg.blogDedupe.enabled) return { action: "skip", reason: "disabled" };
  const apiBase = cfg.agentmailApiBase ?? "";
  const mb = cfg.mailboxes.find((m) => m.inboxId === evt.message.inbox_id);
  if (!mb) return { action: "skip", reason: "no mailbox" };
  const pre = await preprocessBlogForMessage(ctx, cfg, apiBase, mb.inboxApiKey, evt, apiMessage);
  if ("error" in pre) return { action: "skip", reason: pre.error };
  const { fingerprint: fp } = pre;

  const internal = await ctx.entities.list({
    entityType: ENTITY_TYPE_BLOG,
    scopeKind: "company",
    scopeId: cfg.companyId,
    externalId: fp.key,
    limit: 3,
  });
  if (internal.length > 0) {
    const row = internal[0]!;
    const d = row.data as { status?: string };
    return {
      action: "duplicate_internal",
      preprocess: pre,
      reason:
        d?.status === "published"
          ? "published blog fingerprint already recorded"
          : "same blog fingerprint already ingested (candidate)",
      entityId: row.id,
    };
  }

  if (cfg.blogDedupe.sitemapUrls.length) {
    const fromEmail = [
      ...extractHttpUrlsFromText(evt.message.text ?? ""),
      ...extractHttpUrlsFromText(evt.message.html ? htmlToPlain(evt.message.html) : ""),
    ];
    for (const sm of cfg.blogDedupe.sitemapUrls) {
      try {
        const locs = await loadSitemapWithCache(ctx, sm, cfg.blogDedupe.sitemapTtlMs);
        const m = sitemapMatch(fp, fromEmail, locs);
        if (m) {
          return {
            action: "duplicate_sitemap",
            preprocess: pre,
            matchedUrl: m.url,
            confidence: m.confidence,
          };
        }
      } catch (e) {
        ctx.logger.warn("agentmail blog: sitemap fetch failed", {
          url: sm,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
  return { action: "proceed", preprocess: pre };
}

export async function recordBlogCandidate(
  ctx: PluginContext,
  cfg: AgentmailPluginConfig,
  preprocess: BlogPreprocessResult,
  messageId: string,
  issueId: string,
): Promise<void> {
  const { fingerprint: fp, author } = preprocess;
  await ctx.entities.upsert({
    entityType: ENTITY_TYPE_BLOG,
    scopeKind: "company",
    scopeId: cfg.companyId,
    externalId: fp.key,
    title: fp.normalizedTitle.slice(0, 200),
    data: {
      status: "candidate",
      titleHash: fp.titleHash,
      contentHash: fp.contentHash,
      version: FINGERPRINT_VERSION,
      sourceMessageId: messageId,
      sourceIssueId: issueId,
      author: author.label,
      authorSource: author.source,
    },
  });
}

export async function handleBlogDuplicate(
  ctx: PluginContext,
  cfg: AgentmailPluginConfig,
  kind: "internal" | "sitemap",
  preprocess: BlogPreprocessResult,
  details: { matchedUrl?: string; requestId: string; messageId: string; inboxId: string },
): Promise<ProcessOutcome> {
  if (cfg.blogDedupe.createIssueForDuplicate) {
    const assignee =
      cfg.mailboxes[0]?.assignments[0]?.agentId ??
      cfg.mailboxes.flatMap((m) => m.assignments).find((a) => a.agentId)?.agentId;
    const o = await ctx.issues.create({
      companyId: cfg.companyId,
      projectId: cfg.projectId,
      title: `[Blog duplicate] ${preprocess.fingerprint.normalizedTitle.slice(0, 80)}`,
      description: [
        "AgentMail blog dedupe detected a message that matches an already published or ingested post.",
        "",
        `- **match:** ${kind}`,
        kind === "sitemap" && details.matchedUrl ? `- **sitemap url:** \`${details.matchedUrl}\`` : "",
        `- **message_id:** \`${details.messageId}\``,
        "",
        preprocess.attachmentNote ?? "",
      ]
        .filter((x) => x.length)
        .join("\n"),
      ...(assignee ? { assigneeAgentId: assignee } : {}),
    });
    await ctx.activity.log({
      companyId: cfg.companyId,
      entityType: "issue",
      entityId: o.id,
      message: "AgentMail created duplicate visibility issue for blog",
      metadata: { plugin: PLUGIN_ID, requestId: details.requestId, inboxId: details.inboxId },
    });
    if (kind === "internal") return { kind: "duplicate_blog_internal" };
    return { kind: "duplicate_blog_sitemap", matchedUrl: details.matchedUrl ?? "" };
  }
  await ctx.activity.log({
    companyId: cfg.companyId,
    message: `AgentMail: duplicate blog email ignored (${kind}) for message ${details.messageId}`,
    metadata: {
      plugin: PLUGIN_ID,
      requestId: details.requestId,
      messageId: details.messageId,
      inboxId: details.inboxId,
    },
  });
  if (kind === "internal") return { kind: "duplicate_blog_internal" };
  return { kind: "duplicate_blog_sitemap", matchedUrl: details.matchedUrl ?? "" };
}
