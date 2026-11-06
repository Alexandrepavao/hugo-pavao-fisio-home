import { PatientPart, PersonalData, Chat } from "@/pages/portal/Patient";
import Journey from "@/pages/portal/Journey";
import { PortalPage } from "./AppShell";
import { PatientEvolutionPanel } from "./Evolution";
import { PatientTickets } from "./Tickets";
import { PatientTrainingPanel } from "./Training";
import { Link } from "react-router-dom";
import { AccessLogSection, ConsentsSection, NotificationsSection, OffersSection, RepresentativesSection, RepresentedSection } from "./PatientAccess";

/** Abas do portal do paciente que reaproveitam as telas já provadas (agenda, jornada, orientações, pacote). Os blocos novos entram por fase (docs/plano-portais-paciente-e-fisio.md). */
export const PatientAgenda = () => <PortalPage title="Agenda"><PatientPart part="agenda" /></PortalPage>;
export const PatientEvolution = () => <PortalPage title="Evolução"><PatientEvolutionPanel /><Journey /></PortalPage>;
export const PatientTraining = () => <PortalPage title="Treinos em casa"><PatientTrainingPanel /><PatientPart part="orientacoes" /></PortalPage>;
export const PatientTicketsPage = () => <PortalPage title="Chamados" subtitle="Suporte da equipe HP para quem já é paciente"><PatientTickets /></PortalPage>;
export const PatientMore = () => (
  <PortalPage title="Mais">
    <Link to="/paciente/chamados" className="hp-card mb-8 block p-4 text-sm" data-testid="link-chamados"><b>Suporte e chamados</b><span className="block text-muted-foreground">Dúvidas sobre agenda, pagamento ou treino: fale com a equipe. Respondemos em até 24 horas.</span></Link>
    <OffersSection />
    <PatientPart part="pacote" />
    <PersonalData />
    <Chat />
    <RepresentedSection />
    <RepresentativesSection />
    <NotificationsSection />
    <ConsentsSection />
    <AccessLogSection />
  </PortalPage>
);
