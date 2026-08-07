import {
  Bone, Brain, Wind, Accessibility, Activity, Trophy, StretchHorizontal, Baby, HeartPulse,
} from "lucide-react";
import Divider from "./Divider";

const specialties = [
  { icon: Bone, name: "Ortopédica", text: "Recuperação de lesões, dores articulares e limitações de movimento." },
  { icon: Brain, name: "Neurológica", text: "Reabilitação funcional após AVC e em condições neurológicas." },
  { icon: Wind, name: "Respiratória", text: "Melhora da capacidade pulmonar e da higiene brônquica." },
  { icon: Accessibility, name: "Geriátrica", text: "Mobilidade, equilíbrio e prevenção de quedas na terceira idade." },
  { icon: Activity, name: "Pós-cirúrgica", text: "Protocolo de recuperação seguro logo após a alta hospitalar." },
  { icon: Trophy, name: "Desportiva", text: "Retorno ao esporte com força, controle motor e prevenção." },
  { icon: StretchHorizontal, name: "RPG", text: "Reeducação postural global para corrigir compensações do corpo." },
  { icon: HeartPulse, name: "Gestante e Uroginecológica", text: "Cuidado no pré e pós-parto e fortalecimento do assoalho pélvico." },
  { icon: Baby, name: "Pediátrica", text: "Estímulo ao desenvolvimento motor de bebês e crianças." },
];

const Specialties = () => (
  <section id="especialidades" className="section bg-card border-y border-border">
    <div className="container-hp">
      <div className="text-center max-w-2xl mx-auto">
        <p className="eyebrow">Especialidades</p>
        <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl text-navy-900 mt-5">
          O cuidado certo para cada necessidade
        </h2>
        <Divider className="mt-8" />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border mt-16 border border-border">
        {specialties.map((s) => (
          <div key={s.name} className="bg-card p-8 transition-colors duration-300 hover:bg-background">
            <s.icon className="w-6 h-6 text-accent" strokeWidth={1.25} />
            <h3 className="font-display text-xl text-navy-900 mt-5">{s.name}</h3>
            <p className="text-[15px] text-navy-400 mt-2">{s.text}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

export default Specialties;
