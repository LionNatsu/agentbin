import { escapeHtml, formatBytes, isoToDisplay, prettyJson } from "./util";
import { renderMarkdown } from "./markdown";
import type { Block, Event, SessionIR } from "./ir";
import type { StoredSession } from "./db";
import { labelOf } from "./parsers";

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#4f6ef7"/><path d="M16 7l8 9-8 9-8-9z" fill="#fff"/></svg>`,
  );

const CSS = `
:root {
  --bg: #f5f6f8;
  --surface: #ffffff;
  --surface-2: #fbfbfc;
  --border: #e5e7eb;
  --border-strong: #d4d7dd;
  --text: #171a20;
  --muted: #6b7280;
  --faint: #9aa1ac;
  --accent: #4f6ef7;
  --accent-strong: #3b56d8;
  --accent-soft: #eef1fe;
  --user-bg: #eef1fe;
  --user-border: #dbe2fd;
  --code-bg: #0f172a;
  --code-text: #e2e8f0;
  --ok: #16a34a;
  --err: #dc2626;
  --warn: #d97706;
  --shadow: 0 1px 2px rgba(16,24,40,.04), 0 8px 24px rgba(16,24,40,.06);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0e1013;
    --surface: #16181d;
    --surface-2: #1b1e24;
    --border: #262a31;
    --border-strong: #333944;
    --text: #e7e9ee;
    --muted: #9aa1ac;
    --faint: #6b7280;
    --accent: #6d86ff;
    --accent-strong: #8b9dff;
    --accent-soft: #1c2130;
    --user-bg: #1d2436;
    --user-border: #2c3550;
    --code-bg: #0b0e14;
    --code-text: #dbe1ea;
    --ok: #4ade80;
    --err: #f87171;
    --warn: #fbbf24;
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.5);
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code, pre, .mono {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
pre { margin: 0; }

.topbar {
  position: sticky; top: 0; z-index: 10;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 20px;
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  backdrop-filter: saturate(1.2) blur(8px);
  border-bottom: 1px solid var(--border);
}
.brand {
  display: inline-flex; align-items: center; gap: 8px;
  font-weight: 700; font-size: 15px; color: var(--text);
}
.brand .mark {
  display: inline-grid; place-items: center;
  width: 22px; height: 22px; border-radius: 6px;
  background: var(--accent); color: #fff; font-size: 12px;
}
.brand:hover { text-decoration: none; }
.topbar .actions { display: flex; align-items: center; gap: 8px; }

.btn {
  appearance: none; border: 1px solid var(--border-strong);
  background: var(--surface); color: var(--text);
  padding: 6px 12px; border-radius: 8px; font-size: 13px; cursor: pointer;
  transition: border-color .12s, background .12s;
}
.btn:hover { border-color: var(--accent); }
.btn.small { padding: 4px 10px; font-size: 12px; }
.btn.ghost { background: transparent; border-color: var(--border); color: var(--muted); }
.btn.ghost:hover { color: var(--text); }

.wrap { max-width: 900px; margin: 0 auto; padding: 28px 20px 80px; }

.meta-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; padding: 22px 24px; box-shadow: var(--shadow);
}
.title { margin: 0 0 12px; font-size: 22px; line-height: 1.3; font-weight: 700; letter-spacing: -0.01em; }
.title.untitled { color: var(--muted); font-weight: 600; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
.chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 500;
  border: 1px solid var(--border); background: var(--surface-2); color: var(--muted);
}
.chip.format { background: var(--accent-soft); border-color: transparent; color: var(--accent-strong); font-weight: 600; }
.meta-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px 20px; margin: 0 0 16px; padding: 0;
}
.meta-grid div { min-width: 0; }
.meta-grid dt { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--faint); margin-bottom: 2px; }
.meta-grid dd { margin: 0; font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta-grid dd.mono { font-size: 12.5px; }

.thread { display: flex; flex-direction: column; gap: 18px; margin-top: 24px; }

.turn { display: flex; flex-direction: column; gap: 6px; }
.turn .who { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--faint); display: flex; align-items: center; gap: 8px; }
.turn .who .model { text-transform: none; letter-spacing: 0; font-weight: 500; color: var(--muted); }
.turn.user { align-items: flex-end; }
.turn.user .bubble {
  max-width: 78%; background: var(--user-bg); border: 1px solid var(--user-border);
  border-radius: 14px 14px 4px 14px; padding: 10px 14px;
}
.turn.assistant .body {
  width: 100%; display: flex; flex-direction: column; gap: 8px;
}

.prose { min-width: 0; overflow-wrap: break-word; }
.prose p { margin: 0 0 10px; }
.prose p:last-child { margin-bottom: 0; }
.prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6 { margin: 16px 0 8px; line-height: 1.3; }
.prose h1 { font-size: 19px; } .prose h2 { font-size: 17px; } .prose h3 { font-size: 15.5px; }
.prose ul, .prose ol { margin: 0 0 10px; padding-left: 22px; }
.prose li { margin: 2px 0; }
.prose blockquote {
  margin: 8px 0; padding: 2px 0 2px 12px;
  border-left: 3px solid var(--border-strong); color: var(--muted);
}
.prose code {
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 5px; padding: 1px 5px; font-size: 13px;
}
.prose hr { border: none; border-top: 1px solid var(--border); margin: 14px 0; }

.codeblock {
  background: var(--code-bg); color: var(--code-text);
  border-radius: 10px; padding: 14px 16px; overflow-x: auto;
  font-size: 13px; line-height: 1.55;
}
.codeblock code { background: transparent; border: none; padding: 0; color: inherit; font-size: inherit; }

details.thinking, details.tool {
  border: 1px solid var(--border); border-radius: 10px;
  background: var(--surface-2); overflow: hidden;
}
details.thinking > summary, details.tool > summary {
  cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px;
  padding: 9px 14px; font-size: 13px; font-weight: 500; color: var(--muted);
  user-select: none;
}
details.thinking > summary::-webkit-details-marker, details.tool > summary::-webkit-details-marker { display: none; }
details.thinking > summary:hover, details.tool > summary:hover { color: var(--text); }
details.thinking .prose { padding: 0 14px 12px; color: var(--muted); font-size: 13.5px; }
details.tool[open] > summary { border-bottom: 1px solid var(--border); }
details.tool .chev { margin-left: auto; color: var(--faint); font-size: 11px; transition: transform .15s; }
details.tool[open] .chev { transform: rotate(180deg); }

.tool-icon { font-size: 13px; }
.tool-name { color: var(--text); font-weight: 600; }
.tool-status { font-size: 11px; padding: 1px 8px; border-radius: 999px; }
.tool-status.ok { background: color-mix(in srgb, var(--ok) 14%, transparent); color: var(--ok); }
.tool-status.err { background: color-mix(in srgb, var(--err) 14%, transparent); color: var(--err); }

.tool-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.tool-section .label {
  font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--faint); margin-bottom: 6px;
}
.tool-section pre {
  background: var(--code-bg); color: var(--code-text); border-radius: 8px;
  padding: 11px 13px; overflow-x: auto; font-size: 12.5px; line-height: 1.55;
  white-space: pre-wrap; word-break: break-word;
}
.tool-result.is-error pre { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--err) 55%, transparent); }

.copy {
  margin-left: auto; appearance: none; border: 1px solid var(--border);
  background: transparent; color: var(--muted); border-radius: 6px;
  padding: 2px 8px; font-size: 11px; cursor: pointer;
}
.copy:hover { color: var(--text); border-color: var(--border-strong); }

.sys {
  align-self: center; max-width: 90%;
  padding: 5px 14px; border-radius: 999px; font-size: 12.5px; color: var(--muted);
  background: var(--surface); border: 1px solid var(--border); text-align: center;
}
.sys.error { color: var(--err); border-color: color-mix(in srgb, var(--err) 40%, transparent); }
.note {
  align-self: center; display: flex; align-items: center; gap: 7px;
  font-size: 12.5px; color: var(--faint);
}
.note .ic { opacity: .8; }

.empty { text-align: center; color: var(--muted); padding: 40px 0; }

/* Landing */
.hero { text-align: center; padding: 48px 20px 28px; }
.hero .mark-big {
  display: inline-grid; place-items: center; width: 56px; height: 56px;
  border-radius: 14px; background: var(--accent); color: #fff; font-size: 26px; font-weight: 700;
  margin-bottom: 18px; box-shadow: 0 12px 32px color-mix(in srgb, var(--accent) 35%, transparent);
}
.hero h1 { margin: 0 0 10px; font-size: 30px; letter-spacing: -0.02em; }
.hero p { margin: 0 auto; max-width: 560px; color: var(--muted); font-size: 15.5px; }
.install {
  max-width: 680px; margin: 8px auto 0; text-align: left;
  background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
  padding: 18px 20px; box-shadow: var(--shadow);
}
.install .code {
  background: var(--code-bg); color: var(--code-text); border-radius: 10px;
  padding: 14px 16px; font-size: 13px; overflow-x: auto; white-space: pre;
  position: relative;
}
.formats { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin: 18px 0 6px; }
.footer-note { text-align: center; color: var(--faint); font-size: 12.5px; margin-top: 26px; }
.error-box {
  max-width: 620px; margin: 60px auto; text-align: center;
  background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 34px 28px;
}
.error-box h1 { margin: 0 0 8px; font-size: 20px; }
.error-box p { color: var(--muted); margin: 0 0 18px; }

@media (max-width: 640px) {
  .wrap { padding: 18px 14px 60px; }
  .turn.user .bubble { max-width: 92%; }
  .hero h1 { font-size: 24px; }
}
`;

