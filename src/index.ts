import { runPipeline } from "./pipeline";
import type { Env, StravaWebhookEvent } from "./types";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 健康檢查
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response("ok");
    }

    // Strava 建立訂閱時的驗證（GET + hub.* 參數）
    if (request.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && challenge !== null) {
        if (token !== env.STRAVA_VERIFY_TOKEN) {
          return new Response("verify_token mismatch", { status: 403 });
        }
        return Response.json({ "hub.challenge": challenge });
      }
      return new Response("running-bot", { status: 200 });
    }

    // Strava 事件
    if (request.method === "POST") {
      let event: StravaWebhookEvent;
      try {
        event = (await request.json()) as StravaWebhookEvent;
      } catch {
        return new Response("bad json", { status: 400 });
      }

      // 驗證來源；不符就直接 200 吞掉（回非 2xx Strava 會一直重送）
      if (env.STRAVA_SUBSCRIPTION_ID && String(event.subscription_id) !== env.STRAVA_SUBSCRIPTION_ID) {
        console.warn("ignored: subscription_id mismatch", event.subscription_id);
        return new Response("ignored", { status: 200 });
      }
      if (env.STRAVA_ATHLETE_ID && String(event.owner_id) !== env.STRAVA_ATHLETE_ID) {
        console.warn("ignored: owner_id mismatch", event.owner_id);
        return new Response("ignored", { status: 200 });
      }
      if (event.object_type !== "activity" || event.aspect_type !== "create") {
        return new Response("ignored", { status: 200 });
      }

      ctx.waitUntil(runPipeline(event.object_id, env));
      return new Response("accepted", { status: 200 });
    }

    return new Response("method not allowed", { status: 405 });
  },
} satisfies ExportedHandler<Env>;
