import { useId, type ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** A titled card of setting rows separated by hairlines. */
export function Group({ title, description, children }: { title?: string; description?: string; children: ReactNode }) {
  return (
    <section>
      {title && <h2 className="text-[13.5px] font-semibold text-foreground">{title}</h2>}
      {description && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</p>}
      <div
        className={cn(
          "divide-y divide-white/[0.06] rounded-xl border border-white/8 bg-card",
          (title || description) && "mt-2.5",
        )}
      >
        {children}
      </div>
    </section>
  );
}

type RowProps = { label: ReactNode; hint?: string; htmlFor?: string; children?: ReactNode; className?: string };

/** Label and hint on the left, control on the right. */
export function Row({ label, hint, htmlFor, children, className }: RowProps) {
  return (
    <div className={cn("flex min-h-12 items-center justify-between gap-6 px-4 py-2.5", className)}>
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-[13px] font-medium text-foreground">
          {label}
        </label>
        {hint && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{hint}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

type SwitchRowProps = {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
};

export function SwitchRow({ label, hint, checked, disabled, onChange }: SwitchRowProps) {
  const id = useId();
  return (
    <Row label={label} hint={hint} htmlFor={id} className={cn(disabled && "opacity-60")}>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </Row>
  );
}

type Option<V> = { value: V; label: string };
type SelectRowProps<V extends string | number> = {
  label: string;
  hint?: string;
  value: V;
  options: Option<V>[];
  onChange: (value: V) => void;
};

export function SelectRow<V extends string | number>({ label, hint, value, options, onChange }: SelectRowProps<V>) {
  const id = useId();
  const toValue = (raw: string) => options.find((o) => String(o.value) === raw)?.value ?? value;
  return (
    <Row label={label} hint={hint} htmlFor={id}>
      <Select value={String(value)} onValueChange={(raw) => onChange(toValue(raw))}>
        <SelectTrigger id={id} size="sm" className="h-7 w-52 text-[13px] data-[size=sm]:h-7">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={String(option.value)} value={String(option.value)} className="text-[13px]">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-[5px] border border-white/10 bg-white/[0.06] px-1.5 font-sans text-[12px] text-foreground/90 shadow-[inset_0_-1px_0_rgba(255,255,255,0.06)]">
      {children}
    </kbd>
  );
}
