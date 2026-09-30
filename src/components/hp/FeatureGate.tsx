import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { featureOn, type FeatureKey } from "@/lib/release";

/** Rota de um recurso fora da versão de entrega: em vez de abrir a tela, explica que ainda não está disponível. */
const FeatureGate = ({ feature, children }: { feature: FeatureKey; children: ReactNode }) => {
  if (featureOn(feature)) return <>{children}</>;
  return (
    <div className="hp-card p-6 max-w-xl mx-auto text-center" role="status">
      <p className="font-medium mb-2">Recurso ainda não disponível nesta versão</p>
      <p className="text-sm text-muted-foreground mb-4">Esta função está em desenvolvimento e será liberada em uma próxima versão.</p>
      <Link className="hp-btn hp-btn-outline" to="/admin">Voltar ao início</Link>
    </div>
  );
};
export default FeatureGate;
