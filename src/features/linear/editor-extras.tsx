import { Extension, ReactRenderer, type Editor, type JSONContent } from "@tiptap/react";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { AuthorAvatar } from "@/components/author-avatar";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { cn } from "@/lib/utils";
import { useNoticesStore } from "@/stores/notices-store";
import type { LinearMember } from "@/types/git";
import { MENU, type Translate } from "./editor-blocks";

/**
 * A mention as Linear-compatible Markdown: `[@Name](profile URL)`.
 * ponytail: Linear doesn't document its mention Markdown; a profile link renders everywhere, a real
 * mention (notification) is unverified. Members without a profile URL stay plain `@Name` text.
 */
export function mentionContent(member: Pick<LinearMember, "name" | "url">): JSONContent[] {
  const text: JSONContent = { type: "text", text: `@${member.name}` };
  if (member.url) text.marks = [{ type: "link", attrs: { href: member.url } }];
  return [text, { type: "text", text: " " }];
}

type MentionListProps = { items: LinearMember[]; index: number; t: Translate; onPick: (index: number) => void };

function MentionList({ items, index, t, onPick }: MentionListProps) {
  return (
    <div role="listbox" aria-label={t("linear.editor.people")} className={cn(MENU, "max-h-64 w-56 overflow-y-auto p-1")}>
      {items.length === 0 && <p className="px-2 py-1.5 text-[12.5px] text-muted-foreground">{t("linear.noMatch")}</p>}
      {items.map((member, i) => (
        <button
          key={member.id}
          type="button"
          role="option"
          aria-selected={i === index}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(i)}
          className={cn(
            "flex h-8 w-full items-center gap-2.5 rounded-sm px-2 text-left text-[13px] outline-none",
            i === index && "bg-white/[0.07]",
          )}
        >
          <AuthorAvatar name={member.name} src={member.avatarUrl} className="size-4" />
          <span className="truncate">{member.name}</span>
        </button>
      ))}
    </div>
  );
}

type MentionProps = SuggestionProps<LinearMember, LinearMember>;

