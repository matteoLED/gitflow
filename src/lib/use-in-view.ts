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
