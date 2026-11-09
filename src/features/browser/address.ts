/** What was typed in the address bar, as a page to open: an address, or a web search. */
export function toWebAddress(typed: string): string | null {
  const text = typed.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  const host = text.split("/")[0];
  const looksLikeHost =
    !/\s/.test(text) && (/^localhost(:\d+)?$/.test(host) || /^[\w-]+(\.[\w-]+)+(:\d+)?$/.test(host));
  if (looksLikeHost) return `${/^(localhost|127\.0\.0\.1)/.test(host) ? "http" : "https"}://${text}`;
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}

/** "github.com/matteoLED" for the bar and the tab list. */
export const displayUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

export const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};
