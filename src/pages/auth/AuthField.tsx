import type { ChangeEvent, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface AuthFieldProps {
  id: string;
  label: string;
  type?: string;
  icon: LucideIcon;
  autoComplete?: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  rightElement?: ReactNode;
}

const AuthField = ({ id, label, type = "text", icon: Icon, autoComplete, required, value, onChange, rightElement }: AuthFieldProps) => (
  <div className="space-y-1.5 text-left">
    <Label htmlFor={id} className="text-xs font-medium text-white/70">
      {label}
    </Label>
    <div className="relative flex items-center">
      <Icon aria-hidden="true" className="pointer-events-none absolute left-3 h-4 w-4 text-white/40" />
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        required={required}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        className={cn(
          "h-11 border-white/10 bg-white/5 pl-10 text-[15px] text-white placeholder:text-white/30",
          "focus-visible:border-white/25 focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-0",
          rightElement && "pr-10"
        )}
      />
      {rightElement && <div className="absolute right-3 flex items-center">{rightElement}</div>}
    </div>
  </div>
);

export default AuthField;
