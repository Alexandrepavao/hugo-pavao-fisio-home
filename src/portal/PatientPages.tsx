import { PatientPart, PersonalData, Chat } from "@/pages/portal/Patient";
import Journey from "@/pages/portal/Journey";
import { PortalPage } from "./AppShell";
import { PatientEvolutionPanel } from "./Evolution";
import { AccessLogSection, ConsentsSection, RepresentativesSection, RepresentedSection } from "./PatientAccess";

/** Abas do portal do paciente que reaproveitam as telas já provadas (agenda, jornada, orientações, pacote). Os blocos novos entram por fase (docs/plano-portais-paciente-e-fisio.md). */
export const PatientAgenda = () => <PortalPage title="Agenda"><PatientPart part="agenda" /></PortalPage>;
export const PatientEvolution = () => <PortalPage title="Evolução"><PatientEvolutionPanel /><Journey /></PortalPage>;
export const PatientTraining = () => <PortalPage title="Treinos em casa"><PatientPart part="orientacoes" /></PortalPage>;
export const PatientMore = () => (
  <PortalPage title="Mais">
    <PatientPart part="pacote" />
    <PersonalData />
    <Chat />
    <RepresentedSection />
    <RepresentativesSection />
    <ConsentsSection />
    <AccessLogSection />
  </PortalPage>
);
