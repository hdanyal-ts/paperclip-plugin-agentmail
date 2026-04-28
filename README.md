# @hdanyal/paperclip-plugin-agentmail

**AgentMail → Paperclip work** in one bridge. Inbound mail becomes **issues** and **documents**; agents get **REST tools** to read threads and reply—without leaving your [Paperclip](https://github.com/paperclipai/paperclip) control plane.

This is a **third-party** plugin (not an official `paperclipai` product). **Canonical source:** [github.com/hdanyal/paperclip-plugin-agentmail](https://github.com/hdanyal/paperclip-plugin-agentmail).

| | |
|---:|---|
| **Package name** (npm) | [`@hdanyal/paperclip-plugin-agentmail`](https://www.npmjs.com/package/@hdanyal/paperclip-plugin-agentmail) |
| **Manifest / plugin id** | `hdanyal.paperclip-plugin-agentmail` |
| **Distribution** | **npm** (recommended), **[GitHub](https://github.com/hdanyal/paperclip-plugin-agentmail)** (git tag or [Release](https://github.com/hdanyal/paperclip-plugin-agentmail/releases) `.tgz`), or **local path** |
| **Needs** | Paperclip-compatible host, **Node ≥ 20**, [`@paperclipai/plugin-sdk`](https://www.npmjs.com/package/@paperclipai/plugin-sdk) (declared dependency) |

**Compatibility (tested baseline):** **`@paperclipai/plugin-sdk`** `2026.427.x`, **Node** 20+, **AgentMail** HTTPS + WebSocket endpoints per [AgentMail docs](https://docs.agentmail.to). Pin your host and plugin versions per your environment.

Install patterns for Paperclip hosts are also described in [THIRD_PARTY_PLUGINS.md](https://github.com/paperclipai/paperclip/blob/master/doc/plugins/THIRD_PARTY_PLUGINS.md) upstream.

---

## Install (choose one)

Use the same Paperclip CLI / host environment as your running instance.

### 1. npm (recommended)

Requires a running Paperclip-compatible host. If you do not have Paperclip yet, start with [Paperclip](https://github.com/paperclipai/paperclip) (e.g. `paperclipai onboard` / `paperclipai run` per upstream docs).

```bash
npx paperclipai plugin install @hdanyal/paperclip-plugin-agentmail
```

Or, if `paperclipai` is already on your `PATH`:

```bash
paperclipai plugin install @hdanyal/paperclip-plugin-agentmail
```

### 2. Git tag

The host runs `npm install` on the spec you pass—pin a **semver tag**.

```bash
curl -X POST "https://<your-board-host>/api/plugins/install" \
  -H "Content-Type: application/json" \
  -d '{"packageName":"git+https://github.com/hdanyal/paperclip-plugin-agentmail.git#v1.0.0"}'
```

### 3. Release tarball (optional)

If a **`.tgz`** is attached to a [Release](https://github.com/hdanyal/paperclip-plugin-agentmail/releases), point `packageName` at that file URL or install from a downloaded path.

### 4. Local path (contributors / air-gapped)

```bash
npm run build
curl -X POST "https://<your-board-host>/api/plugins/install" \
  -H "Content-Type: application/json" \
  -d '{"packageName":"/absolute/path/to/paperclip-plugin-agentmail","isLocalPath":true}'
```

Inside a full Paperclip monorepo (optional dev flow):

```bash
pnpm --filter @hdanyal/paperclip-plugin-agentmail build
```

---

## Prerequisites

- **Paperclip** (or compatible host) with plugin install support.
- **Node** ≥ 20 for local builds.
- **AgentMail** account, inboxes, and (for webhooks) signing secret as described in settings.

---

## How mail becomes work

```
AgentMail (inbox)  --webhook and/or websocket-->  plugin worker
                                                      |
                                                      v
                                              Paperclip issues
                                              + documents + comments
                                                      |
                                                      v
                                              Agent REST tools (reply, thread, etc.)
```

Live events drive the pipeline; if Paperclip was **down**, **unread catch-up** replays missed mail through the **same** ingest path.

---

## Package boundary

- **Paperclip** is the host and system of record for issues, documents, and secrets.
- This plugin uses [`@paperclipai/plugin-sdk`](https://www.npmjs.com/package/@paperclipai/plugin-sdk) for the worker, manifest, and settings UI.
- Outbound calls use **AgentMail’s public HTTP/WebSocket APIs** (`https://api.agentmail.to`, `wss://…` by default). Configure bases in instance settings if AgentMail documents alternates.

---

## Upgrading from older plugin ids

**`hdanyal-ts.paperclip-plugin-agentmail`:** Remove the old plugin instance in Plugin Manager, reinstall with **1.x** (npm or git), re-apply settings, and register the new webhook URL in AgentMail:

`https://<your-board-host>/api/plugins/hdanyal.paperclip-plugin-agentmail/webhooks/agentmail-inbound`

If you used **`paperclipai.agentmail-paperclip`** or other legacy ids, same flow: remove, reinstall, reconfigure.

See [CHANGELOG.md](./CHANGELOG.md) for **1.0.0** breaking changes.

---

## What you get (v1)

- **Delivery you can mix:** **`message.received`** over **HTTPS webhooks** (Svix-signed) and/or an **outbound WebSocket** to AgentMail (`wss://…/v0` + per-inbox `am_…` key). Same `issues` + `issue.documents` pipeline; **`message_id`** dedup if you run **both** during a migration.
- **One issue per thread:** `agentmail.thread` maps `inbox_id:thread_id` to a single issue. Replies **comment**, bump the issue to **`todo`**, and re-run attachment ingest (so a late PDF still lands on the right card). Odd `thread_id` on a reply is merged using **`in_reply_to` / `references`**, or **`GET /messages/{id}`** when the webhook is thin. Stale thread rows fall back sensibly before opening a duplicate issue.
- **Attachments:** Payloads are **merged** with `GET /messages/{id}`; ids accept `attachment_id`, `id`, or `attachmentId`. If both sides are empty briefly, the worker **retries** once after a short delay.
- **Dedup:** `agentmail.message` tracks AgentMail `message_id` so replays do not duplicate work.
- **Routing:** `mailboxes[]` / `assignments[]`, plus optional **`recipientMatch`** when humans share one inbox.
- **Agent tools:** `agentmail_get_handling_context`, `agentmail_list_messages`, `agentmail_get_message`, **`agentmail_get_thread`**, `agentmail_send_message`, `agentmail_reply_to_message`. Names are prefixed as **`hdanyal.paperclip-plugin-agentmail:<bare_tool_name>`** for the invoking agent.

---

## Unread catch-up and wakeup sync

If Paperclip or the worker **is not running**, webhooks and WS frames may not run—but **mail still arrives** in AgentMail, often as **`unread`**. This plugin **catches up** by listing unread mail per mailbox and feeding it through the **same ingest code** as live traffic (internal source `catchup`, ids like `catchup:{message_id}`).

| Trigger | What happens |
|--------|----------------|
| **Worker startup** | **Sync unread on startup** (default **on**). |
| **Config saved** | With startup sync on, saving settings triggers a pass. |
| **Scheduled job** | Job **`unread_sync`** on host cron; **`unreadSyncIntervalSeconds`** throttles repeated work (default **300** s). **`0`** disables that throttle only. |
| **Manual** | Plugin settings UI: **Sync unread now**. |

See **`instanceConfigSchema`** in [`src/manifest.ts`](src/manifest.ts).

---

## Blog dedupe (optional)

Optional fingerprinting for blog-style mail and optional visibility issues — see settings and **`instanceConfigSchema`**.

---

## Security

- Treat **`am_…`** inbox keys and **`whsec_…`** webhook secrets as **secrets** (Paperclip secret references for webhook material).
- Prefer **HTTPS** for the board host.

---

## Event delivery: webhook vs WebSocket

| | Webhook (default) | WebSocket |
|---|-------------------|-----------|
| **Inbound URL** | Public `POST` on your Paperclip host | None — worker dials **out** to AgentMail |
| **Trust** | Svix signature | TLS + inbox key in the WS URL |

---

## Configure (checklist)

1. Webhook **`whsec_…`** → Paperclip secret reference in **Webhook secret ref**; inbox **`am_…`** keys in mailbox rows.
2. **Plugin Manager → AgentMail settings:** Company ID, event delivery, API base / WS URL, optional default project.
3. **Save**.
4. In **AgentMail**, set **Inbound URL** from the UI to:  
   `https://<your-board-host>/api/plugins/hdanyal.paperclip-plugin-agentmail/webhooks/agentmail-inbound`

---

## Development

Clone [the repository](https://github.com/hdanyal/paperclip-plugin-agentmail), then:

```bash
npm ci
npm run verify
```

Local Paperclip smoke install (example):

```bash
npm run build
npx paperclipai plugin install --local "$(pwd)"
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/BUILDING-PAPERCLIP-PLUGINS.md](docs/BUILDING-PAPERCLIP-PLUGINS.md).

---

## HTTP semantics (Paperclip host)

Happy path (worker finishes without throwing) → **200**. Verification failures **throw** → host may return **502** (provider may retry).

---

## Maintainers

- **Canonical repo:** [`hdanyal/paperclip-plugin-agentmail`](https://github.com/hdanyal/paperclip-plugin-agentmail). Tag **`v*`** releases aligned with **`package.json` `version`**, **`CHANGELOG.md`**, manifest version (derived from `package.json`), and npm when publishing.
- **npm publish CI:** Configure repository secret **`NPM_TOKEN`** so the Release workflow can publish (see [.github/workflows/release.yml](.github/workflows/release.yml)). Without it, the workflow still builds and attaches the tarball to the GitHub Release.
- **Pre-publish validation:** [docs/PRE_PUBLISH_CHECKLIST.md](docs/PRE_PUBLISH_CHECKLIST.md).

---

## References

- [Paperclip plugin spec](https://github.com/paperclipai/paperclip/blob/master/doc/plugins/PLUGIN_SPEC.md)
- [AgentMail webhook setup](https://docs.agentmail.to/webhook-setup.mdx)
- [message.received](https://docs.agentmail.to/api-reference/webhooks/events/message-received.mdx)

---

## Tests

```bash
npm test
```

Monorepo (optional):

```bash
pnpm --filter @hdanyal/paperclip-plugin-agentmail test
```

---

## Contributing / changelog

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [CHANGELOG.md](CHANGELOG.md)
