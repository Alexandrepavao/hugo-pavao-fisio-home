import { useLocation, useNavigate } from "react-router-dom";
import DemoApp from "./DemoApp";

/** Rota /fisio/apresentar. O primeiro nome e o paciente vêm do estado da navegação (memória), nunca da URL nem do armazenamento do navegador; sem eles a demonstração usa um exemplo genérico. */
const DemoPresenter = () => {
  const nav = useNavigate(); const st = (useLocation().state ?? {}) as { firstName?: string; personId?: string };
  const back = st.personId ? `/fisio/pacientes?pessoa=${st.personId}` : "/fisio/pacientes";
  return <DemoApp key={st.personId ?? "generico"} firstName={st.firstName ?? ""} onExit={() => nav(back)} onPrepareReal={() => nav(back, { state: { preparar: true } })} />;
};
export default DemoPresenter;
