import { useSearchParams } from "react-router-dom";
import { PageHead, Tabs } from "@/lib/ui";
import PendenciesTab from "./PendenciesTab";
import DocumentsTab from "./DocumentsTab";
import ContractsTab from "./ContractsTab";
import ContactsTab from "./ContactsTab";
import RequirementsTab from "./RequirementsTab";

const TABS: [string, string][] = [["pendencias", "Pendências"], ["documentos", "Documentos"], ["contratos", "Contratos"], ["contatos", "Contatos"], ["requisitos", "Requisitos e prazos"]];

/** Gestão da central de pendências administrativas (registro, responsável, prazo, status, resolução e histórico) + documentos, contratos, verificação de contato e requisitos. */
const AdmPendencias = () => {
  const [sp, setSp] = useSearchParams(); const tab = TABS.some(([k]) => k === sp.get("aba")) ? sp.get("aba")! : "pendencias";
  return (
    <div>
      <PageHead eyebrow="Administrativo" title="Pendências administrativas" hint="Registre o que precisa de ação, com responsável e prazo, e acompanhe até a resolução. Documentos, contratos e requisitos alimentam os indicadores do Dashboard." />
      <Tabs tabs={TABS} value={tab} onChange={(v) => { const next = new URLSearchParams(); next.set("aba", v); setSp(next, { replace: true }); }} />
      {tab === "pendencias" && <PendenciesTab />}{tab === "documentos" && <DocumentsTab />}{tab === "contratos" && <ContractsTab />}{tab === "contatos" && <ContactsTab />}{tab === "requisitos" && <RequirementsTab />}
    </div>
  );
};

export default AdmPendencias;
