import { escapeHtml } from "./util";

/**
 * A tiny, dependency-free Markdown renderer covering the subset that shows up
 * in agent replies: fenced code blocks, inline code, headings, lists,
 * blockquotes, bold/italic, and horizontal rules. Everything is HTML-escaped
 * first, so output is safe to embed.
 */
export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let html = "";
  let i = 0;

  let inCode = false;
  let codeBuf: string[] = [];
  let codeLang = "";

  let para: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const flushPara = () => {
    if (para.length) {
      html += `<p>${renderInline(para.join(" "))}</p>\n`;
      para = [];
    }
  };
  const flushList = () => {
    if (listType) {
      html += `</${listType}>\n`;
      listType = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (inCode) {
      if (/^\s*```/.test(line)) {
        html += `<pre class="codeblock"><code class="language-${escapeHtml(codeLang)}">${escapeHtml(
          codeBuf.join("\n"),
        )}</code></pre>\n`;
        inCode = false;
        codeBuf = [];
        codeLang = "";
      } else {
        codeBuf.push(line);
      }
      i++;
      continue;
    }

    const fence = line.match(/^\s*```(\S*)\s*$/);
    if (fence) {
      flushPara();
      flushList();
      inCode = true;
      codeLang = fence[1] ?? "";
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      html += `<h${level}>${renderInline(heading[2])}</h${level}>\n`;
      i++;
      continue;
    }

    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      flushPara();
      flushList();
      html += `<hr/>\n`;
      i++;
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushPara();
      flushList();
      html += `<blockquote>${renderInline(quote[1])}</blockquote>\n`;
      i++;
      continue;
    }

    const ul = line.match(/^\s*[-*+]\s+(.+)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ul || ol) {
      flushPara();
      const type: "ul" | "ol" = ul ? "ul" : "ol";
      if (listType !== type) {
        if (listType) html += `</${listType}>\n`;
        html += `<${type}>\n`;
        listType = type;
      }
      html += `<li>${renderInline((ul ?? ol)![1])}</li>\n`;
      i++;
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushPara();
      flushList();
      i++;
      continue;
    }

    flushList();
    para.push(line);
    i++;
  }

  if (inCode) {
    html += `<pre class="codeblock"><code class="language-${escapeHtml(codeLang)}">${escapeHtml(
      codeBuf.join("\n"),
    )}</code></pre>\n`;
  }
  flushList();
  flushPara();

  return html.trim();
}

function renderInline(s: string): string {
  const esc = escapeHtml(s);
  const segs = esc.split("`");
  let out = "";
  for (let i = 0; i < segs.length; i++) {
    if (i % 2 === 1) {
      out += `<code>${segs[i]}</code>`;
    } else {
      out += decorate(segs[i]);
    }
  }
  return out;
}

function decorate(s: string): string {
  return s
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
}
