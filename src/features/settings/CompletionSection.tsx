import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { toGitError } from "@/lib/errors";
import { gitBackend } from "@/lib/tauri-git";
import { CLAUDE_MODELS, OPENAI_MODELS, useCompletionStore, type CompletionProvider } from "@/stores/completion-store";
import { copilotSignIn, copilotSignOut, copilotStatus, SIGNED_IN } from "@/features/editor/copilot";
import { Group, Row, SelectRow } from "./settings-ui";

const buttonClass = "h-7 gap-1.5 text-[12.5px]";
const errorClass = "px-4 pb-3 text-[12px] text-removed-foreground";

type KeyProps<M extends string> = {
  provider: "claude" | "openai";
  placeholder: string;
  keysUrl: string;
  models: readonly M[];
  model: M;
  onModel: (model: M) => void;
};

/** Model choice and API key: the key goes to the Keychain and is never shown again. */
function ApiKeyGroup<M extends string>({ provider, placeholder, keysUrl, models, model, onModel }: KeyProps<M>) {
  const t = useT();
  const client = useQueryClient();
  const queryKey = ["completion-key", provider];
  const saved = useQuery({ queryKey, queryFn: () => gitBackend.completionHasKey(provider) });
  const [key, setKey] = useState("");
  const refresh = () => void client.invalidateQueries({ queryKey });
  const save = useMutation({
    mutationFn: () => gitBackend.completionSetKey(provider, key),
    onSuccess: () => (setKey(""), refresh()),
  });
  const remove = useMutation({ mutationFn: () => gitBackend.completionRemoveKey(provider), onSuccess: refresh });
  const test = useMutation({ mutationFn: () => gitBackend.completionTest(provider, model) });
  return (
    <Group title={t("completion.apiKey")} description={t("completion.apiKeyHint")}>
      <SelectRow
        label={t("completion.model")}
        hint={t("completion.modelHint")}
        value={model}
        options={models.map((m) => ({ value: m, label: m }))}
        onChange={onModel}
      />
      {saved.data ? (
        <Row
          label={t("completion.keySaved")}
          hint={test.isSuccess ? t("completion.testOk") : test.isError ? toGitError(test.error).message : undefined}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => test.mutate()}
            disabled={test.isPending}
            className={buttonClass}
          >
            {test.isPending && <BrailleLoader />}
            {t("completion.test")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => remove.mutate()} className={buttonClass}>
            {t("completion.remove")}
          </Button>
        </Row>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-2 px-4 py-3"
        >
          <Input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={placeholder}
            aria-label={t("completion.apiKey")}
            autoComplete="off"
            maxLength={300}
            className="h-8 font-mono text-[12.5px] md:text-[12.5px]"
          />
          {save.isError && <p className="text-[12px] text-removed-foreground">{toGitError(save.error).message}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!key.trim() || save.isPending} className={buttonClass}>
              {save.isPending && <BrailleLoader />}
              {t("common.save")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void gitBackend.openGithubUrl(keysUrl)}
              className={`${buttonClass} text-muted-foreground`}
            >
              <ExternalLink aria-hidden className="size-3.5" />
              {t("completion.getKey")}
            </Button>
          </div>
        </form>
      )}
    </Group>
  );
}