function page(title: string, body: string, script = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<link rel="icon" href="${FAVICON}"/>
<style>${CSS}</style>
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ""}
</body>
</html>`;
}

const PAGE_SCRIPT = `
(function () {
  function copyText(t, btn) {
    var done = function () {
      if (!btn) return;
      var old = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(function () { btn.textContent = old; }, 1200);
    };
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(done, function () { fallback(); done(); });
    } else { fallback(); done(); }
  }

  var linkBtn = document.getElementById("copy-link");
  if (linkBtn) linkBtn.addEventListener("click", function () { copyText(location.href, linkBtn); });

  var expand = document.getElementById("expand-all");
  if (expand) expand.addEventListener("click", function () {
    var open = expand.dataset.open === "1";
    document.querySelectorAll("details.collapsible").forEach(function (d) { d.open = !open; });
    expand.dataset.open = open ? "0" : "1";
    expand.textContent = open ? "Expand all" : "Collapse all";
  });

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-copy]");
    if (!btn) return;
    var card = btn.closest("details.tool") || btn.closest(".tool-card") || btn.parentElement;
    var pre = card && card.querySelector(".tool-result pre") || (card && card.querySelector(".tool-input pre"));
    copyText(pre ? pre.innerText : "", btn);
  });
})();
`;

export function renderLanding(base: string): string {
  const body = `
