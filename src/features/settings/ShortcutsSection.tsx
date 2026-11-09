import { Fragment } from "react";
import { useT, type MessageKey } from "@/i18n";
import { Group, Kbd, Row } from "./settings-ui";

const GROUPS: { title: MessageKey; items: [MessageKey, string[]][] }[] = [
  {
    title: "shortcut.general",
    items: [
      ["shortcut.assistant", ["⌘", "I"]],
      ["shortcut.terminal", ["⌃", "`"]],
      ["shortcut.preview", ["⌘", "⇧", "P"]],
      ["shortcut.switcher", ["⌘", "P"]],
      ["shortcut.repoN", ["⌘", "1 – 9"]],
      ["shortcut.open", ["⌘", "O"]],
      ["shortcut.settings", ["⌘", ","]],
      ["shortcut.closeSettings", ["Esc"]],
    ],
  },
  {
    title: "shortcut.reading",
    items: [
      ["shortcut.commits", ["↑", "↓"]],
      ["shortcut.layout", ["⌘", "B"]],
      ["shortcut.commit", ["⌘", "↵"]],
    ],
  },
];

export function ShortcutsSection() {
  const t = useT();
  return (
    <>
      {GROUPS.map(({ title, items }) => (
        <Group key={title} title={t(title)}>
          {items.map(([label, keys]) => (
            <Row key={label} label={t(label)} className="min-h-10">
              {keys.map((key) => (
                <Fragment key={key}>
                  <Kbd>{key}</Kbd>
                </Fragment>
              ))}
            </Row>
          ))}
        </Group>
      ))}
    </>
  );
}
