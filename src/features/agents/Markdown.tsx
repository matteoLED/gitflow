import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { gitBackend } from "@/lib/tauri-git";

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
const BASE: Components = {
  a: ({ href, children }) => (
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
  ),
};

/** GitHub-flavoured Markdown (tables, lists, code, inline HTML). */
export function Markdown({ text, components }: { text: string; components?: Components }) {
  return (
    <div className="markdown select-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
        components={{ ...BASE, ...components }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default Markdown;