<header class="topbar">
  <span class="brand"><span class="mark">◆</span> agentbin</span>
</header>
<main>
  <section class="hero">
    <div class="mark-big">◆</div>
    <h1>Share your agent session logs</h1>
    <p>Paste a Claude Code, CodeBuddy Code, or Pi session <code>.jsonl</code> file and get a
       clean, static, shareable page — no account, no tracking.</p>
    <div class="formats">
      <span class="chip format">Claude Code</span>
      <span class="chip format">CodeBuddy Code</span>
      <span class="chip format">Pi</span>
      <span class="chip">auto-detected</span>
    </div>
  </section>
  <section class="install">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <strong style="font-size:13px;color:var(--muted)">POST your session file</strong>
      <button class="copy" data-copy="curl-cmd" style="position:static">copy</button>
    </div>
    <pre class="code" id="curl-cmd">curl --data-binary @session.jsonl ${escapeHtml(base)}/</pre>
    <p style="color:var(--faint);font-size:12.5px;margin:10px 0 0;">The response is JSON:
    <code>{"id": "&lt;uuid&gt;", "url": "…", "format": "claude-code"}</code>. Open the
    <code>url</code> to view the rendered transcript.</p>
  </section>
  <p class="footer-note">Pages are rendered server-side into static HTML — the browser just displays it.</p>
