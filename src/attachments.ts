import type { PluginContext } from "@paperclipai/plugin-sdk";
import {
  amGetAttachmentMeta,
  amGetMessage,
  fetchDownloadBytes,
  type AttachmentMeta,
} from "./agentmail-http.js";
import type { AgentmailPluginConfig } from "./config.js";
import { resolvedAttachmentPolicy } from "./config.js";
import type { NormalizedAttachment } from "./parse-webhook.js";
import { attachmentsFromApiMessage } from "./parse-webhook.js";

function sanitizeFilename(name: string): string {
  const stripped = name
    .replace(/[/\\]/g, "_")
    .replace(/\.\./g, "_")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
  return stripped.length > 180 ? `${stripped.slice(0, 177)}…` : stripped || "attachment";
}

function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i).toLowerCase() : "";
}

function mimeAllowed(
  mime: string | undefined,
  policy: ReturnType<typeof resolvedAttachmentPolicy>,
): boolean {
  const m = (mime ?? "").toLowerCase();
  if (policy.mimeAllowList?.length) {
    return policy.mimeAllowList.some((p) => {
      if (p.endsWith("/*")) return m.startsWith(p.slice(0, -1));
      return m === p.toLowerCase();
    });
  }
  if (policy.mimeDenyList?.length) {
    if (policy.mimeDenyList.some((d) => m === d.toLowerCase())) return false;
  }
  return true;
}

function extDenied(filename: string, policy: ReturnType<typeof resolvedAttachmentPolicy>): boolean {
  const ext = extOf(filename);
  if (!ext) return false;
  return policy.extensionDenyList.some((d) => d.toLowerCase() === ext);
}

function isTextLike(mime: string | undefined, filename: string): boolean {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("text/")) return true;
  const e = extOf(filename);
  return [".csv", ".json", ".md", ".txt", ".log", ".xml"].includes(e);
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Dedupe by `attachment_id`; prefer non-empty filename, larger size, and defined content_type. */
export function mergeAttachmentLists(
  a: NormalizedAttachment[],
  b: NormalizedAttachment[],
): NormalizedAttachment[] {
  const byId = new Map<string, NormalizedAttachment>();
  const add = (att: NormalizedAttachment) => {
    const prev = byId.get(att.attachment_id);
    if (!prev) {
      byId.set(att.attachment_id, { ...att });
      return;
    }
    byId.set(att.attachment_id, {
      attachment_id: att.attachment_id,
      filename: prev.filename?.trim() ? prev.filename : att.filename,
      size: Math.max(prev.size, att.size),
      content_type: prev.content_type?.trim() ? prev.content_type : att.content_type,
    });
  };
  for (const x of a) add(x);
  for (const x of b) add(x);
  return [...byId.values()];
}

export async function resolveAttachmentList(
  ctx: PluginContext,
  cfg: AgentmailPluginConfig,
  bearer: string,
  inboxId: string,
  messageId: string,
  webhookAttachments: NormalizedAttachment[],
): Promise<NormalizedAttachment[]> {
  const apiBase = cfg.agentmailApiBase!;

  async function loadFromApi(): Promise<NormalizedAttachment[]> {
    const msg = await amGetMessage(ctx.http, apiBase, bearer, inboxId, messageId);
    return attachmentsFromApiMessage(msg);
  }

  let apiList: NormalizedAttachment[] = [];
  try {
    apiList = await loadFromApi();
  } catch (e) {
    ctx.logger.warn("agentmail: amGetMessage failed; using webhook attachment list only", {
      inboxId,
      messageId,
      err: e instanceof Error ? e.message : String(e),
    });
  }

  let merged = mergeAttachmentLists(webhookAttachments, apiList);

  if (merged.length === 0 && webhookAttachments.length === 0) {
    await sleepMs(1500);
    try {
      apiList = await loadFromApi();
      merged = mergeAttachmentLists(webhookAttachments, apiList);
    } catch (e) {
      ctx.logger.warn("agentmail: amGetMessage retry failed", {
        inboxId,
        messageId,
        err: e instanceof Error ? e.message : String(e),
      });
    }
    if (merged.length === 0) {
      ctx.logger.info("agentmail: no attachments after webhook + API (+ optional retry)", {
        inboxId,
        messageId,
      });
    }
  }

  return merged;
}

export async function ingestAttachmentsToIssue(params: {
  ctx: PluginContext;
  cfg: AgentmailPluginConfig;
  bearer: string;
  inboxId: string;
  messageId: string;
  attachments: NormalizedAttachment[];
  issueId: string;
  companyId: string;
}): Promise<{ failures: string[] }> {
  const { ctx, cfg, bearer, inboxId, messageId, issueId, companyId, attachments } = params;
  const policy = resolvedAttachmentPolicy(cfg.attachmentPolicy);
  const failures: string[] = [];
  let usedTotal = 0;
  let count = 0;

  for (const att of attachments) {
    if (count >= policy.maxCount) {
      failures.push(`Skipped (maxCount ${policy.maxCount}): ${att.attachment_id}`);
      continue;
    }
    if (att.size > policy.maxBytesPerFile) {
      failures.push(`Skipped (per-file size): ${att.filename ?? att.attachment_id}`);
      continue;
    }
    if (usedTotal + att.size > policy.maxTotalBytes) {
      failures.push(`Skipped (total budget): ${att.filename ?? att.attachment_id}`);
      continue;
    }

    const filename = sanitizeFilename(att.filename ?? att.attachment_id);
    if (extDenied(filename, policy)) {
      failures.push(`Skipped (extension policy): ${filename}`);
      continue;
    }
    if (!mimeAllowed(att.content_type, policy)) {
      failures.push(`Skipped (MIME policy): ${filename}`);
      continue;
    }

    let meta: AttachmentMeta;
    try {
      meta = await amGetAttachmentMeta(ctx.http, cfg.agentmailApiBase!, bearer, inboxId, messageId, att.attachment_id);
    } catch (e) {
      failures.push(`Meta ${att.attachment_id}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    const dlCap = Math.min(policy.maxBytesPerFile, policy.maxTotalBytes - usedTotal);
    let bytes: Uint8Array;
    try {
      bytes = await fetchDownloadBytes(ctx.http, meta.download_url, dlCap);
    } catch (e) {
      failures.push(`Download ${att.attachment_id}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    usedTotal += bytes.length;
    count += 1;

    const docKey = `email/att-${att.attachment_id}`;
    const mime = meta.content_type ?? att.content_type;
    const title = filename;

    try {
      if (isTextLike(mime, filename) && bytes.length <= policy.maxInlineDocumentBytes) {
        const body = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        await ctx.issues.documents.upsert({
          issueId,
          companyId,
          key: docKey,
          title,
          format: mime,
          body,
        });
      } else if (bytes.length <= policy.maxInlineDocumentBytes) {
        const b64 = Buffer.from(bytes).toString("base64");
        const body = [
          `Attachment: **${filename}**`,
          `Content-Type: ${mime ?? "application/octet-stream"}`,
          `Encoding: base64`,
          "",
          "```base64",
          b64,
          "```",
        ].join("\n");
        await ctx.issues.documents.upsert({
          issueId,
          companyId,
          key: docKey,
          title,
          format: "markdown",
          body,
        });
      } else {
        failures.push(
          `Not inlined (>${policy.maxInlineDocumentBytes} bytes): ${filename} id=${att.attachment_id}`,
        );
      }
    } catch (e) {
      failures.push(`Upsert ${att.attachment_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { failures };
}
