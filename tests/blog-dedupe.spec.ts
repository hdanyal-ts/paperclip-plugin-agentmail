import { describe, expect, it } from "vitest";
import {
  parseSitemapLocs,
  stripBoilerplateForFingerprint,
  buildFingerprint,
} from "../src/blog-dedupe.js";
import { messageFromApiToEvent } from "../src/api-message-to-event.js";
import { shouldMarkReadAfter } from "../src/sync-outcomes.js";

describe("blog-dedupe helpers", () => {
  it("stripBoilerplateForFingerprint removes quoted reply block", () => {
    const t = stripBoilerplateForFingerprint("Hello world\n\nOn Mon Jan 1, x wrote:\n> old");
    expect(t).toContain("Hello world");
    expect(t).not.toContain("old");
  });

  it("buildFingerprint is stable for same title+body", () => {
    const a = buildFingerprint("My Post", "Body text here.");
    const b = buildFingerprint("My Post", "Body text here.");
    expect(a.key).toBe(b.key);
  });

  it("parseSitemapLocs extracts loc tags", () => {
    const xml = `<?xml version="1.0"?><urlset><url><loc>https://ex.com/a</loc></url></urlset>`;
    expect(parseSitemapLocs(xml)).toEqual(["https://ex.com/a"]);
  });
});

describe("messageFromApiToEvent", () => {
  it("maps GET message JSON to MessageReceivedEvent", () => {
    const api = {
      inbox_id: "in@x.com",
      thread_id: "t1",
      message_id: "m1",
      labels: ["unread"],
      from: "a@b.com",
      to: ["in@x.com"],
      subject: "S",
      text: "Body",
    };
    const evt = messageFromApiToEvent(api, "catchup:m1");
    expect(evt?.eventId).toBe("catchup:m1");
    expect(evt?.message.message_id).toBe("m1");
  });
});

describe("shouldMarkReadAfter", () => {
  it("marks read for terminal success outcomes", () => {
    expect(shouldMarkReadAfter({ kind: "created_issue", issueId: "i" })).toBe(true);
    expect(shouldMarkReadAfter({ kind: "duplicate_message" })).toBe(true);
    expect(shouldMarkReadAfter({ kind: "failed_routing" })).toBe(false);
  });
});
