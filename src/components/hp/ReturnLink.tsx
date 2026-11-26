import { Link, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { HELP, helpKeyFor } from "@/content/ajuda";
import { safeBack } from "@/pages/admin/adm/central";

/** “Voltar” ao ponto de onde o usuário veio (parâmetro `voltar`, SÓ caminhos internos do /admin): preserva busca, aba e filtros da tela anterior. Some quando não há retorno. */
const ReturnLink = () => {
  const { search } = useLocation();
  const back = safeBack(new URLSearchParams(search).get("voltar"));
  if (!back) return null;
  const [path, qs = ""] = back.split("?");
  const nome = HELP[helpKeyFor(path, qs ? `?${qs}` : "")]?.titulo;
  return (
    <p className="hp-return" data-testid="voltar-contexto">
      <Link to={back}><ArrowLeft size={14} aria-hidden />{nome ? `Voltar para ${nome}` : "Voltar"}</Link>
    </p>
  );
};

export default ReturnLink;
