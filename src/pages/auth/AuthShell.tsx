import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import logo from "@/assets/hp-logo.png";

const AuthShell = ({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) => {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden overflow-y-auto bg-[#08111d] px-4 py-10 sm:px-6">
      {/* Fundo decorativo — estático, sem pulsação, não interativo */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-gradient-to-b from-[hsl(212,50%,21%)]/55 via-[#0a1420]/85 to-[#050b13]" />
        <div className="absolute -top-1/4 left-1/2 h-[60vh] w-[60vh] -translate-x-1/2 rounded-full bg-[hsl(212,50%,38%)]/25 blur-[110px]" />
        <div className="absolute -bottom-1/4 right-[-10%] h-[45vh] w-[45vh] rounded-full bg-[hsl(40,45%,45%)]/10 blur-[100px]" />
      </div>

      <div className="relative z-10 flex min-h-[calc(100vh-5rem)] w-full items-center justify-center">
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="w-full max-w-md"
        >
          <div className="mb-6 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/15 bg-white/95 p-2.5 shadow-[0_8px_30px_-10px_rgba(0,0,0,0.6)]">
              <img src={logo} alt="HP Fisioterapia" className="h-full w-full object-contain" />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-6 shadow-2xl backdrop-blur-xl sm:p-8">
            <div className="mb-6 text-center">
              <p className="eyebrow mb-2 text-accent/90">HP Group Hub</p>
              <h1 className="font-display text-2xl font-semibold text-white">{title}</h1>
              {subtitle && <p className="mt-2 text-[15px] text-white/60">{subtitle}</p>}
            </div>
            {children}
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default AuthShell;
