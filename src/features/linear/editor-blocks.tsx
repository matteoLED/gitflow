import { useState } from "react";
import {
  Code2,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Pilcrow,
  TextQuote,
  type LucideIcon,
} from "lucide-react";
import { Extension, ReactRenderer, type ChainedCommands, type Editor, type Range } from "@tiptap/react";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import type { MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";

export type Translate = (key: MessageKey) => string;

/** The floating menus' look, as the app's dropdown menus. */
export const MENU = "rounded-md border border-white/10 bg-popover text-popover-foreground shadow-md";

export type Block = {
  id: string;
  label: MessageKey;
  icon: LucideIcon;
  /** Extra words the slash menu matches. */
  keywords: string;
  apply: (chain: ChainedCommands) => ChainedCommands;
  isActive: (editor: Editor) => boolean;
  /** Blocks a text can be turned into (not the divider and image, which are inserted). */
  convertible: boolean;
};

const heading = (level: 1 | 2 | 3, icon: LucideIcon): Block => ({
  id: `h${level}`,
  label: `linear.editor.h${level}`,
  icon,
  keywords: `heading title ${"#".repeat(level)}`,
  apply: (c) => c.clearNodes().setHeading({ level }),
  isActive: (e) => e.isActive("heading", { level }),
  convertible: true,
});

export const BLOCKS: Block[] = [
  {
    id: "text",
    label: "linear.editor.text",
    icon: Pilcrow,
    keywords: "paragraph plain",
    apply: (c) => c.clearNodes().setParagraph(),
    isActive: (e) => e.isActive("paragraph") && !e.isActive("listItem") && !e.isActive("taskItem"),
    convertible: true,
  },
  heading(1, Heading1),
  heading(2, Heading2),
  heading(3, Heading3),
  {
    id: "bullet",
    label: "linear.editor.bullet",
    icon: List,
    keywords: "bulleted unordered list ul -",
    apply: (c) => c.clearNodes().toggleBulletList(),
    isActive: (e) => e.isActive("bulletList"),
    convertible: true,
  },
  {
    id: "numbered",
    label: "linear.editor.numbered",
    icon: ListOrdered,
    keywords: "numbered ordered list ol 1.",
    apply: (c) => c.clearNodes().toggleOrderedList(),
    isActive: (e) => e.isActive("orderedList"),
    convertible: true,
  },
  {
    id: "todo",
    label: "linear.editor.todo",
    icon: ListTodo,
    keywords: "todo task checkbox check [ ]",
    apply: (c) => c.clearNodes().toggleTaskList(),
    isActive: (e) => e.isActive("taskList"),
    convertible: true,
  },
  {
    id: "quote",
    label: "linear.editor.quote",
    icon: TextQuote,
    keywords: "quote blockquote >",
    apply: (c) => c.clearNodes().setBlockquote(),
    isActive: (e) => e.isActive("blockquote"),
    convertible: true,
  },
  {
    id: "code",
    label: "linear.editor.code",
    icon: Code2,
    keywords: "code block snippet ```",
    apply: (c) => c.clearNodes().setCodeBlock(),
    isActive: (e) => e.isActive("codeBlock"),
    convertible: true,
  },
  {
    id: "divider",
    label: "linear.editor.divider",
    icon: Minus,
    keywords: "divider separator hr line ---",
    apply: (c) => c.setHorizontalRule(),
    isActive: () => false,
    convertible: false,
  },
  {
    id: "image",
    label: "linear.editor.image",
    icon: ImageIcon,
    keywords: "image picture photo url",
    apply: (c) => c,
    isActive: () => false,
    convertible: false,
  },
];

const IMAGE_URL = /^https?:\/\/\S+$/;

type SlashListProps = {
  items: Block[];
  index: number;
  /** The image block asks for its URL in place of the list. */
  asking: boolean;
  t: Translate;
  onPick: (index: number) => void;
  onImage: (src: string) => void;
  onCancel: () => void;
};

function ImageUrl({ t, onImage, onCancel }: Pick<SlashListProps, "t" | "onImage" | "onCancel">) {
  const [url, setUrl] = useState("");
  return (
    <input
      autoFocus
      value={url}
      onChange={(e) => setUrl(e.target.value)}
      placeholder={t("linear.editor.imageUrl")}
      aria-invalid={url !== "" && !IMAGE_URL.test(url.trim())}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        if (e.key === "Enter" && IMAGE_URL.test(url.trim())) onImage(url.trim());
      }}
      className={cn(MENU, "h-8 w-72 px-2.5 text-[13px] outline-none placeholder:text-muted-foreground")}
    />
  );
}

