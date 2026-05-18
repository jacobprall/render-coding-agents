"use client";

import { useEffect, useState, useCallback } from "react";
import { Copy, Check, FileCode } from "lucide-react";

interface CodeBlockProps {
  code: string;
  language?: string;
  filePath?: string;
  showLineNumbers?: boolean;
  maxHeight?: string;
  className?: string;
}

const LANG_MAP: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  tsx: "tsx",
  jsx: "jsx",
  py: "python",
  rb: "ruby",
  yml: "yaml",
  sh: "bash",
  zsh: "bash",
  shell: "bash",
  dockerfile: "dockerfile",
  md: "markdown",
  rs: "rust",
  go: "go",
  json: "json",
  css: "css",
  html: "html",
  sql: "sql",
  graphql: "graphql",
  toml: "toml",
  env: "bash",
};

function detectLanguage(lang?: string, filePath?: string): string {
  if (lang) {
    const normalized = lang.toLowerCase();
    return LANG_MAP[normalized] ?? normalized;
  }
  if (filePath) {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    return LANG_MAP[ext] ?? (ext || "text");
  }
  return "text";
}

export function CodeBlock({
  code,
  language,
  filePath,
  showLineNumbers = true,
  maxHeight = "max-h-96",
  className,
}: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const lang = detectLanguage(language, filePath);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { codeToHtml } = await import("shiki");
        const result = await codeToHtml(code, {
          lang: lang === "text" ? "text" : lang,
          theme: "github-dark-default",
        });
        if (!cancelled) setHtml(result);
      } catch {
        if (!cancelled) setHtml(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  return (
    <div className={`border border-stroke-subtle bg-surface-1 overflow-hidden ${className ?? ""}`}>
      {(filePath || lang !== "text") && (
        <div className="flex items-center justify-between px-(--of-space-md) py-(--of-space-xs) border-b border-stroke-subtle bg-surface-1">
          <div className="flex items-center gap-(--of-space-xs) min-w-0">
            <FileCode className="h-3 w-3 shrink-0 text-text-tertiary" />
            {filePath ? (
              <span className="text-[11px] font-mono text-text-tertiary truncate">{filePath}</span>
            ) : (
              <span className="text-[11px] font-mono text-text-tertiary">{lang}</span>
            )}
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 text-text-tertiary transition-colors duration-(--of-duration-instant) hover:text-text-secondary"
            title="Copy code"
          >
            {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      )}
      <div className={`overflow-auto ${maxHeight}`}>
        {html ? (
          <div
            className="code-block-content text-[13px] leading-[1.6] [&_pre]:bg-transparent! [&_pre]:p-(--of-space-md) [&_pre]:m-0 [&_code]:font-mono"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="p-(--of-space-md) text-[13px] leading-[1.6] text-foreground font-mono whitespace-pre-wrap">
            {code}
          </pre>
        )}
      </div>
    </div>
  );
}