</main>
`;
  return page("agentbin — share agent sessions", body);
}

export function renderSession(s: StoredSession): string {
  const ir = s.ir;
  const title = ir.title?.trim() || "Untitled session";
  const stats = computeStats(ir);

  const chips: string[] = [];
  chips.push(`<span class="chip format">${escapeHtml(labelOf(s.format))}</span>`);
  if (ir.model) chips.push(`<span class="chip">${escapeHtml(ir.model)}</span>`);
  chips.push(`<span class="chip">${ir.events.length} events</span>`);
  if (stats.tokens) chips.push(`<span class="chip">${stats.tokens.toLocaleString()} tokens</span>`);
  if (ir.gitBranch) chips.push(`<span class="chip">${escapeHtml(ir.gitBranch)}</span>`);

  const meta = [];
  if (ir.cwd) meta.push(metaItem("Working directory", ir.cwd, true));
  meta.push(metaItem("Created", isoToDisplay(ir.startedAt ?? new Date(s.createdAt).toISOString())));
  meta.push(metaItem("Size", `${formatBytes(s.size)} · ${s.lineCount} lines`));
  if (ir.sessionId) meta.push(metaItem("Session id", ir.sessionId, true));

  const body = `
<header class="topbar">
  <a class="brand" href="/"><span class="mark">◆</span> agentbin</a>
  <div class="actions">
    <a class="btn ghost" href="/${escapeHtml(s.id)}/raw">raw jsonl</a>
    <button class="btn" id="copy-link">copy link</button>
  </div>
</header>
<main class="wrap">
  <section class="meta-card">
    <h1 class="title${ir.title?.trim() ? "" : " untitled"}">${escapeHtml(title)}</h1>
    <div class="chips">${chips.join("")}</div>
    <dl class="meta-grid">${meta.join("")}</dl>
    <button class="btn small ghost" id="expand-all" data-open="0">Expand all</button>
  </section>
  <section class="thread">
    ${ir.events.map((ev, i) => renderEvent(ev, i)).join("") || `<div class="empty">No events in this session.</div>`}
  </section>
</main>
`;
  return page(`${title} · agentbin`, body, PAGE_SCRIPT);
}

export function renderNotFound(id: string): string {
  const body = `
<header class="topbar">
  <a class="brand" href="/"><span class="mark">◆</span> agentbin</a>
</header>
<main class="wrap">
  <div class="error-box">
    <h1>Not found</h1>
    <p>No session exists for <code>${escapeHtml(id)}</code>. It may have expired or the link is wrong.</p>
    <a class="btn" href="/">Create a paste</a>
  </div>
</main>
`;
  return page("Not found · agentbin", body);
}

export function renderError(message: string, status: number): string {
  const body = `
<header class="topbar">
  <a class="brand" href="/"><span class="mark">◆</span> agentbin</a>
</header>
<main class="wrap">
  <div class="error-box">
    <h1>${status}</h1>
    <p>${escapeHtml(message)}</p>
    <a class="btn" href="/">Back home</a>
  </div>
