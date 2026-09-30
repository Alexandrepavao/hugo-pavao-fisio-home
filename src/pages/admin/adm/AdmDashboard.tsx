import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { PageHead, State, StatCard } from "@/lib/ui";
import Greeting from "../Greeting";

/** Dashboard do ADM: os mesmos indicadores da planilha, aqui como ponto de entrada — clicar leva à planilha
 *  já filtrada. A tabela em si (com busca/ordenação/paginação) vive em Planilha administrativa. */
const AdmDashboard = () => {
  const navigate = useNavigate();
  const indicators = useQuery({ queryKey: ["adm-indicators"], queryFn: async () => {
    const from = new Date(); from.setDate(from.getDate() - 30);
    const { data, error } = await supabase.rpc("adm_directory_indicators", { p_from: from.toISOString(), p_to: new Date().toISOString(), p_unit: null });
    if (error) throw error; return data as Record<string, { value: number; available: boolean; basis: string }>;
  } });

  return (
    <div>
      <div className="mb-5"><Greeting /><p className="text-muted-foreground max-w-2xl">Resumo administrativo — cadastro central (pessoas físicas e jurídicas).</p></div>
      <PageHead eyebrow="ADM" title="Visão geral" />
      <State loading={indicators.isLoading} error={indicators.error} />
      {indicators.data && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Total de cadastros" value={indicators.data.total.value.toLocaleString("pt-BR")} basis={indicators.data.total.basis} onClick={() => navigate("/admin/adm/diretorio")} />
          <StatCard label="Pessoas físicas" value={indicators.data.pf.value.toLocaleString("pt-BR")} basis={indicators.data.pf.basis} onClick={() => navigate("/admin/adm/diretorio?tipo=pf")} />
          <StatCard label="Pessoas jurídicas" value={indicators.data.pj.value.toLocaleString("pt-BR")} basis={indicators.data.pj.basis} onClick={() => navigate("/admin/adm/diretorio?tipo=pj")} />
          <StatCard label="Novos (30 dias)" value={indicators.data.new_in_period.value.toLocaleString("pt-BR")} basis={indicators.data.new_in_period.basis} />
          <StatCard label="Cadastros incompletos" value={indicators.data.incomplete.value.toLocaleString("pt-BR")} basis={indicators.data.incomplete.basis} tone={indicators.data.incomplete.value > 0 ? "danger" : undefined} onClick={() => navigate("/admin/adm/diretorio?incompleto=1")} />
        </ul>
      )}
    </div>
  );
};

export default AdmDashboard;
