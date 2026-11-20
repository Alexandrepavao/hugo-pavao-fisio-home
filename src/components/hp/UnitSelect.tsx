import * as S from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

const ALL = "__todas__";

/** Seletor de unidades acessível (Radix Select): teclado completo (setas, Enter, Esc, digitação), foco devolvido ao botão ao fechar, menu em portal que se reposiciona e rola por dentro,
 *  nome longo com reticências no botão e quebra de linha no menu. As unidades vêm de quem usa (fonte de dados atual, já filtrada por organização e permissão). Vazio = "Todas as unidades"
 *  (mesmo significado de antes), a menos que `required` (Agenda: precisa de uma unidade). */
export const UnitSelect = ({ id = "pf-unit", units, value, onChange, required = false, allLabel = "Todas as unidades", label = "Unidade", disabled }: {
  id?: string; units: { id: string; name: string }[]; value: string; onChange: (v: string) => void; required?: boolean; allLabel?: string; label?: string; disabled?: boolean;
}) => {
  const current = units.find((u) => u.id === value)?.name ?? (required ? "Selecione a unidade" : allLabel);
  return (
    <S.Root value={value || (required ? "" : ALL)} onValueChange={(v) => onChange(v === ALL ? "" : v)} disabled={disabled}>
      <S.Trigger id={id} className="hp-unit-trigger" aria-label={`${label}: ${current}`} title={current}>
        <S.Value placeholder="Selecione a unidade">{current}</S.Value>
        <S.Icon asChild><ChevronDown size={15} aria-hidden /></S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content className="hp-unit-menu" position="popper" side="bottom" align="start" sideOffset={4} collisionPadding={12}>
          <S.Viewport className="p-1" style={{ maxHeight: "inherit", overflowY: "auto" }}>
            {!required && <UnitItem value={ALL}>{allLabel}</UnitItem>}
            {units.map((u) => <UnitItem key={u.id} value={u.id}>{u.name}</UnitItem>)}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
};

const UnitItem = ({ value, children }: { value: string; children: string }) => (
  <S.Item value={value} className="hp-unit-item" data-unit-id={value === ALL ? "" : value}>
    <S.ItemText>{children}</S.ItemText>
    <S.ItemIndicator className="hp-unit-check"><Check size={14} aria-hidden /></S.ItemIndicator>
  </S.Item>
);

export default UnitSelect;
