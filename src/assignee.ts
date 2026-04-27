import type { MailboxConfig } from "./config.js";

function haystackForRecipientMatch(to: string[], cc: string[] | undefined): string {
  const parts = [...to, ...(cc ?? [])];
  return parts.join(" ").toLowerCase();
}

export type AssigneeResolution =
  | { ok: true; mailbox: MailboxConfig; agentId: string; handlingInstructions?: string }
  | { ok: false; reason: string };

export function resolveAssignee(
  mailboxes: MailboxConfig[],
  inboxId: string,
  to: string[],
  cc: string[] | undefined,
): AssigneeResolution {
  const mailbox = mailboxes.find((m) => m.inboxId === inboxId);
  if (!mailbox) {
    return { ok: false, reason: `No mailbox configured for inbox_id ${inboxId}` };
  }

  const assignments = mailbox.assignments;
  if (assignments.length === 1) {
    const a = assignments[0]!;
    return {
      ok: true,
      mailbox,
      agentId: a.agentId,
      handlingInstructions: a.handlingInstructions,
    };
  }

  const hay = haystackForRecipientMatch(to, cc);
  const matches = assignments.filter((a) => {
    const needle = (a.recipientMatch ?? "").trim().toLowerCase();
    if (!needle) return false;
    return hay.includes(needle);
  });

  if (matches.length === 1) {
    const a = matches[0]!;
    return {
      ok: true,
      mailbox,
      agentId: a.agentId,
      handlingInstructions: a.handlingInstructions,
    };
  }

  if (matches.length === 0) {
    return {
      ok: false,
      reason: `Multiple assignments for inbox ${inboxId} but no recipientMatch matched To/Cc`,
    };
  }
  return {
    ok: false,
    reason: `Ambiguous recipientMatch: ${matches.length} assignments matched for inbox ${inboxId}`,
  };
}
