/**
 * Scrolls `id`'s element into view inside its `[data-scroll-container]` only.
 * Native scrollIntoView also scrolls every ancestor, including the overflow-hidden window body.
 */
export function revealInContainer(id: string, align: "nearest" | "start" = "nearest"): void {
  const el = document.getElementById(id);
  const container = el?.closest<HTMLElement>("[data-scroll-container]");
  if (!el || !container) return;
  const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
  const bottom = top + el.offsetHeight;
  if (align === "start") container.scrollTop = top - 12;
  else if (top < container.scrollTop) container.scrollTop = top;
  else if (bottom > container.scrollTop + container.clientHeight) container.scrollTop = bottom - container.clientHeight;
}
