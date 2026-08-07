import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import TrustBar from "@/components/TrustBar";
import HowItWorks from "@/components/HowItWorks";
import Specialties from "@/components/Specialties";
import About from "@/components/About";
import Coverage from "@/components/Coverage";
import Testimonials from "@/components/Testimonials";
import WorkWithUs from "@/components/WorkWithUs";
import FAQ from "@/components/FAQ";
import Footer from "@/components/Footer";
import WhatsAppFloat from "@/components/WhatsAppFloat";

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
        <Specialties />
        <About />
        <Coverage />
        <Testimonials />
        <WorkWithUs />
        <FAQ />
      </main>
      <Footer />
      <WhatsAppFloat />
    </div>
  );
};

export default Index;
