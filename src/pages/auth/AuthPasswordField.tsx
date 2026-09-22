import { useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import AuthField from "./AuthField";

interface AuthPasswordFieldProps {
  id: string;
  label: string;
  autoComplete?: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
}

const AuthPasswordField = ({ id, label, autoComplete, required, value, onChange }: AuthPasswordFieldProps) => {
  const [visible, setVisible] = useState(false);
  return (
    <AuthField
      id={id}
      label={label}
      type={visible ? "text" : "password"}
      icon={Lock}
      autoComplete={autoComplete}
      required={required}
      value={value}
      onChange={onChange}
      rightElement={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Ocultar caracteres digitados" : "Mostrar caracteres digitados"}
          aria-pressed={visible}
          className="rounded text-white/40 transition-colors hover:text-white/80 focus-visible:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1a2b]"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      }
    />
  );
};

export default AuthPasswordField;