</main>
`;
  return page(`Error · agentbin`, body);
}

function metaItem(label: string, value: string, mono = false): string {
  return `<div><dt>${escapeHtml(label)}</dt><dd${mono ? ' class="mono"' : ""}>${escapeHtml(value)}</dd></div>`;
}

function computeStats(ir: SessionIR): { tokens: number } {
  let tokens = 0;
  for (const ev of ir.events) {
    if (ev.kind !== "assistant" || !ev.usage) continue;
    tokens += ev.usage.total ?? (ev.usage.input ?? 0) + (ev.usage.output ?? 0);
  }
  return { tokens };
}

function renderEvent(ev: Event, idx: number): string {
  switch (ev.kind) {
    case "user":
      return `<article class="turn user"><div class="who">you</div><div class="bubble prose">${renderMarkdown(
        ev.text,
      )}</div></article>`;
    case "assistant": {
      const modelTag = ev.model ? `<span class="model">${escapeHtml(ev.model)}</span>` : "";
      return `<article class="turn assistant"><div class="who">assistant ${modelTag}</div><div class="body">${ev.blocks
        .map((b) => renderBlock(b, idx))
        .join("")}</div></article>`;
    }
    case "system": {
      const cls = ev.level === "error" ? "error" : "";
      return `<div class="sys ${cls}">${nl2br(escapeHtml(ev.text))}</div>`;
    }
    case "note": {
      const icon = ev.icon ? `<span class="ic">${escapeHtml(ev.icon)}</span>` : "";
      return `<div class="note">${icon}<span>${escapeHtml(ev.text)}</span></div>`;
    }
    case "output":
      return renderOutput(ev.title, ev.body, ev.isError);
    case "toolResult":
      return renderOutput(ev.name ? `${ev.name} · result` : "result", ev.content, ev.isError);
  }
}

function renderBlock(b: Block, idx: number): string {
  if (b.kind === "text") return `<div class="prose">${renderMarkdown(b.text)}</div>`;
  if (b.kind === "thinking") {
    return `<details class="thinking collapsible"><summary><span class="tool-icon">🧠</span> Thinking</summary><div class="prose">${renderMarkdown(
      b.text,
    )}</div></details>`;
  }
  return renderTool(b.name, b.input, b.result);
}

function renderTool(name: string, input: unknown, result?: { content: string; isError?: boolean }): string {
  const inputText = toolInputText(name, input);
  const status = result
    ? `<span class="tool-status ${result.isError ? "err" : "ok"}">${result.isError ? "error" : "done"}</span>`
    : `<span class="tool-status">…</span>`;
  const resultHtml = result
    ? `<div class="tool-section tool-result${result.isError ? " is-error" : ""}"><div class="label">result</div><pre><code>${escapeHtml(
        result.content,
      )}</code></pre></div>`
    : "";
  return `<details class="tool collapsible"${result ? "" : ""}>
  <summary><span class="tool-icon">⚙</span><span class="tool-name">${escapeHtml(name)}</span>${status}<span class="chev">▼</span><button class="copy" data-copy>copy</button></summary>
  <div class="tool-body">
    <div class="tool-section tool-input"><div class="label">input</div><pre><code>${escapeHtml(inputText)}</code></pre></div>
    ${resultHtml}
  </div>
</details>`;
}

function renderOutput(title: string, bodyText: string, isError?: boolean): string {
  return `<details class="tool collapsible" open>
  <summary><span class="tool-icon">⚙</span><span class="tool-name">${escapeHtml(title)}</span>${
    isError ? `<span class="tool-status err">error</span>` : ""
  }<span class="chev">▼</span><button class="copy" data-copy>copy</button></summary>
  <div class="tool-body">
    <div class="tool-section tool-result${isError ? " is-error" : ""}"><pre><code>${escapeHtml(bodyText)}</code></pre></div>
  </div>
</details>`;
}

function toolInputText(name: string, input: unknown): string {
  if (name.toLowerCase() === "bash" && input && typeof input === "object") {
    const cmd = (input as Record<string, unknown>).command;
    if (typeof cmd === "string" && cmd) return `$ ${cmd}`;
  }
  return prettyJson(input);
}

function nl2br(s: string): string {
  return s.replace(/\n/g, "<br/>");
}
