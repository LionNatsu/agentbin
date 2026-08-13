import { config } from "./config";
import { initDb, getSession, insertSession } from "./db";
import { parseSession, PARSERS } from "./parsers";
import { renderError, renderLanding, renderNotFound, renderSession } from "./render";

const db = initDb(config.dataDir);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function handlePost(req: Request, url: URL): Promise<Response> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > config.maxBody) {
    return json({ error: "Payload too large", max_bytes: config.maxBody }, 413);
  }

  const text = await req.text();
  if (Buffer.byteLength(text) > config.maxBody) {
    return json({ error: "Payload too large", max_bytes: config.maxBody }, 413);
  }
  if (!text.trim()) {
    return json({ error: "Empty body — POST a JSONL session file." }, 400);
  }

  let outcome;
  try {
    outcome = parseSession(text);
  } catch (err) {
    return json(
      {
        error: err instanceof Error ? err.message : String(err),
        supported: PARSERS.map((p) => p.label),
      },
      400,
    );
  }

  const id = crypto.randomUUID();
  insertSession(db, { id, format: outcome.format, raw: text, ir: outcome.ir });

  const base = `${url.protocol}//${url.host}`;
  const view = `${base}/${id}`;
  const payload = {
    id,
    url: view,
    view,
    raw: `${view}/raw`,
    format: outcome.format,
    title: outcome.ir.title ?? null,
  };

  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("text/plain")) {
    return new Response(view + "\n", {
      status: 201,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return json(payload, 201);
}

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      if (method === "POST" && (path === "/" || path === "/paste" || path === "/api/paste")) {
        return await handlePost(req, url);
      }

      if (method === "GET") {
        if (path === "/" ) {
          const base = `${url.protocol}//${url.host}`;
          return html(renderLanding(base));
        }
        if (path === "/healthz") return json({ ok: true });
        if (path === "/favicon.ico") return new Response(null, { status: 204 });

        const raw = path.match(/^\/([A-Za-z0-9-]+)\/raw$/);
        if (raw) {
          const s = getSession(db, raw[1]);
          if (!s) return html(renderNotFound(raw[1]), 404);
          return new Response(s.raw, {
            headers: { "content-type": "application/x-ndjson; charset=utf-8" },
          });
        }

        const asJson = path.match(/^\/([A-Za-z0-9-]+)\/json$/);
        if (asJson) {
          const s = getSession(db, asJson[1]);
          if (!s) return json({ error: "not found" }, 404);
          return json({ id: s.id, format: s.format, ir: s.ir });
        }

        const view = path.match(/^\/([A-Za-z0-9-]+)$/);
        if (view) {
          const s = getSession(db, view[1]);
          if (!s) return html(renderNotFound(view[1]), 404);
          return html(renderSession(s));
        }
      }

      return html(renderError("Not found", 404), 404);
    } catch (err) {
      console.error(err);
      return html(renderError("Internal server error", 500), 500);
    }
  },
});

console.log(`◆ agentbin listening on http://${config.host}:${server.port}`);
console.log(`  storage: ${config.dataDir}`);
