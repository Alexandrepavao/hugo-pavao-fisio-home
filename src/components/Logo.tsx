import { Link } from "react-router-dom";

const Logo = ({ className = "h-12" }: { className?: string }) => (
  <Link to="/" className="flex items-center" aria-label="HP Fisioterapia — página inicial">
    <img
      src="/hp-logo.jpg"
      alt="HP Fisioterapia — Movimento, Funcionalidade, Qualidade de Vida"
      className={`${className} w-auto mix-blend-multiply`}
      loading="eager"
    />
  </Link>
);


export default Logo;
