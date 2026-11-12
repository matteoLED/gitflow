import { useT } from "@/i18n";
import { useViewSettings } from "@/stores/view-settings-store";
import { Group, SelectRow } from "./settings-ui";

export function EditorSection() {
  const t = useT();
  const autosave = useViewSettings((s) => s.autosave);
  const delay = useViewSettings((s) => s.autosaveDelay);
  return (
    <Group title={t("settings.editor")}>
      <SelectRow
        label={t("settings.autosave")}
        hint={t("settings.autosaveHint")}
        value={autosave}
        onChange={(value) => useViewSettings.getState().set("autosave", value)}
        options={[
          { value: "afterDelay", label: t("settings.autosaveAfterDelay") },
          { value: "onFocusChange", label: t("settings.autosaveFocus") },
          { value: "off", label: t("settings.autosaveOff") },
        ]}
      />
      {autosave === "afterDelay" && (
        <SelectRow
          label={t("settings.autosaveDelay")}
          value={delay}
          onChange={(value) => useViewSettings.getState().set("autosaveDelay", value)}
          options={[300, 500, 1000, 2000, 5000, 10000].map((ms) => ({
            value: ms,
            label: ms < 1000 ? `${ms} ms` : `${ms / 1000} s`,
          }))}
        />
      )}
    </Group>
  );
}
