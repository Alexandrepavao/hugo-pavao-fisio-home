import { FunctionalCard, JourneyProvider, JourneyTimeline, NextAppointmentCard, PainChartCard, ReassessmentCard, SessionsCard, WeekCard } from "./ui";
import { PATIENT_HREF, useLiveJourney } from "./live";

type Part = "journey" | "pain" | "functional" | "week" | "next" | "sessions" | "reassessment";
/** Blocos visuais da jornada dentro das abas do portal real (Evolução, Agenda…), com os MESMOS componentes do Início e dos mesmos dados reais. */
export const LiveJourneyParts = ({ parts }: { parts: Part[] }) => {
  const { model } = useLiveJourney(); if (!model) return null;
  const pick = (p: Part) => ({ journey: <JourneyTimeline m={model} key={p} />, pain: <PainChartCard m={model} key={p} />, functional: <FunctionalCard m={model} key={p} />, week: <WeekCard m={model} key={p} />, next: <NextAppointmentCard m={model} key={p} />, sessions: <SessionsCard m={model} key={p} />, reassessment: <ReassessmentCard m={model} key={p} /> })[p];
  return <JourneyProvider value={{ hrefFor: (t) => PATIENT_HREF[t] }}><div className="jr" style={{ marginBottom: 24 }} data-testid="live-parts"><div className="jr-grid">{parts.map(pick)}</div></div></JourneyProvider>;
};
