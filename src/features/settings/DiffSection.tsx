import { useShallow } from "zustand/react/shallow";
import { useT } from "@/i18n";
import { LayoutSwitch } from "@/features/diff/ViewOptions";
import { useViewSettings, type ViewSettings } from "@/stores/view-settings-store";
import { Group, Row, SelectRow, SwitchRow } from "./settings-ui";

type BooleanSetting = { [K in keyof ViewSettings]: ViewSettings[K] extends boolean ? K : never }[keyof ViewSettings];

function ViewSwitch({
  setting,
  ...props
}: {
  setting: BooleanSetting;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  const checked = useViewSettings((s) => s[setting]);
  const set = useViewSettings((s) => s.set);
  return <SwitchRow checked={checked} onChange={(value) => set(setting, value)} {...props} />;
}

export function DiffSection() {
  const t = useT();
  const { layout, fileList, grouping, set } = useViewSettings(
    useShallow((s) => ({ layout: s.layout, fileList: s.fileList, grouping: s.grouping, set: s.set })),
  );
  return (
    <>
      <Group title={t("options.layout")}>
        <Row label={t("options.layout")} hint={t("settings.layoutHint")}>
          <div className="w-56">
            <LayoutSwitch />
          </div>
        </Row>
      </Group>
      <Group title={t("options.display")}>
        <ViewSwitch setting="syntaxHighlighting" label={t("options.syntax")} />
        <ViewSwitch
          setting="wrapLines"
          label={t("options.wrap")}
          hint={layout === "split" ? t("options.wrapSplit") : undefined}
          disabled={layout === "split"}
        />
        <ViewSwitch setting="showLineCounts" label={t("options.lineCounts")} />
      </Group>
      <Group title={t("settings.files")}>
        <SelectRow
          label={t("options.fileList")}
          value={fileList}
          onChange={(value) => set("fileList", value)}
          options={[
            { value: "tree", label: t("options.tree") },
            { value: "list", label: t("options.list") },
          ]}
        />
        <SelectRow
          label={t("options.grouping")}
          value={grouping}
          onChange={(value) => set("grouping", value)}
          options={[
            { value: "none", label: t("options.noGrouping") },
            { value: "status", label: t("options.byStatus") },
          ]}
        />
        <ViewSwitch setting="hideGenerated" label={t("options.hideGenerated")} hint={t("options.hideGeneratedHint")} />
      </Group>
    </>
  );
}

export function HistorySection() {
  const t = useT();
  return (
    <Group>
      <ViewSwitch setting="firstParentOnly" label={t("history.firstParent")} hint={t("history.firstParentHint")} />
      <ViewSwitch setting="hideMerges" label={t("history.hideMerges")} hint={t("history.hideMergesHint")} />
    </Group>
  );
}
