import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { JOURNEY_CTA_LABEL, JOURNEY_ROUTE, type Journey } from "@/lib/quiz";

interface Props { journey: Journey; heading: string; description: string; variant?: "panel" | "banner" }

/** CTA reutilizável para as duas jornadas de captação — usado na página inicial, em /trabalhe-conosco,
 * no rodapé e disponível no editor de landing pages (bloco "cta" com journey). */
const QuizCta = ({ journey, heading, description, variant = "panel" }: Props) => {
  const to = JOURNEY_ROUTE[journey];
  const label = JOURNEY_CTA_LABEL[journey];

  if (variant === "banner") {
    return (
      <div className="border border-accent/30 bg-accent/5 px-6 py-6 sm:px-8 sm:py-7 flex flex-col sm:flex-row sm:items-center gap-5 justify-between">
        <div>
          <p className="font-display text-xl text-navy-900">{heading}</p>
          <p className="text-[14px] text-navy-400 mt-1.5">{description}</p>
        </div>
        <Link to={to} className="inline-flex items-center justify-center gap-2 bg-accent text-accent-foreground text-[13px] uppercase tracking-[0.16em] px-7 py-3.5 hover:opacity-90 transition-opacity shrink-0">
          {label}<ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  return (
    <section className="section">
      <div className="container-hp">
        <div className="border border-border bg-card px-6 py-12 sm:px-14 sm:py-16 text-center">
          <p className="eyebrow">{JOURNEY_ROUTE[journey] === "/avaliacao" ? "Avaliação inicial" : "Parceria"}</p>
          <h2 className="font-display text-3xl sm:text-4xl text-navy-900 mt-5 max-w-2xl mx-auto">{heading}</h2>
          <p className="text-navy-400 mt-4 max-w-xl mx-auto">{description}</p>
          <Link to={to} className="inline-flex items-center justify-center gap-3 bg-accent text-accent-foreground text-[13px] uppercase tracking-[0.16em] px-8 py-4 mt-8 hover:opacity-90 transition-opacity">
            {label}<ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
};

export default QuizCta;
