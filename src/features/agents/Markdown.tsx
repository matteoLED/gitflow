import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";
import { gitBackend } from "@/lib/tauri-git";
import { parseRefHref, REF_SCHEME, rehypeRefs, type KnownRefs } from "@/features/refs/ref-links";
import { RefLink } from "@/features/refs/RefPreview";

/**
 * GitHub's own rules: raw HTML in comments (bots post <details>, <picture>, tables…) is rendered, then
 * sanitized with GitHub's allow-list; HTML comments and scripts disappear.
 */
const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "picture", "source"],
  attributes: {
    ...defaultSchema.attributes,
    source: ["srcSet", "media", "type"],
    img: [...(defaultSchema.attributes?.img ?? []), "width", "height"],
  },
};

/** Links open in the browser; the app itself never navigates away. */
function ExternalLink({ href, children }: { href?: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        if (href) void gitBackend.openGithubUrl(href).catch(() => undefined);
      }}
      className="text-[color-mix(in_oklab,var(--primary)_55%,white)] underline decoration-current/40 underline-offset-[3px] hover:decoration-current"
    >
      {children}
    </a>
  );
}

type Props = {
  text: string;
  components?: Components;
  /** Pull requests, issues and commits of the repository mentioned in the text become previewable links. */
  refs?: { repoPath: string; known: KnownRefs };
};

/** GitHub-flavoured Markdown (tables, lists, code, inline HTML). */
export function Markdown({ text, components, refs }: Props) {
  const link: Components["a"] = ({ href, children }) => {
    const target = refs ? parseRefHref(href) : null;
    if (!refs || !target) return <ExternalLink href={href}>{children}</ExternalLink>;
    return (
      <RefLink repoPath={refs.repoPath} target={target}>
        {children}
      </RefLink>
    );
  };
  return (
    <div className="markdown select-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema], ...(refs ? [rehypeRefs(refs.known)] : [])]}
        components={{ a: link, ...components }}
        // Ref links are added after sanitizing (a `gitflow-ref:` link written in the text is already gone).
        urlTransform={(url) => (refs && url.startsWith(REF_SCHEME) ? url : defaultUrlTransform(url))}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default Markdown;
