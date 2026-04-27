import { describe, expect, it } from "vitest";
import { shouldMarkReadAfter, shouldMarkReadAfterCatchup } from "../src/sync-outcomes.js";
import type { ProcessOutcome } from "../src/sync-outcomes.js";

describe("shouldMarkReadAfter", () => {
  it("returns true for terminal / success outcomes", () => {
    const ok: ProcessOutcome[] = [
      { kind: "created_issue", issueId: "i" },
      { kind: "updated_thread", issueId: "i" },
      { kind: "duplicate_message" },
      { kind: "skipped_label" },
      { kind: "duplicate_blog_internal" },
      { kind: "duplicate_blog_sitemap", matchedUrl: "u" },
    ];
    for (const o of ok) expect(shouldMarkReadAfter(o)).toBe(true);
  });

  it("returns false for failed / indeterminate outcomes", () => {
    const bad: ProcessOutcome[] = [
      { kind: "failed_routing" },
      { kind: "failed_agent_or_project" },
      { kind: "blog_extraction_failed", reason: "r" },
      { kind: "extraction_failed", reason: "r" },
      { kind: "processing_failed", stage: "s", message: "m" },
    ];
    for (const o of bad) expect(shouldMarkReadAfter(o)).toBe(false);
  });
});

describe("shouldMarkReadAfterCatchup", () => {
  it("defers to blog markReadOnDuplicate for duplicate blog outcomes", () => {
    const internal: ProcessOutcome = { kind: "duplicate_blog_internal" };
    expect(shouldMarkReadAfterCatchup(internal, true)).toBe(true);
    expect(shouldMarkReadAfterCatchup(internal, false)).toBe(false);

    const sitemap: ProcessOutcome = { kind: "duplicate_blog_sitemap", matchedUrl: "x" };
    expect(shouldMarkReadAfterCatchup(sitemap, true)).toBe(true);
    expect(shouldMarkReadAfterCatchup(sitemap, false)).toBe(false);
  });

  it("is unchanged for non-duplicate outcomes", () => {
    const o: ProcessOutcome = { kind: "created_issue", issueId: "1" };
    expect(shouldMarkReadAfterCatchup(o, false)).toBe(true);
  });
});