/** GitHub's device flow: a code to paste on github.com, then the status is polled until it's accepted. */
function CopilotGroup() {
  const t = useT();
  const [device, setDevice] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const status = useQuery({
    queryKey: ["copilot-status"],
    queryFn: copilotStatus,
    retry: false,
    refetchInterval: (query) => (device && !SIGNED_IN.has(query.state.data?.status ?? "") ? 3000 : false),
  });
  const signIn = useMutation({
    mutationFn: copilotSignIn,
    onSuccess: (flow) => (flow ? setDevice(flow) : void status.refetch()),
  });
  const signOut = useMutation({
    mutationFn: copilotSignOut,
    onSuccess: () => (setDevice(null), void status.refetch()),
  });
  const signedIn = SIGNED_IN.has(status.data?.status ?? "");
  const copyAndOpen = async (flow: { userCode: string; verificationUri: string }) => {
    await navigator.clipboard.writeText(flow.userCode);
    await gitBackend.openGithubUrl(flow.verificationUri);
  };
  const failure = status.error ?? signIn.error ?? signOut.error;
  return (
    <Group title={t("completion.copilot")} description={t("completion.copilotHint")}>
      {status.isPending ? (
        <Row label={t("completion.starting")}>
          <BrailleLoader />
        </Row>
      ) : signedIn ? (
        <Row label={t("completion.signedIn", { user: status.data?.user ?? "GitHub" })}>
          <Button variant="outline" size="sm" onClick={() => signOut.mutate()} className={buttonClass}>
            {t("completion.signOut")}
          </Button>
        </Row>
      ) : device ? (
        <Row
          label={<span className="font-mono text-[15px] tracking-widest select-all">{device.userCode}</span>}
          hint={t("completion.deviceHint")}
        >
          <BrailleLoader />
          <Button size="sm" onClick={() => void copyAndOpen(device)} className={buttonClass}>
            <ExternalLink aria-hidden className="size-3.5" />
            {t("completion.copyAndOpen")}
          </Button>
        </Row>
      ) : (
        <Row label={t("completion.notSignedIn")}>
          <Button
            size="sm"
            onClick={() => signIn.mutate()}
            disabled={signIn.isPending || status.isError}
            className={buttonClass}
          >
            {signIn.isPending && <BrailleLoader />}
            {t("completion.signIn")}
          </Button>
        </Row>
      )}
      {failure && <p className={errorClass}>{toGitError(failure).message}</p>}
    </Group>
  );
}

/** Globs of files never sent to a provider, one per line; checked when the field is left. */
function ExcludedGroup() {
  const t = useT();
  const excluded = useCompletionStore((s) => s.excluded);
  const [draft, setDraft] = useState(() => excluded.join("\n"));
  const globs = draft
    .split("\n")
    .map((g) => g.trim())
    .filter(Boolean);
  const valid = globs.length <= 100 && globs.every((g) => g.length <= 200);
  return (
    <Group title={t("completion.excluded")} description={t("completion.excludedHint")}>
      <div className="space-y-2 px-4 py-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => valid && useCompletionStore.getState().setExcluded(globs)}
          aria-label={t("completion.excluded")}
          aria-invalid={!valid}
          spellCheck={false}
          rows={5}
          className="font-mono text-[12.5px] md:text-[12.5px]"
        />
        {!valid && <p className="text-[12px] text-removed-foreground">{t("completion.excludedInvalid")}</p>}
      </div>
    </Group>
  );
}

export function CompletionSection() {
  const t = useT();
  const provider = useCompletionStore((s) => s.provider);
  const claudeModel = useCompletionStore((s) => s.claudeModel);
  const openaiModel = useCompletionStore((s) => s.openaiModel);
  const displayMode = useCompletionStore((s) => s.displayMode);
  const { setProvider, setClaudeModel, setOpenAiModel, setDisplayMode } = useCompletionStore.getState();
  const options: { value: CompletionProvider; label: string }[] = [
    { value: "off", label: t("completion.off") },
    { value: "copilot", label: "GitHub Copilot" },
    { value: "claude", label: "Claude" },
    { value: "openai", label: "OpenAI" },
  ];
  return (
    <>
      <Group>
        <SelectRow
          label={t("completion.provider")}
          hint={t("completion.providerHint")}
          value={provider}
          options={options}
          onChange={setProvider}
        />
        <SelectRow
          label={t("completion.displayMode")}
          hint={t("completion.displayModeHint")}
          value={displayMode}
          options={[
            { value: "eager", label: t("predictions.eager") },
            { value: "subtle", label: t("predictions.subtle") },
          ]}
          onChange={setDisplayMode}
        />
      </Group>
      {provider === "copilot" && <CopilotGroup />}
      {provider === "claude" && (
        <ApiKeyGroup
          provider="claude"
          placeholder="sk-ant-…"
          keysUrl="https://console.anthropic.com/settings/keys"
          models={CLAUDE_MODELS}
          model={claudeModel}
          onModel={setClaudeModel}
        />
      )}
      {provider === "openai" && (
        <ApiKeyGroup
          provider="openai"
          placeholder="sk-…"
          keysUrl="https://platform.openai.com/api-keys"
          models={OPENAI_MODELS}
          model={openaiModel}
          onModel={setOpenAiModel}
        />
      )}
      <ExcludedGroup />
    </>
  );
}
