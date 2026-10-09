import { Hono } from "hono";
import { classify } from "./classifier.ts";

export const MAX_HOURS = 24 * 90;

function isViews(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_HOURS &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry) && entry >= 0)
  );
}

export function createApp() {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/classify", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const views = body && typeof body === "object" ? (body as { views?: unknown }).views : undefined;
    if (!isViews(views)) {
      return c.json(
        {
          error: {
            code: "views_invalid",
            message: `views deve ser uma lista de 1 a ${MAX_HOURS} números maiores ou iguais a zero, um por hora`,
          },
        },
        422,
      );
    }
    return c.json(classify(views));
  });

  return app;
}