/** The "/" menu: blocks to insert, filtered by what follows the slash. */
function SlashList({ items, index, asking, t, onPick, onImage, onCancel }: SlashListProps) {
  if (asking) return <ImageUrl t={t} onImage={onImage} onCancel={onCancel} />;
  return (
    <div
      role="listbox"
      aria-label={t("linear.editor.blocks")}
      className={cn(MENU, "max-h-80 w-56 overflow-y-auto p-1")}
    >
      {items.length === 0 && <p className="px-2 py-1.5 text-[12.5px] text-muted-foreground">{t("linear.noMatch")}</p>}
      {items.map((block, i) => (
        <button
          key={block.id}
          type="button"
          role="option"
          aria-selected={i === index}
          ref={i === index ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(i)}
          className={cn(
            "flex h-8 w-full items-center gap-2.5 rounded-sm px-2 text-left text-[13px] outline-none",
            i === index && "bg-white/[0.07]",
          )}
        >
          <block.icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          {t(block.label)}
        </button>
      ))}
    </div>
  );
}

const matches = (block: Block, t: Translate, query: string) =>
  `${t(block.label)} ${block.keywords}`.toLowerCase().includes(query.toLowerCase().trim());

/** Runs a block from the slash menu: the "/query" text goes, the block takes its place. */
export function insertBlock(editor: Editor, block: Block, range: Range) {
  block.apply(editor.chain().focus().deleteRange(range)).run();
}

type Props = SuggestionProps<Block, Block>;

/** Mounts the list next to the slash and drives it from the editor's keys (↑ ↓ Enter; Esc closes). */
function slashRenderer(t: Translate) {
  return () => {
    let renderer: ReactRenderer<unknown, SlashListProps> | null = null;
    let unmount = () => {};
    let props: Props | null = null;
    let index = 0;
    let asking = false;
    const pick = (i: number) => {
      const block = props?.items[i];
      if (!block || !props) return;
      if (block.id !== "image") return props.command(block);
      asking = true;
      paint();
    };
    const listProps = (): SlashListProps => ({
      items: props?.items ?? [],
      index,
      asking,
      t,
      onPick: pick,
      onImage: (src) => props?.editor.chain().focus().deleteRange(props.range).setImage({ src }).run(),
      onCancel: () => {
        asking = false;
        props?.editor.commands.focus();
        paint();
      },
    });
    const paint = () => renderer?.updateProps(listProps());
    const move = (by: number) => {
      const count = props?.items.length ?? 0;
      if (count > 0) index = (index + by + count) % count;
      paint();
    };
    return {
      onStart: (p: Props) => {
        props = p;
        index = 0;
        asking = false;
        renderer = new ReactRenderer(SlashList, { editor: p.editor, props: listProps(), className: "z-50" });
        unmount = p.mount(renderer.element);
      },
      onUpdate: (p: Props) => {
        props = p;
        index = 0;
        paint();
      },
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          move(event.key === "ArrowDown" ? 1 : -1);
          return true;
        }
        if (event.key !== "Enter" || !props?.items.length) return false;
        pick(index);
        return true;
      },
      onExit: () => {
        unmount();
        renderer?.destroy();
        renderer = null;
      },
    };
  };
}

/** Typing "/" at the start of a block or after a space opens the block menu, as in Notion. */
export const slashCommands = (t: Translate) =>
  Extension.create({
    name: "slashCommands",
    addProseMirrorPlugins() {
      return [
        Suggestion<Block, Block>({
          editor: this.editor,
          char: "/",
          items: ({ query }) => BLOCKS.filter((b) => matches(b, t, query)),
          command: ({ editor, range, props }) => insertBlock(editor, props, range),
          allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
          render: slashRenderer(t),
        }),
      ];
    },
  });
