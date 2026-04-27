import type { PluginContext } from "@paperclipai/plugin-sdk";
import WebSocket from "ws";
import { usesWebsocketDelivery, type AgentmailPluginConfig } from "./config.js";
import { DEFAULT_AGENTMAIL_WS_URL } from "./constants.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Maintains one reconnecting WebSocket per configured inbox. Each connection uses that inbox's
 * API key as `api_key` query param (AgentMail WebSockets API). TLS authenticates the server;
 * there is no Svix-style frame signing on the stream.
 */
export function runAgentmailWebsocketHub(
  ctx: PluginContext,
  getCfg: () => Promise<AgentmailPluginConfig | null>,
  onTextMessage: (text: string) => void | Promise<void>,
): { stop: () => void } {
  let cancelled = false;
  const disposers: Array<() => void> = [];

  void (async () => {
    const cfg0 = await getCfg();
    if (!cfg0 || !usesWebsocketDelivery(cfg0.eventDelivery)) return;

    for (const mb of cfg0.mailboxes) {
      const inboxId = mb.inboxId;
      let activeSocket: WebSocket | null = null;
      let loopCancel = false;

      const stopOne = () => {
        loopCancel = true;
        try {
          activeSocket?.close();
        } catch {
          /* noop */
        }
        activeSocket = null;
      };
      disposers.push(stopOne);

      const loop = async () => {
        let attempt = 0;
        while (!cancelled && !loopCancel) {
          const cfg = await getCfg();
          if (!cfg || !usesWebsocketDelivery(cfg.eventDelivery)) {
            await sleep(3000);
            attempt = 0;
            continue;
          }
          const mbNow = cfg.mailboxes.find((m) => m.inboxId === inboxId);
          if (!mbNow) {
            ctx.logger.info("agentmail ws: mailbox removed from config, stopping loop", { inboxId });
            return;
          }
          const base = (cfg.agentmailWebsocketUrl ?? DEFAULT_AGENTMAIL_WS_URL).replace(/\/$/, "");
          try {
            const apiKey = mbNow.inboxApiKey;
            const url = `${base}?api_key=${encodeURIComponent(apiKey)}`;
            await new Promise<void>((resolve, reject) => {
              const s = new WebSocket(url);
              activeSocket = s;
              let settled = false;
              const finish = (fn: () => void) => {
                if (settled) return;
                settled = true;
                fn();
              };

              s.once("open", () => {
                s.send(
                  JSON.stringify({
                    type: "subscribe",
                    inbox_ids: [mbNow.inboxId],
                    event_types: ["message.received"],
                  }),
                );
              });
              s.on("message", (data) => {
                void Promise.resolve(onTextMessage(data.toString()));
              });
              s.once("error", (err) => {
                ctx.logger.warn("agentmail ws socket error", { inboxId, err: String(err) });
                finish(() => reject(err));
              });
              s.once("close", () => {
                finish(() => resolve());
              });
            });
          } catch {
            /* error already logged on socket error */
          } finally {
            try {
              activeSocket?.close();
            } catch {
              /* noop */
            }
            activeSocket = null;
          }

          if (cancelled || loopCancel) break;
          attempt++;
          const ms = Math.min(60_000, 1000 * 2 ** Math.min(attempt, 8));
          ctx.logger.info("agentmail ws reconnect scheduled", { inboxId, delayMs: ms });
          await sleep(ms);
        }
      };

      void loop();
    }
  })();

  return {
    stop: () => {
      cancelled = true;
      for (const d of disposers) d();
      disposers.length = 0;
    },
  };
}
