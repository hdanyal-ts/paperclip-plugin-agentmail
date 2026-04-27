import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { AgentmailPluginConfig } from "./config.js";
import { ENTITY_TYPE_BLOG, PLUGIN_ID } from "./constants.js";

/**
 * Mark an `agentmail.blog` plugin entity as **published** (e.g. after CMS went live).
 * Call via bridge action `blog-set-published` or from automation.
 */
export async function markBlogEntityPublished(
  ctx: PluginContext,
  cfg: AgentmailPluginConfig,
  input: { fingerprintKey: string; publishedUrl?: string; publishedAt?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = input.fingerprintKey.trim();
  if (!key) return { ok: false, error: "fingerprintKey required" };

  const rows = await ctx.entities.list({
    entityType: ENTITY_TYPE_BLOG,
    scopeKind: "company",
    scopeId: cfg.companyId,
    externalId: key,
    limit: 3,
  });
  const row = rows[0];
  if (!row) return { ok: false, error: `No blog entity for fingerprintKey: ${key}` };

  const prev = row.data as Record<string, unknown>;
  const publishedAt = input.publishedAt?.trim() || new Date().toISOString();
  await ctx.entities.upsert({
    entityType: ENTITY_TYPE_BLOG,
    scopeKind: "company",
    scopeId: cfg.companyId,
    externalId: key,
    title: row.title ?? "blog",
    data: {
      ...prev,
      status: "published",
      publishedUrl: input.publishedUrl?.trim() || prev.publishedUrl,
      publishedAt,
    },
  });
  await ctx.activity.log({
    companyId: cfg.companyId,
    message: `AgentMail blog fingerprint marked published (${key.slice(0, 24)}…)`,
    metadata: { plugin: PLUGIN_ID, fingerprintKey: key },
  });
  return { ok: true };
}
