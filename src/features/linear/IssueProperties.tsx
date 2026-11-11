import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { AuthorAvatar } from "@/components/author-avatar";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/i18n";
import type { LinearIssueDetail } from "@/types/git";
import { PRIORITIES, PriorityIcon, StateDot } from "./LinearList";
import { ProjectIcon } from "./ProjectIcon";
import { useLabels, useProjects, useTeamMembers, useTeamStates } from "./linear-queries";
import { useUpdateIssue, type IssueUpdate } from "./use-update-issue";

const NONE = "none";

type Option = { id: string; label: string; icon?: ReactNode; selected: boolean };

/** A property value that opens a searchable list, as in Linear's sidebar. */
function Picker(props: {
  label: string;
  trigger: ReactNode;
  options: Option[];
  onPick: (id: string) => void;
  /** Labels: the list stays open to pick several. */
  multi?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const pick = (o: Option) => {
    props.onPick(o.id);
    if (!props.multi) setOpen(false);
  };
  // As in Linear: with nothing typed, 1…9 then 0 pick the options in order.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (search || e.metaKey || e.ctrlKey || e.altKey || !/^[0-9]$/.test(e.key)) return;
    const option = props.options[(Number(e.key) + 9) % 10];
    if (!option) return;
    e.preventDefault();
    pick(option);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={props.label}
          className="-mx-1.5 flex min-h-7 max-w-full min-w-0 flex-wrap items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left hover:bg-white/[0.06]"
        >
          {props.trigger}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 rounded-lg p-0">
        <Command loop onKeyDown={onKeyDown}>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            icon={false}
            wrapperClassName="h-9 px-3"
            placeholder={t("linear.changeProperty", { property: props.label })}
            className="text-[13px]"
          />
          <CommandList className="max-h-72 p-1">
            <CommandEmpty>{t("linear.noMatch")}</CommandEmpty>
            {props.options.map((o, i) => (
              <CommandItem
                key={o.id}
                value={o.id}
                keywords={[o.label]}
                onSelect={() => pick(o)}
                className="h-8 gap-2 px-2 [&_svg:not([class*='size-'])]:size-3.5"
              >
                {o.icon}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.selected && <Check aria-hidden className="size-3.5 text-foreground" />}
                {i < 10 && (
                  <span className="w-3 text-right text-[11.5px] text-muted-foreground tabular-nums">
                    {(i + 1) % 10}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-8 grid-cols-[96px_1fr] items-center gap-2 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">{children}</span>
    </div>
  );
}

type PickerProps = { orgId: string | undefined; issue: LinearIssueDetail; update: (u: IssueUpdate) => void };

function StatusPicker({ orgId, issue, update }: PickerProps) {
  const t = useT();
  const team = useTeamStates(orgId).data?.find((x) => x.id === issue.team.id);
  const states = [...(team?.states.nodes ?? [])].sort((a, b) => a.position - b.position);
  return (
    <Picker
      label={t("linear.status")}
      trigger={
        <>
          <StateDot state={issue.state} />
          {issue.state.name}
        </>
      }
      options={states.map((s) => ({
        id: s.id,
        label: s.name,
        icon: <StateDot state={s} />,
        selected: s.id === issue.state.id,
      }))}
      onPick={(id) => {
        const state = states.find((s) => s.id === id);
        if (state && id !== issue.state.id) update({ patch: { stateId: id }, shown: { state } });
      }}
    />
  );
}

function PriorityPicker({ issue, update }: PickerProps) {
  const t = useT();
  return (
    <Picker
      label={t("linear.priority")}
      trigger={
        <>
          <PriorityIcon priority={issue.priority} />
          {issue.priorityLabel}
        </>
      }
      options={PRIORITIES.map((p) => ({
        id: String(p.value),
        label: t(p.label),
        icon: <PriorityIcon priority={p.value} />,
        selected: p.value === issue.priority,
      }))}
      onPick={(id) => {
        const priority = PRIORITIES.find((p) => String(p.value) === id);
        if (priority && priority.value !== issue.priority)
          update({
            patch: { priority: priority.value },
            shown: { priority: priority.value, priorityLabel: t(priority.label) },
          });
      }}
    />
  );
}

function AssigneePicker({ orgId, issue, update }: PickerProps) {
  const t = useT();
  const members = useTeamMembers(orgId, issue.team.id).data ?? [];
  const current = issue.assignee;
  return (
    <Picker
      label={t("linear.assignee")}
      trigger={
        current ? (
          <>
            <AuthorAvatar name={current.name} src={current.avatarUrl} className="size-5" />
            {current.name}
          </>
        ) : (
          <span className="text-muted-foreground">{t("linear.unassigned")}</span>
        )
      }
      options={[
        { id: NONE, label: t("linear.unassigned"), selected: !current },
        ...members.map((m) => ({
          id: m.id,
          label: m.name,
          icon: <AuthorAvatar name={m.name} src={m.avatarUrl} className="size-4" />,
          selected: m.id === current?.id,
        })),
      ]}
      onPick={(id) => {
        const assignee = members.find((m) => m.id === id) ?? null;
        if ((assignee?.id ?? null) !== (current?.id ?? null))
          update({ patch: { assigneeId: assignee?.id ?? null }, shown: { assignee } });
      }}
    />
  );
}

function LabelsPicker({ orgId, issue, update }: PickerProps) {
  const t = useT();
  const labels = useLabels(orgId, issue.team.id).data ?? [];
  const chosen = issue.labels.nodes;
  const toggle = (id: string) => {
    const label = labels.find((l) => l.id === id);
    const next = chosen.some((l) => l.id === id)
      ? chosen.filter((l) => l.id !== id)
      : label
        ? [...chosen, label]
        : chosen;
    update({ patch: { labelIds: next.map((l) => l.id) }, shown: { labels: { nodes: next } } });
  };
  const dot = (color: string) => <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />;
  return (
    <Picker
      multi
      label={t("linear.labels")}
      trigger={
        chosen.length > 0 ? (
          chosen.map((l) => (
            <span
              key={l.id}
              className="flex items-center gap-1.5 rounded-full border border-white/10 px-2 py-0.5 text-[12px]"
            >
              {dot(l.color)}
              {l.name}
            </span>
          ))
        ) : (
          <span className="text-muted-foreground">{t("linear.addLabel")}</span>
        )
      }
      options={labels.map((l) => ({
        id: l.id,
        label: l.name,
        icon: dot(l.color),
        selected: chosen.some((c) => c.id === l.id),
      }))}
      onPick={toggle}
    />
  );
}

function ProjectPicker({ orgId, issue, update }: PickerProps) {
  const t = useT();
  const projects = (useProjects(orgId).data ?? []).filter((p) => p.teams.nodes.some((x) => x.id === issue.team.id));
  const current = issue.project;
  return (
    <Picker
      label={t("linear.project")}
      trigger={
        current ? (
          <>
            <ProjectIcon project={current} />
            <span className="truncate">{current.name}</span>
          </>
        ) : (
          <span className="text-muted-foreground">{t("linear.noProject")}</span>
        )
      }
      options={[
        { id: NONE, label: t("linear.noProject"), selected: !current },
        ...projects.map((p) => ({
          id: p.id,
          label: p.name,
          icon: <ProjectIcon project={p} />,
          selected: p.id === current?.id,
        })),
      ]}
      onPick={(id) => {
        const p = projects.find((x) => x.id === id);
        const project = p ? { id: p.id, name: p.name, icon: p.icon, color: p.color } : null;
        if ((project?.id ?? null) !== (current?.id ?? null))
          update({ patch: { projectId: project?.id ?? null }, shown: { project } });
      }}
    />
  );
}

/** The issue's properties, each changed in place as in Linear. */
export function IssueProperties({ orgId, issue, children }: Omit<PickerProps, "update"> & { children?: ReactNode }) {
  const t = useT();
  const { mutate } = useUpdateIssue(orgId, issue);
  const props = { orgId, issue, update: mutate };
  return (
    <>
      <Meta label={t("linear.status")}>
        <StatusPicker {...props} />
      </Meta>
      <Meta label={t("linear.priority")}>
        <PriorityPicker {...props} />
      </Meta>
      <Meta label={t("linear.assignee")}>
        <AssigneePicker {...props} />
      </Meta>
      <Meta label={t("linear.labels")}>
        <LabelsPicker {...props} />
      </Meta>
      <Meta label={t("linear.project")}>
        <ProjectPicker {...props} />
      </Meta>
      {children}
    </>
  );
}
