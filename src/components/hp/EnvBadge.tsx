import { BUILD_INFO, IS_PRODUCTION } from "@/lib/release";

/** Selo fixo em qualquer ambiente que não seja produção: teste/preview usa banco Dev com dados fictícios. */
const EnvBadge = () => {
  if (IS_PRODUCTION) return null;
  return (
    <div aria-hidden="true" data-testid="env-badge" style={{ position: "fixed", left: 8, bottom: 8, zIndex: 60, pointerEvents: "none" }}
      className="rounded-full bg-warning text-white text-[10px] font-semibold tracking-wide px-2 py-0.5 opacity-80 shadow">
      AMBIENTE DE TESTE · {BUILD_INFO.backend}
    </div>
  );
};
export default EnvBadge;
