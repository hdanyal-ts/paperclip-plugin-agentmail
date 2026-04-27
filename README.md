# paperclip-plugin-agentmail

**AgentMail → Paperclip:** inbound `message.received` over **webhooks** (Svix-verified) and/or **WebSockets** creates **issues** with **per-message idempotency** (`plugin_entities`), **attachments** as **issue documents**, and **REST** agent tools. Each mailbox stores the raw inbox **`am_…`** API key in plugin config; the webhook signing secret (`whsec_…`) can still use a Paperclip secret reference when using webhooks.

- **Source / issues (default in `package.json`):** [github.com/hdanyal-ts/paperclip-plugin-agentmail](https://github.com/hdanyal-ts/paperclip-plugin-agentmail)  
- **Plugin id (for tools, webhooks):** `hdanyal-ts.paperclip-plugin-agentmail`  
- **Requires:** a [Paperclip](https://github.com/paperclipai/paperclip)-compatible host; Node **≥ 20**; runtime dependency on `@paperclipai/plugin-sdk` (satisfied from npm when the package is installed).

See [CONTRIBUTING.md](CONTRIBUTING.md) and [STANDALONE.md](STANDALONE.md) for development, subtree mirroring, and release assets (e.g. `npm pack` tarball on GitHub Releases). **Pushing a Paperclip monorepo fork** is for collaboration on the full app; a **tagged release** in a **dedicated** plugin repository (or npm) is what operators use for the git URL in `POST /api/plugins/install`—see *What a standalone publish is* in [STANDALONE.md](STANDALONE.md).

## Install from git (recommended)

`POST /api/plugins/install` takes any **`npm` install spec** the server can resolve, including a **public or private** git URL with a **tag**:

```bash
curl -X POST "https://<your-board-host>/api/plugins/install" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <board-or-operator-token>" \
  -d '{"packageName":"git+https://github.com/hdanyal-ts/paperclip-plugin-agentmail.git#v0.3.0"}'
```

A **private** repository requires the Paperclip **server** to have access to `git` (SSH key, `git` credential helper, or HTTPS with a protected token). Do not commit deploy tokens into shared config.

## Optional: public npm or private registry

If you later publish a package (any scope you control) to a registry, install with e.g. `"packageName":"@hdanyal-ts/paperclip-plugin-agentmail","version":"0.3.0"`. The default in this repository is **not** a public registry publish (`"private": true` in `package.json`).

## Install from a local path (dev)

Build first (`npm run build` produces `dist/`).

```bash
curl -X POST http://127.0.0.1:3100/api/plugins/install \
  -H "Content-Type: application/json" \
  -d '{"packageName":"/absolute/path/to/paperclip-plugin-agentmail","isLocalPath":true}'
```

From a **Paperclip monorepo** fork (this package at `packages/plugins/plugin-agentmail-paperclip`):

```bash
pnpm --filter @hdanyal-ts/paperclip-plugin-agentmail build
```

## Upgrading from older plugin ids

If you had **`paperclipai.agentmail-paperclip`** or another previous manifest id, **remove** the old plugin instance in Plugin Manager, **install** this build, then re-apply config and the AgentMail webhook URL. Current webhook path:

`https://<your-board-host>/api/plugins/hdanyal-ts.paperclip-plugin-agentmail/webhooks/agentmail-inbound`

## Features (v1)

- Inbound **`message.received`** via **HTTPS webhook** (Svix-signed) and/or **outbound WebSocket** to AgentMail (`wss://…/v0` + per-inbox API key). Same `issues.create` + `issue.documents` pipeline; `message_id` dedup applies when using **both** during migration.
- **One issue per email thread:** `agentmail.thread` maps `inbox_id:thread_id` to a single issue. Later messages in the thread add a **comment**, re-open the issue to **`todo`**, and run the same attachment ingest for the new `message_id` (so PDFs on replies land on the original issue). If `thread_id` differs on a reply but **`in_reply_to` / `references`** link to a message we already ingested, the event is treated as a **follow-up** on that issue; when the webhook omits those fields, the worker merges them from **`GET /messages/{id}`** (same idea as attachment hydration). Stale thread rows pointing at a deleted issue fall back to that chain before creating a new issue.
- **Attachments:** Webhook payloads are **merged** with `GET /messages/{id}` so partial webhook attachment lists still ingest files from the API; attachment ids accept `attachment_id`, `id`, or `attachmentId`. If both webhook and API return no attachments, the worker **retries** the message fetch once after a short delay (eventual consistency).
- **Dedup:** `agentmail.message` entity keyed by AgentMail `message_id` before create.
- **Routing:** `mailboxes[]` with nested `assignments[]`; optional **`recipientMatch`** when several agents share one inbox.
- **Operator notes:** `handlingInstructions` merged into the issue description.
- **Agent tools (REST only):** `agentmail_get_handling_context`, `agentmail_list_messages`, `agentmail_get_message`, **`agentmail_get_thread`**, `agentmail_send_message`, `agentmail_reply_to_message`. Inbound issues include an **### AgentMail** block. Tool names are **`hdanyal-ts.paperclip-plugin-agentmail:<bare_tool_name>`** — see `skills/paperclip/SKILL.md` in this repo.
- **Labels:** default **skip issue creation** when labels match `attachmentPolicy.skipIfLabels` (e.g. `spam`).
- **Unread catch-up** and **blog dedupe** (optional).

## Security

- **Inbox API keys** (`am_…`) and **webhook signing secrets** (`whsec_…`) are sensitive. Store webhook secrets as Paperclip **secrets** (references in config), not plaintext in shared repos.
- Prefer **HTTPS** for your board host and restrict who can call **`/api/plugins/install`**.

## Event delivery: webhook vs WebSocket

| | Webhook (default) | WebSocket |
|---|---------------------|-----------|
| **Inbound URL** | Public `POST` URL on your Paperclip host | None — worker connects **out** to AgentMail |
| **Trust** | Svix signature (`whsec_…`) | TLS + raw inbox `am_…` key in the WS URL query (no Svix on frames) |
| **Operations** | AgentMail recommends webhooks for some production setups | Handy for dev or locked-down egress; see [AgentMail WebSockets](https://docs.agentmail.to/websockets/quickstart.md) |

In settings, **Event delivery** chooses `webhook`, `websocket`, or `both` (duplicate deliveries dedupe on `message_id`).

## Configure

1. For **webhook** (or **both**) delivery, create a Paperclip **secret** for the AgentMail **webhook signing secret** (`whsec_…`) and paste its **secret reference** in **Webhook secret ref**. Inbox **`am_…`** keys are entered directly in each mailbox row (stored in plugin config).
2. Open **Plugin Manager → AgentMail → Settings**. In **Core settings**, set **Company ID**, **Event delivery**, and (if using webhooks) **Webhook secret ref** (plus optional **WebSocket URL**, **Default project ID**, **API base**, **Title prefix**).
3. Under **Mailboxes**, add each AgentMail inbox, assignments, and optional **Only when the email is addressed to** when sharing an inbox.
4. Click **Save configuration**.
5. In **AgentMail**, register the **Inbound URL** from the **Webhook** card:  
   `https://<your-board-host>/api/plugins/hdanyal-ts.paperclip-plugin-agentmail/webhooks/agentmail-inbound`  
   (If the host resolves by install UUID, use the id the UI shows for your install.)

## HTTP semantics (Paperclip host)

Successful webhook handling completes the worker without throwing → **HTTP 200**. Verification failures **throw** → the host may respond **502** (and the provider may retry).

## Plugin specification and AgentMail API

- [Paperclip plugin spec](https://github.com/paperclipai/paperclip/blob/master/doc/plugins/PLUGIN_SPEC.md)
- [AgentMail Webhook setup](https://docs.agentmail.to/webhook-setup.mdx)
- [message.received](https://docs.agentmail.to/api-reference/webhooks/events/message-received.mdx)

## Tests

```bash
npm test
```

From a Paperclip monorepo:

```bash
pnpm --filter @hdanyal-ts/paperclip-plugin-agentmail test
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