/** The "@" list next to the caret, driven by ↑ ↓ Enter (Esc closes). */
function mentionRenderer(t: Translate) {
  return () => {
    let renderer: ReactRenderer<unknown, MentionListProps> | null = null;
    let unmount = () => {};
    let props: MentionProps | null = null;
    let index = 0;
    const listProps = (): MentionListProps => ({
      items: props?.items ?? [],
      index,
      t,
      onPick: (i) => {
        const member = props?.items[i];
        if (member) props?.command(member);
      },
    });
    const paint = () => renderer?.updateProps(listProps());
    return {
      onStart: (p: MentionProps) => {
        props = p;
        index = 0;
        renderer = new ReactRenderer(MentionList, { editor: p.editor, props: listProps(), className: "z-50" });
        unmount = p.mount(renderer.element);
      },
      onUpdate: (p: MentionProps) => {
        props = p;
        index = 0;
        paint();
      },
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        const count = props?.items.length ?? 0;
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && count > 0) {
          index = (index + (event.key === "ArrowDown" ? 1 : -1) + count) % count;
          paint();
          return true;
        }
        if (event.key !== "Enter" || count === 0) return false;
        listProps().onPick(index);
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

/** "@" mentions the team's members (read when typing, so they can load after the editor). */
export const mentions = (t: Translate, members: () => LinearMember[]) =>
  Extension.create({
    name: "mentions",
    addProseMirrorPlugins() {
      return [
        Suggestion<LinearMember, LinearMember>({
          pluginKey: new PluginKey("mentions"),
          editor: this.editor,
          char: "@",
          items: ({ query }) =>
            members()
              .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
              .slice(0, 8),
          command: ({ editor, range, props }) =>
            editor.chain().focus().deleteRange(range).insertContent(mentionContent(props)).run(),
          allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
          render: mentionRenderer(t),
        }),
      ];
    },
  });

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_IMAGE = 10 * 1024 * 1024;

/** Why an image can't go to Linear, if it can't (the backend checks the same). */
export function imageProblem(file: Pick<File, "type" | "size">): "linear.editor.imageType" | "linear.editor.imageSize" | null {
  if (!IMAGE_TYPES.includes(file.type)) return "linear.editor.imageType";
  return file.size > MAX_IMAGE ? "linear.editor.imageSize" : null;
}

async function upload(editor: Editor, orgId: string, t: Translate, file: File, at: number) {
  const notify = useNoticesStore.getState().notify;
  const problem = imageProblem(file);
  if (problem) return notify({ tone: "error", title: t(problem) });
  try {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const src = await gitBackend.linearUploadImage(orgId, file.name || "image", file.type, bytes);
    if (editor.isDestroyed) return;
    const pos = Math.min(at, editor.state.doc.content.size);
    editor.chain().insertContentAt(pos, { type: "image", attrs: { src, alt: "" } }).run();
  } catch (error) {
    notify({ tone: "error", title: t("linear.editor.uploadFailed"), detail: toGitError(error).message });
  }
}

/** Pasted or dropped images go to Linear's storage, then into the text as `![](asset URL)`. */
export const imageUploads = (t: Translate, orgId: string | undefined) =>
  Extension.create({
    name: "imageUploads",
    addProseMirrorPlugins() {
      const editor = this.editor;
      const take = (files: FileList | undefined | null, at: number) => {
        const images = Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
        if (!orgId || images.length === 0) return false;
        images.forEach((file) => void upload(editor, orgId, t, file, at));
        return true;
      };
      return [
        new Plugin({
          props: {
            handlePaste: (view, event) => take(event.clipboardData?.files, view.state.selection.from),
            handleDrop: (view, event, _slice, moved) =>
              !moved &&
              take(
                event.dataTransfer?.files,
                view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from,
              ),
          },
        }),
      ];
    },
  });

/** The top-level block at the pointer's height (measured just inside the text's left edge). */
function blockAt(view: EditorView, y: number) {
  const hit = view.posAtCoords({ left: view.dom.getBoundingClientRect().left + 8, top: y });
  if (!hit) return null;
  const $pos = view.state.doc.resolve(hit.inside >= 0 ? hit.inside : hit.pos);
  const pos = $pos.depth > 0 ? $pos.before(1) : hit.inside >= 0 ? hit.inside : -1;
  const dom = pos >= 0 ? view.nodeDOM(pos) : null;
  return dom instanceof HTMLElement ? { pos, dom } : null;
}

/** A ⋮⋮ grip left of the hovered block; dragging it moves the block with ProseMirror's own drag and drop. */
export const blockHandle = (t: Translate) =>
  Extension.create({
    name: "blockHandle",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          view: (view) => {
            const box = view.dom.parentElement;
            const grip = document.createElement("div");
            grip.draggable = true;
            grip.textContent = "⋮⋮";
            grip.title = t("linear.editor.dragBlock");
            grip.className =
              "absolute -left-6 hidden h-6 w-5 cursor-grab place-items-center rounded-sm text-[11px] tracking-[-3px] text-muted-foreground/60 select-none hover:bg-white/[0.06] hover:text-muted-foreground";
            box?.append(grip);
            let block: ReturnType<typeof blockAt> = null;
            const move = (event: MouseEvent) => {
              if (!view.editable || event.target === grip) return;
              block = blockAt(view, event.clientY);
              if (!block || !box) return void (grip.style.display = "none");
              const top = block.dom.getBoundingClientRect().top - box.getBoundingClientRect().top;
              grip.style.top = `${top}px`;
              grip.style.display = "grid";
            };
            const leave = () => (grip.style.display = "none");
            const drag = (event: DragEvent) => {
              if (!block) return;
              view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, block.pos)));
              view.dragging = { slice: view.state.selection.content(), move: true };
              event.dataTransfer?.setData("text/plain", block.dom.textContent ?? "");
              event.dataTransfer?.setDragImage(block.dom, 0, 0);
            };
            box?.addEventListener("mousemove", move);
            box?.addEventListener("mouseleave", leave);
            grip.addEventListener("dragstart", drag);
            return {
              destroy: () => {
                box?.removeEventListener("mousemove", move);
                box?.removeEventListener("mouseleave", leave);
                grip.remove();
              },
            };
          },
        }),
      ];
    },
  });
