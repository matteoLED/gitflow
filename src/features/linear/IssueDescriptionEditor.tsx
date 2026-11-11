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
import { useT } from "@/i18n";
import { gitBackend } from "@/lib/tauri-git";
import { EditorBubble } from "./EditorBubble";
import { slashCommands, type Translate } from "./editor-blocks";
import { LinearImage } from "./LinearImage";
import { useAutosave } from "./use-update-issue";

type Props = {
  orgId: string | undefined;
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

/** Notion-like hints: the empty description, then the line being typed on. */
const placeholder =
  (t: Translate) =>
  ({
    editor,
    node,
  }: {
    editor: { isEmpty: boolean };
    node: { type: { name: string }; attrs: Record<string, unknown> };
  }) => {
    if (editor.isEmpty) return t("linear.addDescription");
    if (node.type.name === "heading") return t(`linear.editor.h${Math.min(Number(node.attrs.level), 3) as 1 | 2 | 3}`);
    return node.type.name === "paragraph" ? t("linear.editor.slashHint") : "";
  };

/** Everything the description editor understands; what it doesn't is read-only (see `editableDescription`). */
export const descriptionExtensions = (orgId: string | undefined, t: Translate) => [
  StarterKit.configure({
    link: { openOnClick: false, autolink: true },
    codeBlock: false,
  }),
  CodeBlockLowlight.configure({ lowlight }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Placeholder.configure({ placeholder: placeholder(t) }),
  linearImages(orgId),
  slashCommands(t),
  Markdown,
];

/** ⌘-click opens a link in the browser (a plain click places the caret, as in Linear). */
function openLink(event: MouseEvent) {
  const link = (event.target as HTMLElement).closest("a");
  if (!link || !event.metaKey) return false;
  void gitBackend.openGithubUrl(link.href).catch(() => undefined);
  return true;
}

/** The issue description as a Linear-like WYSIWYG editor: Markdown in, Markdown out, saved as you go. */
export function IssueDescriptionEditor({ orgId, initial, onSave }: Props) {
  const t = useT();
  const autosave = useAutosave(initial, onSave);
  const editor = useEditor({
    extensions: descriptionExtensions(orgId, t),
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
      <EditorContent editor={editor} className="text-[14px]" />
      <EditorBubble editor={editor} t={t} />
    </>
  );
}

export default IssueDescriptionEditor;
