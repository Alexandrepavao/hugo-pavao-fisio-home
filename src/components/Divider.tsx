const Divider = ({ className = "" }: { className?: string }) => (
  <div className={`hp-divider ${className}`} aria-hidden="true">
    <span className="hp-divider-dot" />
  </div>
);

export default Divider;
