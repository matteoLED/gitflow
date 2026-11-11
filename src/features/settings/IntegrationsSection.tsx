import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { gitBackend } from "@/lib/tauri-git";
import { ConnectLinear } from "@/features/linear/ConnectLinear";
import { LinearIcon } from "@/features/linear/LinearIcon";
import { useLinearAccounts } from "@/features/linear/linear-queries";
import { usePrLifecycleStore } from "@/features/linear/use-pr-links";
import { Group, Row, SwitchRow } from "./settings-ui";

export function IntegrationsSection() {
  const t = useT();
  const client = useQueryClient();
  const accounts = useLinearAccounts().data ?? [];
  const remove = useMutation({
    mutationFn: gitBackend.linearRemoveAccount,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["linear"] }),
  });
  const autoMove = usePrLifecycleStore((s) => s.autoMove);
  return (
    <>
      <Group title={t("linear.accounts")} description={t("linear.accountsHint")}>
        {accounts.length === 0 && <Row label={t("linear.none")} />}
        {accounts.map((a) => (
          <Row
            key={a.id}
            label={
              <span className="flex items-center gap-2">
                <LinearIcon className="size-4 text-[#8b8ff0]" />
                {a.name}
              </span>
            }
            hint={`${a.userName} · linear.app/${a.urlKey}`}
          >
            <Button variant="outline" size="sm" onClick={() => remove.mutate(a.id)} className="h-7 text-[12.5px]">
              {t("linear.remove")}
            </Button>
          </Row>
        ))}
        <div className="px-4 py-3">
          <ConnectLinear compact />
        </div>
      </Group>
      <Group title={t("linear.automation")}>
        <SwitchRow
          label={t("linear.autoMove")}
          hint={t("linear.autoMoveHint")}
          checked={autoMove}
          onChange={usePrLifecycleStore.getState().setAutoMove}
        />
      </Group>
    </>
  );
}
