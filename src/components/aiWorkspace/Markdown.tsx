"use client";
import { memo, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { useT } from "@/lib/i18n/context";
import { Icon, ICONS } from "./icons";

/**
 * A reply, rendered.
 *
 * Markdown with tables and task lists; raw HTML in a reply is not rendered, and
 * `javascript:` links are dropped by react-markdown's URL filter. Images in a
 * reply are shown as links rather than loaded, so a reply cannot make the
 * browser fetch from an address the admin never chose. Code is highlighted by
 * highlight.js, which escapes what it is given, for a fixed set of languages.
 */

const LANGUAGES = { bash, css, diff, go, java, javascript, json, markdown, python, rust, sql, typescript, xml, yaml };
for (const [name, language] of Object.entries(LANGUAGES)) {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, language);
}
const ALIASES: Record<string, string> = {
  js: "javascript", jsx: "javascript", mjs: "javascript", ts: "typescript", tsx: "typescript",
  sh: "bash", shell: "bash", zsh: "bash", console: "bash", html: "xml", svg: "xml",
  yml: "yaml", py: "python", rs: "rust", golang: "go", md: "markdown", postgres: "sql", postgresql: "sql",
};

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, and pages not allowed the async clipboard.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const t = useT().aiWorkspace;
  const [copied, setCopied] = useState(false);
  const resolved = ALIASES[language] ?? language;
  const html = useMemo(() => {
    if (!resolved || !hljs.getLanguage(resolved)) return null;
    try {
      return hljs.highlight(code, { language: resolved, ignoreIllegals: true }).value;
    } catch {
      return null;
    }
  }, [code, resolved]);

  return (
    <div className="aiw-code">
      <div className="aiw-code-head">
        <span>{language || "text"}</span>
        <button type="button" className="aiw-code-copy" onClick={async () => {
          if (await copyText(code)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }
        }}>
          <Icon d={copied ? ICONS.check : ICONS.copy} size={14} />
          {copied ? t.copied : t.copyCode}
        </button>
      </div>
      <pre>
        {html
          ? <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
          : <code>{code}</code>}
      </pre>
    </div>
  );
}

interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}
const textOf = (node?: HastNode): string =>
  !node ? "" : node.type === "text" ? node.value ?? "" : (node.children ?? []).map(textOf).join("");

const components: Components = {
  pre({ node }) {
    const code = (node as HastNode | undefined)?.children?.find((c) => c.type === "element" && c.tagName === "code");
    const classes = code?.properties?.className;
    const list = Array.isArray(classes) ? classes.map(String) : [];
    const language = (list.find((c) => c.startsWith("language-")) ?? "").slice("language-".length).toLowerCase();
    return <CodeBlock language={language} code={textOf(code).replace(/\n$/, "")} />;
  },
  code({ children }) {
    return <code className="aiw-inline-code">{children}</code>;
  },
  a({ href, children }) {
    return <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a>;
  },
  img({ src, alt }) {
    return typeof src === "string" && src
      ? <a href={src} target="_blank" rel="noopener noreferrer nofollow">{alt || src}</a>
      : null;
  },
  table({ children }) {
    return <div className="aiw-table"><table>{children}</table></div>;
  },
};

function MarkdownText({ text }: { text: string }) {
  return (
    <div className="aiw-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownText);
