import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { createHash, timingSafeEqual } from "node:crypto";
import { openStore, apiError, publicJob } from "./store.js";
import { createBody, jobParams, pagination, openapi } from "./contract.js";
import { JobRunner } from "./worker.js";
import { readFile } from "node:fs/promises";

const docsAssets = new Map([
  ["/docs", ["docs.html", "text/html; charset=utf-8"]],
  ["/docs/", ["docs.html", "text/html; charset=utf-8"]],
  ["/docs/docs.css", ["docs.css", "text/css; charset=utf-8"]],
  ["/docs/docs.js", ["docs.js", "text/javascript; charset=utf-8"]],
  ["/docs/favicon.svg", ["favicon.svg", "image/svg+xml"]],
]);

export async function buildApp(config, factory) {
  const app = Fastify({
    bodyLimit: 262144,
    requestTimeout: 15000,
    connectionTimeout: 20000,
    trustProxy: false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: "array" } },
    logger: {
      level: config.logLevel,
      redact: ["req.headers.authorization", 'req.headers["x-api-key"]'],
    },
  });
  let runner;
  const store = await openStore(config, () => runner?.fail());
  const hashes = Object.entries(config.keys).map(([owner, secret]) => [
    owner,
    createHash("sha256").update(secret).digest(),
  ]);
  let closing = false;
  try {
    runner = new JobRunner(store, factory, config, app.log);
    await app.register(rateLimit, {
      global: false,
      max: config.rateLimit,
      timeWindow: "1 minute",
    });
    app.addHook("onRequest", app.rateLimit());
    app.addHook("onRequest", async (req, reply) => {
      reply
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff");
      const pathname = req.url.split("?")[0];
      if (pathname.startsWith("/health/") || docsAssets.has(pathname) || pathname === "/docs/openapi.json") return;
      const value = req.headers["x-api-key"];
      const digest = createHash("sha256")
        .update(typeof value === "string" ? value : "")
        .digest();
      let owner;
      for (const [name, expected] of hashes)
        if (timingSafeEqual(digest, expected)) owner = name;
      if (!owner)
        throw apiError(401, "UNAUTHORIZED", "Valid X-API-Key required");
      req.owner = owner;
    });
    app.setErrorHandler((e, req, reply) => {
      const status =
        e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 500;
      const code = e.validation
        ? "INVALID_REQUEST"
        : status === 429
          ? e.code || "RATE_LIMITED"
          : status === 413
            ? "BODY_TOO_LARGE"
            : e.code || "INTERNAL_ERROR";
      if (status >= 500)
        app.log.error({ code, requestId: req.id }, "API request failed");
      reply
        .code(status)
        .send({
          error: {
            code: status === 500 ? "INTERNAL_ERROR" : code,
            message:
              status === 500
                ? "Internal server error"
                : e.validation
                  ? "Request does not match the API schema"
                  : e.message,
            requestId: req.id,
          },
        });
    });
    app.setNotFoundHandler((req, reply) =>
      reply
        .code(404)
        .send({
          error: {
            code: "NOT_FOUND",
            message: "Route not found",
            requestId: req.id,
          },
        }),
    );
    app.get("/health/live", () => ({ status: "ok" }));
    app.get("/health/ready", (req, reply) => {
      if (closing || runner.fatal || store.cooldown() > Date.now())
        throw apiError(503, "NOT_READY", "Service temporarily unavailable");
      store.healthy();
      return { status: "ready" };
    });
    app.get("/v1/openapi.json", () => openapi);
    app.get("/docs/openapi.json", () => openapi);
    for (const [url, [filename, contentType]] of docsAssets) {
      app.get(url, async (req, reply) => {
        reply.header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        return reply.type(contentType).send(await readFile(new URL(`./public/${filename}`, import.meta.url)));
      });
    }
    app.post("/v1/jobs", { schema: { body: createBody } }, (req, reply) => {
      if (closing || runner.fatal || store.cooldown() > Date.now())
        throw apiError(503, "NOT_READY", "Service temporarily unavailable");
      const body = {
        region: req.body.region.trim(),
        customers: req.body.customers.map((r) => ({
          id: r.id.trim(),
          name: r.name.trim(),
        })),
      };
      if (
        body.region.length < 2 ||
        !/[a-zA-Z]/.test(body.region) ||
        body.customers.some((r) => r.name.length < 2)
      )
        throw apiError(
          400,
          "INVALID_REQUEST",
          "Region and business names must remain valid after trimming",
        );
      if (
        new Set(body.customers.map((r) => r.id)).size !== body.customers.length
      )
        throw apiError(
          400,
          "DUPLICATE_CUSTOMER_ID",
          "Customer ids must be unique",
        );
      const idem = req.headers["idempotency-key"];
      if (
        idem !== undefined &&
        (typeof idem !== "string" || !/^[\x21-\x7e]{8,128}$/.test(idem))
      )
        throw apiError(
          400,
          "INVALID_IDEMPOTENCY_KEY",
          "Idempotency-Key must contain 8..128 visible ASCII characters",
        );
      const { row, replayed } = store.create(req.owner, body, idem);
      reply
        .code(202)
        .header("Location", `/v1/jobs/${row.id}`)
        .header("Idempotency-Replayed", String(replayed));
      runner.tick();
      return publicJob(store.read(row.id));
    });
    app.get("/v1/jobs", { schema: { querystring: pagination } }, (req) => ({
      items: store
        .list(req.owner, req.query.limit, req.query.offset)
        .map(publicJob),
      ...req.query,
    }));
    app.get("/v1/jobs/:id", { schema: { params: jobParams } }, (req) =>
      publicJob(store.owned(req.params.id, req.owner)),
    );
    app.get(
      "/v1/jobs/:id/results",
      { schema: { params: jobParams, querystring: pagination } },
      (req) => {
        const row = store.owned(req.params.id, req.owner);
        return {
          jobId: row.id,
          status: row.status,
          total: row.processed,
          items: store.results(row.id, req.query.limit, req.query.offset),
          ...req.query,
        };
      },
    );
    app.post(
      "/v1/jobs/:id/cancel",
      { schema: { params: jobParams } },
      (req) => {
        const row = store.cancel(req.params.id, req.owner);
        runner.cancel(row.id);
        return publicJob(row);
      },
    );
    app.delete(
      "/v1/jobs/:id",
      { schema: { params: jobParams } },
      (req, reply) => {
        store.remove(req.params.id, req.owner);
        reply.code(204).send();
      },
    );
    app.addHook("preClose", async () => {
      closing = true;
      await runner.stop();
    });
    app.addHook("onClose", async () => store.close());
    await app.ready();
    runner.start();
    return app;
  } catch (e) {
    await runner?.stop();
    await store.close();
    throw e;
  }
}
