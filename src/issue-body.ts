import { htmlToText } from "html-to-text";
import type { AgentmailPluginConfig } from "./config.js";
import type { MessageReceivedEvent, NormalizedAttachment } from "./parse-webhook.js";

export function buildIssueDescription(
  evt: MessageReceivedEvent,
  cfg: AgentmailPluginConfig,
  handlingInstructions?: string,
): string {
  const maxLen = cfg.descriptionMaxLength ?? 50_000;
  const m = evt.message;

  let body: string;
  if (m.text && m.text.trim()) {
    body = m.text.trim();
  } else if (m.html && m.html.trim()) {
    body = htmlToText(m.html, { wordwrap: false }).trim();
  } else if (m.subject) {
    body = "(no body)";
  } else {
    body = "(empty message)";
  }

  if (body.length > maxLen) {
    body = `${body.slice(0, maxLen)}\n\n… [truncated to ${maxLen} characters]`;
  }

  const lines: string[] = [];

  lines.push("### AgentMail");
  lines.push("");
  lines.push(`- **Inbox:** \`${m.inbox_id}\``);
  lines.push(`- **thread_id:** \`${m.thread_id}\` (pass to \`agentmail_get_thread\` to load the full conversation in order)`);
  lines.push(`- **First message_id:** \`${m.message_id}\` (pass to \`agentmail_get_message\` or \`agentmail_reply_to_message\` when appropriate)`);
  lines.push(
    "- **Tools:** Use `agentmail_get_thread` with **thread_id** for full thread context; use `agentmail_reply_to_message` with the **message_id** you are replying to (from the thread or **First message_id** above).",
  );
  lines.push("");
  lines.push("### Message");
  lines.push("");
  lines.push(`**From:** ${m.from}`);
  lines.push(`**To:** ${m.to.join(", ")}`);
  if (m.cc?.length) lines.push(`**Cc:** ${m.cc.join(", ")}`);
  if (m.labels.length) lines.push(`**Labels:** ${m.labels.join(", ")}`);
  lines.push("");
  lines.push(body);

  if (handlingInstructions?.trim()) {
    lines.push("");
    lines.push("### Operator notes");
    lines.push(handlingInstructions.trim());
  }

  return lines.join("\n");
}

export function buildIssueTitle(evt: MessageReceivedEvent, cfg: AgentmailPluginConfig): string {
  const prefix = cfg.titlePrefix ?? "";
  const sub = (evt.message.subject ?? "(no subject)").trim();
  const trimmed = sub.length > 200 ? `${sub.slice(0, 197)}…` : sub;
  return `${prefix}${trimmed}`;
}

function excerptMessageBody(evt: MessageReceivedEvent, maxLen: number): string {
  const m = evt.message;
  let body: string;
  if (m.text && m.text.trim()) {
    body = m.text.trim();
  } else if (m.html && m.html.trim()) {
    body = htmlToText(m.html, { wordwrap: false }).trim();
  } else if (m.subject) {
    body = "(no body)";
  } else {
    body = "(empty message)";
  }
  if (body.length > maxLen) {
    body = `${body.slice(0, maxLen)}\n\n… [truncated to ${maxLen} characters]`;
  }
  return body;
}

/** Comment body for a follow-up message on an existing thread issue. */
export function buildFollowUpComment(
  evt: MessageReceivedEvent,
  cfg: AgentmailPluginConfig,
  resolvedAttachments: NormalizedAttachment[],
): string {
  const maxLen = cfg.descriptionMaxLength ?? 50_000;
  const m = evt.message;
  const lines: string[] = [];
  lines.push("### AgentMail follow-up");
  lines.push("");
  lines.push(`**From:** ${m.from}`);
  lines.push(`**To:** ${m.to.join(", ")}`);
  if (m.cc?.length) lines.push(`**Cc:** ${m.cc.join(", ")}`);
  lines.push(`**Subject:** ${(m.subject ?? "(no subject)").trim()}`);
  lines.push(`**message_id:** \`${m.message_id}\``);
  if (m.labels.length) lines.push(`**Labels:** ${m.labels.join(", ")}`);
  lines.push("");
  lines.push(excerptMessageBody(evt, maxLen));
  if (resolvedAttachments.length) {
    lines.push("");
    lines.push("**Attachments (this message):**");
    for (const a of resolvedAttachments) {
      lines.push(`- ${a.filename ?? a.attachment_id} (${a.size} bytes, id \`${a.attachment_id}\`)`);
    }
  }
  return lines.join("\n");
}
