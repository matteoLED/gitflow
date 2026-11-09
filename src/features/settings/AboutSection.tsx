import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { useT } from "@/i18n";
import { Group, Row } from "./settings-ui";

export function AboutSection() {
  const t = useT();
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);
  return (
    <>
      <div className="flex items-center gap-4">
        <span className="grid size-14 place-items-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/30">
          <GitBranch aria-hidden className="size-7" />
        </span>
        <div>
          <p className="text-[17px] font-semibold">gitflow</p>
          <p className="text-[13px] text-muted-foreground">
            {t("settings.version")} {version ?? t("settings.devBuild")}
          </p>
        </div>
      </div>
      <Group title={t("settings.privacy")}>
        <Row label="Git" hint={t("settings.aboutGit")} />
        <Row label="GitHub" hint={t("settings.aboutGithub")} />
      </Group>
    </>
  );
}
