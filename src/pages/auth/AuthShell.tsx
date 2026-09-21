import type { ReactNode } from "react";
import Logo from "@/components/Logo";

const AuthShell = ({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) => (
  <div className="min-h-screen bg-background flex flex-col">
    <header className="px-6 sm:px-8 py-5 border-b border-border">
      <Logo className="h-12" />
    </header>
    <main className="flex-1 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <p className="eyebrow mb-3">HP Group Hub</p>
        <h1 className="text-3xl text-navy-900 mb-2">{title}</h1>
        {subtitle && <p className="text-navy-400 text-[15px] mb-8">{subtitle}</p>}
        <div className="bg-card border border-border p-8">{children}</div>
      </div>
    </main>
  </div>
);

export const fieldClass =
  "w-full border border-input bg-card px-4 py-3 text-[15px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

export default AuthShell;
