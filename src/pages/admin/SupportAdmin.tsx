import { PageHead } from "@/lib/ui";
import { SupportQueue } from "@/portal/Tickets";

/** Suporte Humanizado da HP: fila de chamados de pacientes (administrativos para a equipe; clínicos só para o fisio vinculado e o gestor). */
const SupportAdmin = () => (
  <>
    <PageHead eyebrow="Suporte" title="Chamados de pacientes" hint="Pacientes com pagamento confirmado abrem chamados pelo portal. Primeira resposta em até 24 horas." />
    <SupportQueue />
  </>
);
export default SupportAdmin;
