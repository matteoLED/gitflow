import { lazy, Suspense, type ComponentProps } from "react";
import type { Markdown as MarkdownView } from "./Markdown";

// The Markdown pipeline (remark, rehype-raw/parse5) weighs ~250 kB: it loads the first time some text needs it.
const Markdown = lazy(() => import("./Markdown"));

/** Markdown, with the raw text shown while the renderer loads. */
export function LazyMarkdown(props: ComponentProps<typeof MarkdownView>) {
  return (
    <Suspense fallback={<p className="whitespace-pre-wrap">{props.text}</p>}>
      <Markdown {...props} />
    </Suspense>
  );
}
