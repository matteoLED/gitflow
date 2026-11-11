import { useEffect, useRef, useState } from "react";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import dart from "highlight.js/lib/languages/dart";
import diff from "highlight.js/lib/languages/diff";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import type { LinearMember } from "@/types/git";
import { gitBackend } from "@/lib/tauri-git";
import { EditorBubble } from "./EditorBubble";
import { slashCommands, type Translate } from "./editor-blocks";
import { blockHandle, imageUploads, mentions } from "./editor-extras";
import { useTeamMembers } from "./linear-queries";
import { LinearImage } from "./LinearImage";
import { useAutosave } from "./use-update-issue";

type Props = {
  orgId: string | undefined;
  teamId: string;
  /** The description as Linear stores it (Markdown). */
  initial: string;
  onSave: (markdown: string) => void;
};

/** Linear uploads need the API key: shown through the backend, kept as plain Markdown images. */
function linearImages(orgId: string | undefined) {
  const View = ({ node }: NodeViewProps) => (
    <NodeViewWrapper as="span">
      <LinearImage orgId={orgId} src={String(node.attrs.src ?? "")} alt={String(node.attrs.alt ?? "")} />
    </NodeViewWrapper>
  );
  return Image.configure({ inline: true }).extend({ addNodeView: () => ReactNodeViewRenderer(View) });
}

/** A few common languages keep highlighting cheap; others show as plain code. */
const lowlight = createLowlight({ bash, css, dart, diff, javascript, json, python, rust, sql, typescript, xml, yaml });

/** Notion-like hints: the empty text (`empty`), then the line being typed on. */
const placeholder =
  (t: Translate, empty: string) =>
  ({
    editor,
    node,
  }: {
    editor: { isEmpty: boolean };
    node: { type: { name: string }; attrs: Record<string, unknown> };
  }) => {
    if (editor.isEmpty) return empty;
    if (node.type.name === "heading") return t(`linear.editor.h${Math.min(Number(node.attrs.level), 3) as 1 | 2 | 3}`);
    return node.type.name === "paragraph" ? t("linear.editor.slashHint") : "";
  };

type Extras = {
  /** Team members "@" can mention (read when typing). */
  members?: () => LinearMember[];
  /** Hint of the empty editor. */
  empty?: string;
  /** The ⋮⋮ block grip (the description; comments are too short to need it). */
  handle?: boolean;
};

/** Everything the description editor understands; what it doesn't is read-only (see `editableDescription`). */
export const descriptionExtensions = (orgId: string | undefined, t: Translate, extras: Extras = {}) => [
  StarterKit.configure({
    link: { openOnClick: false, autolink: true },
    codeBlock: false,
  }),
  CodeBlockLowlight.configure({ lowlight }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Placeholder.configure({ placeholder: placeholder(t, extras.empty ?? t("linear.addDescription")) }),
  linearImages(orgId),
  slashCommands(t),
  mentions(t, extras.members ?? (() => [])),
  imageUploads(t, orgId),
  ...(extras.handle ? [blockHandle(t)] : []),
  Markdown,
];

/** The team's members, read by "@" when typing (they may load after the editor). */
function useMentionable(orgId: string | undefined, teamId: string) {
  const members = useTeamMembers(orgId, teamId).data;
  const latest = useRef<LinearMember[]>([]);
  useEffect(() => {
    latest.current = members ?? [];
  }, [members]);
  return () => latest.current;
}

/** ⌘-click opens a link in the browser (a plain click places the caret, as in Linear). */
function openLink(event: MouseEvent) {
  const link = (event.target as HTMLElement).closest("a");
  if (!link || !event.metaKey) return false;
  void gitBackend.openGithubUrl(link.href).catch(() => undefined);
  return true;
}

/** The issue description as a Linear-like WYSIWYG editor: Markdown in, Markdown out, saved as you go. */
export function IssueDescriptionEditor({ orgId, teamId, initial, onSave }: Props) {
  const t = useT();
  const members = useMentionable(orgId, teamId);
  const autosave = useAutosave(initial, onSave);
  const editor = useEditor({
    extensions: descriptionExtensions(orgId, t, { members, handle: true }),
    content: initial,
    contentType: "markdown",
    editorProps: {
      attributes: { class: "markdown min-h-12 outline-none", "aria-label": t("linear.addDescription") },
      handleClick: (_view, _pos, event) => openLink(event),
    },
    // What Linear sent, as the editor writes it back: opening an issue never saves it.
    onCreate: ({ editor }) => autosave.baseline(editor.getMarkdown()),
    onUpdate: ({ editor }) => autosave.schedule(editor.getMarkdown()),
    onBlur: () => autosave.flush(),
  });
  return (
    <>
      <EditorContent editor={editor} className="relative text-[14px]" />
      <EditorBubble editor={editor} t={t} />
    </>
  );
}

type CommentEditorProps = {
  orgId: string | undefined;
  teamId: string;
  /** The comment being edited, if any. */
  initial?: string;
  empty: string;
  submitLabel: string;
  autoFocus?: boolean;
  /** Gets the Markdown; the box empties at once and takes the text back if this rejects. */
  onSubmit: (markdown: string) => Promise<unknown>;
  onCancel?: () => void;
};

/** The description editor, compact, for comments: Linear's rounded box, ⌘↵ sends. */
export function CommentEditor({ orgId, teamId, initial = "", empty, submitLabel, autoFocus, onSubmit, onCancel }: CommentEditorProps) {
  const t = useT();
  const members = useMentionable(orgId, teamId);
  const [blank, setBlank] = useState(!initial.trim());
  const send = useRef(() => {});
  const editor = useEditor({
    extensions: descriptionExtensions(orgId, t, { members, empty }),
    content: initial,
    contentType: "markdown",
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: { class: "markdown min-h-6 outline-none", "aria-label": empty },
      handleClick: (_view, _pos, event) => openLink(event),
      handleKeyDown: (_view, event) => {
        if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return false;
        send.current();
        return true;
      },
    },
    onUpdate: ({ editor }) => setBlank(editor.isEmpty),
  });
  useEffect(() => {
    send.current = () => {
      if (!editor || editor.isEmpty) return;
      const markdown = editor.getMarkdown();
      editor.commands.clearContent(true);
      onSubmit(markdown).catch(() => {
        if (!editor.isDestroyed && editor.isEmpty) editor.commands.setContent(markdown, { contentType: "markdown" });
      });
    };
  });
  return (
    <div className="surface rounded-lg px-3.5 pt-2.5 pb-2 text-[13.5px] focus-within:border-white/15">
      <EditorContent editor={editor} />
      <EditorBubble editor={editor} t={t} />
      <div className="mt-1.5 flex items-center justify-end gap-1.5">
        <span className="mr-auto text-[11.5px] text-muted-foreground/70">{t("linear.comment.sendHint")}</span>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 text-[12.5px]">
            {t("common.cancel")}
          </Button>
        )}
        <Button size="sm" disabled={blank} onClick={() => send.current()} className="h-7 text-[12.5px]">
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

export default IssueDescriptionEditor;
