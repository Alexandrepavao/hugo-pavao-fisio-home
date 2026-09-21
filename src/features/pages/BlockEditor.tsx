import { BLOCK_LABEL, BLOCK_SCHEMA, type Block, type FieldDef } from "./blocks";

type Obj = Record<string, unknown>;
const field = "w-full border border-input bg-card px-3 py-2 text-[15px] focus:outline-none focus:ring-2 focus:ring-ring";

const Field = ({ def, value, onChange, id }: { def: FieldDef; value: unknown; onChange: (v: unknown) => void; id: string }) => {
  if (def.kind === "list") {
    const items = (Array.isArray(value) ? value : []) as Obj[];
    return (
      <div className="border border-border p-3 space-y-3">
        <p className="text-sm text-navy-700">{def.label}</p>
        {items.map((it, i) => (
          <div key={i} className="bg-muted/40 p-3 space-y-2 relative">
            {def.fields!.map((sf) => (
              <Field key={sf.key} id={`${id}-${i}-${sf.key}`} def={sf} value={it[sf.key]}
                onChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, [sf.key]: v } : x)))} />
            ))}
            <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-xs text-destructive">Remover item</button>
          </div>
        ))}
        <button type="button" onClick={() => onChange([...items, {}])} className="text-sm text-accent hover:text-navy-900">+ Adicionar item</button>
      </div>
    );
  }
  return (
    <div>
      <label htmlFor={id} className="block text-sm text-navy-700 mb-1">{def.label}</label>
      {def.kind === "textarea"
        ? <textarea id={id} rows={4} className={field} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
        : <input id={id} className={field} type={def.kind === "url" ? "url" : "text"} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />}
      {def.hint && <p className="text-xs text-navy-400 mt-1">{def.hint}</p>}
    </div>
  );
};

interface Props {
  block: Block; index: number; total: number; forms: { id: string; name: string }[];
  onChange: (b: Block) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void;
}

const BlockEditor = ({ block, index, total, forms, onChange, onMove, onRemove }: Props) => (
  <fieldset className="bg-card border border-border p-4 space-y-3">
    <legend className="px-2 text-sm text-accent uppercase tracking-wider">{index + 1}. {BLOCK_LABEL[block.type]}</legend>
    {BLOCK_SCHEMA[block.type].map((d) => (
      <Field key={d.key} id={`b${index}-${d.key}`} def={d} value={block[d.key]} onChange={(v) => onChange({ ...block, [d.key]: v })} />
    ))}
    {block.type === "form" && (
      <div>
        <label htmlFor={`b${index}-form`} className="block text-sm text-navy-700 mb-1">Formulário</label>
        <select id={`b${index}-form`} className={field} value={(block.form_id as string) ?? ""} onChange={(e) => onChange({ ...block, form_id: e.target.value })}>
          {forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>
    )}
    <div className="flex gap-3 text-sm pt-1">
      <button type="button" disabled={index === 0} onClick={() => onMove(-1)} className="disabled:opacity-40" aria-label="Mover bloco para cima">↑ Subir</button>
      <button type="button" disabled={index === total - 1} onClick={() => onMove(1)} className="disabled:opacity-40" aria-label="Mover bloco para baixo">↓ Descer</button>
      <button type="button" onClick={onRemove} className="text-destructive ml-auto">Remover bloco</button>
    </div>
  </fieldset>
);

export default BlockEditor;
