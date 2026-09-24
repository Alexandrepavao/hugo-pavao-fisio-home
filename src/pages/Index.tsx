import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import TrustBar from "@/components/TrustBar";
import HowItWorks from "@/components/HowItWorks";
import Specialties from "@/components/Specialties";
import Company from "@/components/Company";
import Coverage from "@/components/Coverage";
import Testimonials from "@/components/Testimonials";
import WorkWithUs from "@/components/WorkWithUs";
import FAQ from "@/components/FAQ";
import Footer from "@/components/Footer";
import WhatsAppFloat from "@/components/WhatsAppFloat";
import QuizCta from "@/components/QuizCta";
import QuizFloatButton from "@/components/QuizFloatButton";

const Index = () => {
  const { hash } = useLocation();

  useEffect(() => {
    if (hash) {
      document.querySelector(hash)?.scrollIntoView({ behavior: "smooth" });
    }
  }, [hash]);

  return (
    <div className="min-h-screen">
      <Header />
      <main>
        <Hero />
        <TrustBar />
        <HowItWorks />
        <QuizCta
          journey="atendimento"
          heading="Pronto para cuidar da sua dor com acompanhamento individualizado?"
          description="Responda algumas perguntas rápidas e receba um retorno da nossa equipe — o plano sempre depende de uma avaliação individual."
        />
        <Specialties />
        <Company />
        <Coverage />
        <Testimonials />
        <WorkWithUs />
        <FAQ />
      </main>
      <Footer />
      <WhatsAppFloat />
      <QuizFloatButton journey="atendimento" label="Avaliação gratuita" />
    </div>
  );
};

export default Index;
