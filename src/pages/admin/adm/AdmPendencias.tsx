import { useSearchParams } from "react-router-dom";
import { PageHead, Tabs } from "@/lib/ui";
import PendenciesTab from "./PendenciesTab";
import DocumentsTab from "./DocumentsTab";
import ContractsTab from "./ContractsTab";
import ContactsTab from "./ContactsTab";
import RequirementsTab from "./RequirementsTab";

const HEAD: Record<string, { title: string; hint: string }> = {
  pendencias: { title: "Pendências", hint: "O que precisa ser resolvido, quem é o responsável e até quando." },
  documentos: { title: "Documentos", hint: "Documentos de cadastro: vigentes, vencendo, vencidos e ausentes." },
  contratos: { title: "Contratos", hint: "Contratos administrativos: do rascunho à assinatura registrada." },
  contatos: { title: "Contatos", hint: "Verificação humana dos contatos dos cadastros." },
  requisitos: { title: "Requisitos e prazos", hint: "O que a organização exige e os prazos dos alertas." },
};
const TABS: [string, string][] = [["pendencias", "Pendências"], ["documentos", "Documentos"], ["contratos", "Contratos"], ["contatos", "Contatos"], ["requisitos", "Requisitos e prazos"]];

/** Gestão da central de pendências administrativas (registro, responsável, prazo, status, resolução e histórico) + documentos, contratos, verificação de contato e requisitos. */
const AdmPendencias = () => {
  const [sp, setSp] = useSearchParams(); const tab = TABS.some(([k]) => k === sp.get("aba")) ? sp.get("aba")! : "pendencias";
  return (
    <div>
      <PageHead eyebrow="Administrativo" title={HEAD[tab].title} hint={HEAD[tab].hint} />
      <Tabs tabs={TABS} value={tab} onChange={(v) => { const next = new URLSearchParams(); next.set("aba", v); setSp(next, { replace: true }); }} />
      {tab === "pendencias" && <PendenciesTab />}{tab === "documentos" && <DocumentsTab />}{tab === "contratos" && <ContractsTab />}{tab === "contatos" && <ContactsTab />}{tab === "requisitos" && <RequirementsTab />}
    </div>
  );
};

export default AdmPendencias;
