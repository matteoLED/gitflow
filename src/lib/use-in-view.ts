import { useEffect, useRef, useState } from "react";

/** True once the element has been near the viewport; never flips back. Used to lazy-load diffs. */
export function useInView<T extends Element>(rootMargin = "400px") {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (seen || !ref.current) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setSeen(true), { rootMargin });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [seen, rootMargin]);
  return [ref, seen] as const;
}

/**
 * Whether the element is near the viewport right now (both ways), and its height when it last left: long
 * lists render far items as empty blocks of that height, so scrolling stays smooth whatever their length.
 */
export function useNearViewport<T extends HTMLElement>(rootMargin = "1500px") {
  // A callback ref: the element can mount later (a diff card opened after being collapsed) and still be watched.
  const [el, ref] = useState<T | null>(null);
  const [state, setState] = useState({ near: typeof IntersectionObserver === "undefined", height: 0 });
  useEffect(() => {
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) =>
        setState((prev) =>
          entry.isIntersecting === prev.near ? prev : { near: entry.isIntersecting, height: el.offsetHeight },
        ),
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, rootMargin]);
  return [ref, state] as const;
}
