import { useState, type ReactNode } from "react";
import { Bold, Check, ChevronDown, Code, Italic, Link2, Strikethrough, Unlink } from "lucide-react";
import { useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { cn } from "@/lib/utils";
import { BLOCKS, MENU, type Translate } from "./editor-blocks";

type Mode = "marks" | "link" | "turn";

function Tool({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "grid h-7 min-w-7 place-items-center rounded-sm px-1.5 text-[12.5px] text-muted-foreground hover:bg-white/[0.07] hover:text-foreground",
        active && "text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Links typed without a scheme ("linear.app/…") are web links. */
const withScheme = (url: string) => (/^(https?:|mailto:)/i.test(url) ? url : `https://${url}`);

function LinkInput({ editor, t, done }: { editor: Editor; t: Translate; done: () => void }) {
  const current = String(editor.getAttributes("link").href ?? "");
  const [url, setUrl] = useState(current);
  const apply = () => {
    const chain = editor.chain().focus().extendMarkRange("link");
    const href = url.trim();
    (href ? chain.setLink({ href: withScheme(href) }) : chain.unsetLink()).run();
    done();
  };
  return (
    <div className="flex items-center gap-0.5">
      <input
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={t("linear.editor.linkUrl")}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply();
          if (e.key === "Escape") {
            editor.commands.focus();
            done();
          }
        }}
        className="h-7 w-56 bg-transparent px-1.5 text-[13px] outline-none placeholder:text-muted-foreground"
      />
      <Tool label={t("linear.editor.link")} onClick={apply}>
        <Check aria-hidden className="size-3.5" />
      </Tool>
      {current && (
        <Tool
          label={t("linear.editor.removeLink")}
          onClick={() => {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            done();
          }}
        >
          <Unlink aria-hidden className="size-3.5" />
        </Tool>
      )}
    </div>
  );
}

function TurnInto({ editor, t, done }: { editor: Editor; t: Translate; done: () => void }) {
  return (
    <div className="flex w-48 flex-col">
      {BLOCKS.filter((b) => b.convertible).map((block) => (
        <button
          key={block.id}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            block.apply(editor.chain().focus()).run();
            done();
          }}
          className="flex h-8 items-center gap-2.5 rounded-sm px-2 text-left text-[13px] hover:bg-white/[0.07]"
        >
          <block.icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1">{t(block.label)}</span>
          {block.isActive(editor) && <Check aria-hidden className="size-3.5 text-muted-foreground" />}
        </button>
      ))}
    </div>
  );
}

/** Formatting toolbar over a text selection, as in Notion: marks, link, and "Turn into". */
export function EditorBubble({ editor, t }: { editor: Editor; t: Translate }) {
  const [mode, setMode] = useState<Mode>("marks");
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      block: BLOCKS.find((b) => b.convertible && b.isActive(e))?.label ?? "linear.editor.text",
    }),
  });
  const marks = () => editor.chain().focus();
  const done = () => setMode("marks");
  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top-start", onHide: done }}
      shouldShow={({ editor: e, view, element, from, to }) =>
        (view.hasFocus() || element.contains(document.activeElement)) &&
        from !== to &&
        !e.isActive("codeBlock") &&
        !e.isActive("image")
      }
      className={cn(MENU, "z-50 flex items-center gap-0.5 p-1")}
    >
      {mode === "link" && <LinkInput editor={editor} t={t} done={done} />}
      {mode === "turn" && <TurnInto editor={editor} t={t} done={done} />}
      {mode === "marks" && (
        <>
          <Tool label={t("linear.editor.turnInto")} onClick={() => setMode("turn")}>
            <span className="flex items-center gap-1">
              {t(state.block)}
              <ChevronDown aria-hidden className="size-3" />
            </span>
          </Tool>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-white/10" />
          <Tool label={t("linear.editor.bold")} active={state.bold} onClick={() => marks().toggleBold().run()}>
            <Bold aria-hidden className="size-3.5" />
          </Tool>
          <Tool label={t("linear.editor.italic")} active={state.italic} onClick={() => marks().toggleItalic().run()}>
            <Italic aria-hidden className="size-3.5" />
          </Tool>
          <Tool label={t("linear.editor.strike")} active={state.strike} onClick={() => marks().toggleStrike().run()}>
            <Strikethrough aria-hidden className="size-3.5" />
          </Tool>
          <Tool label={t("linear.editor.inlineCode")} active={state.code} onClick={() => marks().toggleCode().run()}>
            <Code aria-hidden className="size-3.5" />
          </Tool>
          <Tool label={t("linear.editor.link")} active={state.link} onClick={() => setMode("link")}>
            <Link2 aria-hidden className="size-3.5" />
          </Tool>
        </>
      )}
    </BubbleMenu>
  );
}
