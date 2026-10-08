import { useEffect, useState } from "react";
import { useMyAccount } from "@/components/hp/useMyAccount";

/** "Bom dia/Boa tarde/Boa noite" pelo relógio LOCAL do dispositivo (nunca UTC/Brasília fixo) — só a saudação, nada de agenda/competência. */
const greetingFor = (h: number) => (h < 12 ? "Bom dia" : h < 19 ? "Boa tarde" : "Boa noite");

const useLocalHour = () => {
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    // Checa a cada minuto (barato) e também ao voltar para a aba — cobre a virada de horário sem depender de foco contínuo.
    const tick = () => setHour(new Date().getHours());
    const id = window.setInterval(tick, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  return hour;
};

const Greeting = () => {
  const hour = useLocalHour();
  const profile = useMyAccount();
  const name = profile.data?.display_name?.trim().split(" ")[0];
  // AppShell já renderiza o h1 da página (breadcrumb "Início"); esta saudação é h2, como o título de qualquer outra tela.
  return <h2 className="!text-[1.75rem] sm:!text-[2rem] !leading-tight font-extrabold text-foreground mb-1">{greetingFor(hour)}{name ? `, ${name}!` : "!"}</h2>;
};

export default Greeting;
