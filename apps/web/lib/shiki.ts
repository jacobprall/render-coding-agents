let highlighterPromise: Promise<Awaited<ReturnType<typeof loadHighlighter>>> | null = null;
const cache = new Map<string, string>();
const MAX_CACHE = 500;

async function loadHighlighter() {
  const { createHighlighter } = await import("shiki");
  return createHighlighter({
    themes: ["github-dark-default"],
    langs: [
      "typescript",
      "javascript",
      "json",
      "html",
      "css",
      "python",
      "bash",
      "markdown",
      "yaml",
      "tsx",
      "jsx",
      "sql",
      "go",
      "rust",
      "text",
    ],
  });
}

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = loadHighlighter();
  }
  return highlighterPromise;
}

export async function highlight(code: string, lang: string): Promise<string> {
  const key = `${lang}:${code.length}:${simpleHash(code)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const highlighter = await getHighlighter();
  const safeLang = highlighter.getLoadedLanguages().includes(lang) ? lang : "text";
  const html = highlighter.codeToHtml(code, { lang: safeLang, theme: "github-dark-default" });

  if (cache.size >= MAX_CACHE) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, html);
  return html;
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < Math.min(str.length, 200); i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}
