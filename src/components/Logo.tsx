import { Link } from "react-router-dom";
import logo from "@/assets/hp-logo.png";

const Logo = ({ className = "h-12" }: { className?: string }) => (
  <Link to="/" className="flex items-center shrink-0" aria-label="HP Fisioterapia — página inicial">
    <img
      src={logo}
      alt="HP Fisioterapia — Movimento, Funcionalidade, Qualidade de Vida"
      className={`${className} w-auto object-contain`}
      loading="eager"
    />
  </Link>
);

export default Logo;
