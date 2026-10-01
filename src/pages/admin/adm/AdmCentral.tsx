import type { ReactNode } from "react";
import { AlertTriangle, CalendarClock, ClipboardX, FileClock, FileSignature, UserCog } from "lucide-react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/format";
import { Badge, KpiGrid, LevelSection, State, StatCard, Table, Td, btnGhost, errText, promptText, useMsg, Msg } from "@/lib/ui";
import { BarBlock, Formula, LineBlock } from "@/lib/IndicatorCharts";
import type { IndicatorTrigger } from "@/lib/IndicatorSheet";
import { KIND_LABEL, PEND_KIND, fmtHours, subjectRoute, useAdmCentral, usePendencies, type Central, type Filters, type Metric } from "./central";

const n = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR"));
const pct = (v: number | null | undefined) => (v == null ? "—" : `${String(v).replace(".", ",")}%`);

/** Grupo de números do mesmo assunto; cada linha com ação abre os registros que a compõem. `when` diferencia situação de HOJE de indicador calculado no PERÍODO. */
const Group = ({ title, when, rows, note }: { title: string; when: "hoje" | "periodo"; rows: { label: string; value: ReactNode; onClick?: () => void; tone?: "danger" }[]; note?: string }) => (
  <section className="hp-card p-4" aria-label={title}>
    <div className="flex items-start justify-between gap-2"><h3 className="text-[0.9375rem] font-semibold">{title}</h3><Badge tone={when === "hoje" ? "neutral" : "info"}>{when === "hoje" ? "Situação de hoje" : "No período"}</Badge></div>
    <ul className="mt-2 divide-y divide-border">
      {rows.map((r) => (
        <li key={r.label}>{r.onClick
          ? <button type="button" onClick={r.onClick} className="w-full flex items-center justify-between gap-3 py-2 text-left text-sm hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span>{r.label}</span><span className={`tabular font-semibold ${r.tone === "danger" ? "text-destructive" : ""}`}>{r.value}</span></button>
          : <div className="flex items-center justify-between gap-3 py-2 text-sm"><span>{r.label}</span><span className="tabular font-semibold">{r.value}</span></div>}</li>))}
    </ul>
    {note && <p className="text-[11px] leading-4 text-muted-foreground mt-2">{note}</p>}
  </section>
);
const Unavailable = ({ m }: { m: Metric }) => <span className="text-muted-foreground font-normal text-xs">indisponível — {m.basis.replace(/^indisponível:\s*/, "")}</span>;

/** Central de pendências administrativas: cartões prioritários, indicadores complementares, gráficos e lista de prioridades. Base: adm_central / adm_central_detail (docs/indicadores-administrativo.md). */
/** `cadastroResumo` e `cadastroAnalise` são os blocos do cadastro central (números e gráficos), encaixados nos níveis Resumo e Análise. `mapa` entra no nível Análise. */
const AdmCentral = ({ from, to, unit, unitName, filters, onOpen, hero, cadastroResumo, cadastroAnalise, mapa }: { from: string; to: string; unit: string; unitName: string; filters: Filters; onOpen: (t: IndicatorTrigger) => void; hero?: ReactNode; cadastroResumo?: ReactNode; cadastroAnalise?: ReactNode; mapa?: ReactNode }) => {
  const q = useAdmCentral(from, to, unit, filters);
  const prio = usePendencies(unit, filters, filters.status === "overdue" ? "overdue" : "open", 15);
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const d = q.data;
  const open = (kind: string, value?: string, title?: string) => onOpen({ rpc: "adm_central_detail", title,
    params: { p_kind: kind, p_value: value ?? null, p_from: from, p_to: to, p_unit: unit || null, p_owner: filters.owner || null, p_type: filters.type || null, p_kind_filter: filters.kind || null, p_status: filters.status || null },
    scope: `${unitName}${kind.includes("resolved") ? ` · ${from.slice(0, 10)} a ${to.slice(0, 10)}` : ""}` });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["adm-central"] }); void qc.invalidateQueries({ queryKey: ["adm-pendencies"] }); };
  const resolve = async (id: string) => {
    const note = await promptText("Concluir pendência", "Como foi resolvida?", { multiline: true, confirmLabel: "Concluir", required: true }); if (!note) return;
    const { error } = await supabase.rpc("adm_pendency_resolve", { p_id: id, p_note: note });
    if (error) m.err(errText(error)); else { m.ok("Pendência concluída."); refresh(); }
  };

  if (q.error) return <State error={q.error} />;
  if (q.isLoading || !d) return <State loading />;
  const c = d.cards, k = d.kpis;
  const evo = d.evolution.map((w) => ({ semana: fmtDate(`${w.week}T12:00:00Z`).slice(0, 5), Abertas: w.opened, Concluídas: w.resolved, "Em aberto ao fim": w.open_at_end }));
  const card = (mt: Metric) => n(mt.value);
  const lv = (mt: Metric) => ((mt.value ?? 0) > 0 ? "attention" : "compact") as "attention" | "compact";
  const st = (mt: Metric, danger = false) => ((mt.value ?? 0) > 0 ? (danger ? "Crítico" : "Atenção") : undefined);

  return (
    <div>
      <Msg m={msg} />
      {hero}

      <LevelSection level="attention" title="Prioridades administrativas" hint="Situação de hoje (não muda com o período). Clique para abrir os registros.">
        <KpiGrid kind="lg">
          <StatCard level={lv(c.overdue_pendencies)} icon={AlertTriangle} status={st(c.overdue_pendencies, true)} label="Pendências administrativas vencidas" value={card(c.overdue_pendencies)} unit="pendências" period="Hoje" basis={c.overdue_pendencies.basis} tone={(c.overdue_pendencies.value ?? 0) > 0 ? "danger" : undefined} onClick={() => open("overdue_pendencies")} />
          <StatCard level={lv(c.incomplete)} icon={ClipboardX} status={st(c.incomplete, true)} label="Cadastros incompletos" value={card(c.incomplete)} unit="cadastros" period="Hoje" basis={c.incomplete.basis} tone={(c.incomplete.value ?? 0) > 0 ? "danger" : undefined} onClick={() => open("incomplete")} />
          <StatCard level={lv(c.docs_expiring)} icon={FileClock} status={st(c.docs_expiring, false)} label={`Documentos vencendo em ${d.settings.expiring_days} dias`} value={card(c.docs_expiring)} unit="documentos" period="Hoje" basis={c.docs_expiring.basis} tone={(c.docs_expiring.value ?? 0) > 0 ? "warning" : undefined} onClick={() => open("docs_expiring")} />
          <StatCard level={lv(c.contracts_awaiting)} icon={FileSignature} status={st(c.contracts_awaiting, false)} label="Contratos aguardando assinatura" value={card(c.contracts_awaiting)} unit="contratos" period="Hoje" basis={c.contracts_awaiting.basis} tone={(c.contracts_awaiting.value ?? 0) > 0 ? "warning" : undefined} onClick={() => open("contracts_awaiting")} />
          <StatCard level={lv(c.patients_waiting)} icon={CalendarClock} status={st(c.patients_waiting, false)} label="Pacientes aguardando agendamento" value={card(c.patients_waiting)} unit="pacientes" period="Hoje" basis={c.patients_waiting.basis} tone={(c.patients_waiting.value ?? 0) > 0 ? "warning" : undefined} onClick={() => open("patients_waiting")} />
          <StatCard level={lv(c.professionals_incomplete)} icon={UserCog} status={st(c.professionals_incomplete, true)} label="Profissionais com integração administrativa incompleta" value={card(c.professionals_incomplete)} unit="profissionais" period="Hoje" basis={c.professionals_incomplete.basis} tone={(c.professionals_incomplete.value ?? 0) > 0 ? "danger" : undefined} onClick={() => open("professionals_incomplete")} />
        </KpiGrid>
      </LevelSection>

      <LevelSection level="summary" title="Indicadores complementares" hint="Totais e situação atual, por assunto.">
        {cadastroResumo}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <section className="hp-card p-4 md:col-span-2 xl:col-span-2" aria-label="Cadastros completos">
            <div className="flex items-start justify-between gap-2"><h3 className="text-[0.9375rem] font-semibold">Cadastros completos</h3><Badge>Situação de hoje</Badge></div>
            {k.completeness.available
              ? <p className="mt-1 text-[1.5rem] leading-8 font-bold tabular">{pct(k.completeness.value)} <span className="text-sm font-normal text-muted-foreground">({n(k.completeness.complete)} de {n(k.completeness.total)})</span></p>
              : <p className="mt-1 text-sm text-muted-foreground">Indisponível — {k.completeness.basis}</p>}
            <div className="mt-2 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground border-b border-border"><th className="py-1.5 font-medium">Por tipo e vínculo</th><th className="py-1.5 font-medium text-right">Cadastros</th><th className="py-1.5 font-medium text-right">Completos</th><th className="py-1.5 font-medium text-right">%</th><th /></tr></thead>
              <tbody>{k.completeness_groups.map((g) => (
                <tr key={g.key} className="border-b border-border last:border-0"><td className="py-1.5">{g.key === "pf" ? "Pessoas físicas (todas)" : g.key === "pj" ? "Pessoas jurídicas" : g.key === "professional" ? "Profissionais (requisitos para atender)" : `Vínculo: ${KIND_LABEL[g.key] ?? g.key}`}</td>
                  <td className="py-1.5 text-right tabular">{n(g.total)}</td><td className="py-1.5 text-right tabular">{n(g.complete)}</td><td className="py-1.5 text-right tabular">{pct(g.pct)}</td>
                  <td className="py-1.5 text-right">{g.total - g.complete > 0 && <button type="button" className="text-accent text-xs hover:underline" onClick={() => open(g.key === "professional" ? "professionals_incomplete" : "incomplete_group", g.key === "professional" ? undefined : g.key)}>{g.total - g.complete} incompleto(s)</button>}</td></tr>))}</tbody></table></div>
            <Formula>{k.completeness.basis}</Formula>
          </section>
          <Group title="Possíveis duplicidades" when="hoje" rows={[{ label: "Grupos para revisar", value: n(k.duplicates.groups), onClick: () => open("duplicates"), tone: k.duplicates.groups > 0 ? "danger" : undefined }, { label: "Cadastros envolvidos", value: n(k.duplicates.people) }]} note={k.duplicates.basis} />
          <Group title="Contatos" when="hoje" rows={[
            { label: "Com formato válido", value: `${n(k.contacts.valid_format)} de ${n(k.contacts.total)} (${pct(k.contacts.valid_pct)})` },
            { label: "Formato inválido", value: n(k.contacts.invalid_format), onClick: () => open("contacts_invalid") },
            { label: "Verificados (registro humano)", value: k.contacts.verified_available ? `${n(k.contacts.verified)} de ${n(k.contacts.total)} (${pct(k.contacts.verified_pct)})` : <Unavailable m={{ value: null, available: false, basis: k.contacts.basis_verified }} /> },
            { label: "Sem verificação registrada", value: n(k.contacts.total - k.contacts.verified), onClick: () => open("contacts_unverified") }]}
            note={`${k.contacts.basis_valid} Verificado é outra coisa: só conta o que uma pessoa da equipe registrou (Administrativo › Pendências › Contatos).`} />
          <Group title="Documentos" when="hoje" rows={[
            { label: "Ausentes (exigidos e sem registro)", value: n(k.documents.missing), onClick: () => open("docs_missing"), tone: k.documents.missing > 0 ? "danger" : undefined },
            { label: "Vencidos", value: n(k.documents.expired), onClick: () => open("docs_expired"), tone: k.documents.expired > 0 ? "danger" : undefined },
            { label: `Vencendo em ${d.settings.expiring_days} dias`, value: n(k.documents.expiring), onClick: () => open("docs_expiring") },
            { label: "Sem data de validade informada", value: n(k.documents.no_expiry_date), onClick: () => open("docs_no_expiry") }]}
            note={`${k.documents.basis}${k.documents.requirements_configured ? "" : " Nenhum requisito de documento está configurado: “ausentes” fica em 0 por falta de requisito, não porque tudo esteja em dia (Administrativo › Pendências › Requisitos)."}`} />
          <Group title="Contratos administrativos" when="hoje" rows={[
            { label: "Rascunho", value: n(k.contracts.by_status.draft), onClick: () => open("contracts_status", "draft") },
            { label: "Aguardando assinatura", value: n(k.contracts.by_status.awaiting_signature), onClick: () => open("contracts_awaiting") },
            { label: "— com prazo de assinatura vencido", value: n(k.contracts.awaiting_overdue) },
            { label: "Assinados (vigentes)", value: n(k.contracts.signed_current), onClick: () => open("contracts_status", "vigente") },
            { label: `A vencer em ${d.settings.expiring_days} dias`, value: n(k.contracts.ending), onClick: () => open("contracts_ending") },
            { label: "Vencidos", value: n(k.contracts.expired), onClick: () => open("contracts_expired"), tone: k.contracts.expired > 0 ? "danger" : undefined },
            { label: "Cancelados", value: n(k.contracts.by_status.cancelled), onClick: () => open("contracts_status", "cancelled") }]} note={k.contracts.basis} />
          <Group title="Tempo de resolução das pendências" when="periodo" rows={[
            { label: "Média", value: k.resolution.available ? fmtHours(k.resolution.value) : <Unavailable m={k.resolution} /> },
            ...(k.resolution.available ? [{ label: "Mediana", value: fmtHours(k.resolution.median_hours) }, { label: "Pendências concluídas no período", value: n(k.resolution.n), onClick: () => open("resolved_pendencies") }] : [])]} note={k.resolution.available ? k.resolution.basis : undefined} />
          <Group title="Integração de profissionais" when="hoje" rows={[
            { label: "Aptos a atender (requisitos concluídos)", value: `${n(k.professionals.ready)} de ${n(k.professionals.active)} (${pct(k.professionals.ready_pct)})`, onClick: () => open("professionals_ready") },
            { label: "Tempo médio de integração", value: k.onboarding.available ? `${String(k.onboarding.value).replace(".", ",")} dias` : <Unavailable m={k.onboarding} /> },
            ...(k.onboarding.available ? [{ label: "Mediana", value: `${String(k.onboarding.median_days).replace(".", ",")} dias (n=${k.onboarding.n})` }] : [])]}
            note={`${k.professionals.basis}${k.onboarding.available ? ` ${k.onboarding.basis}` : ""}`} />
          <Group title="Solicitações de agendamento" when="hoje" rows={k.waiting.available ? [
            { label: "Pacientes aguardando", value: n(k.waiting.n), onClick: () => open("patients_waiting") },
            { label: "Tempo médio de espera", value: `${String(k.waiting.avg_days).replace(".", ",")} dias` }, { label: "Mediana", value: `${String(k.waiting.median_days).replace(".", ",")} dias` },
            { label: "Mais antiga", value: `${String(k.waiting.max_days).replace(".", ",")} dias` }, { label: `Acima de ${k.waiting.alert_days} dias`, value: n(k.waiting.over_alert), tone: (k.waiting.over_alert ?? 0) > 0 ? "danger" : undefined }]
            : [{ label: "Pacientes aguardando", value: "0" }, { label: "Tempo de espera", value: <Unavailable m={{ value: null, available: false, basis: k.waiting.basis }} /> }]}
            note={k.waiting.available ? k.waiting.basis : "Só conta quem tem uma solicitação registrada (lista de espera da Agenda); pessoa sem consulta e sem solicitação não entra."} />
          <Group title="Pacotes perto do fim" when="hoje" rows={[{ label: "Sem próximo atendimento agendado", value: n(k.packages.n), onClick: () => open("packages_ending"), tone: k.packages.n > 0 ? "danger" : undefined }]} note={k.packages.basis} />
          <Group title="Convites e acessos" when="hoje" rows={[
            { label: "Convites pendentes (válidos)", value: n(k.access.invitations_pending), onClick: () => open("invitations_pending") },
            { label: "Convites expirados não aceitos", value: n(k.access.invitations_expired), onClick: () => open("invitations_expired"), tone: k.access.invitations_expired > 0 ? "danger" : undefined },
            { label: "Acessos que precisam de revisão", value: n(k.access.review), onClick: () => open("access_review"), tone: k.access.review > 0 ? "danger" : undefined }]} note={k.access.basis} />
          <Group title="Pendências por situação" when="periodo" rows={[
            { label: "Abertas", value: n(k.pendencies.open), onClick: () => open("open_pendencies") },
            { label: "Atrasadas", value: n(k.pendencies.overdue), onClick: () => open("overdue_pendencies"), tone: k.pendencies.overdue > 0 ? "danger" : undefined },
            { label: "Concluídas no período", value: n(k.pendencies.resolved_period), onClick: () => open("resolved_pendencies") }]} note={k.pendencies.basis} />
        </div>
      </LevelSection>

      <LevelSection level="analysis" title="Gráficos e evolução" hint="Evolução, tempos e distribuição; clique numa barra para abrir os registros." label="Gráficos das pendências">
        <div className="grid gap-4 lg:grid-cols-2">
        <LineBlock title="Evolução de pendências abertas e concluídas" hint={d.evolution_basis} data={evo} xKey="semana" series={[{ key: "Abertas", label: "Abertas na semana" }, { key: "Concluídas", label: "Concluídas na semana" }, { key: "Em aberto ao fim", label: "Em aberto ao fim da semana" }]} empty="Ainda não há pendências registradas no período." />
        <BarBlock title="Tempo de resolução por tipo" hint="Média e mediana, em horas, das pendências concluídas no período (por tipo)." data={k.resolution_by_kind.map((r) => ({ tipo: PEND_KIND[r.kind] ?? r.kind, "Média (h)": r.avg_hours, "Mediana (h)": r.median_hours }))} xKey="tipo"
          series={[{ key: "Média (h)", label: "Média (h)" }, { key: "Mediana (h)", label: "Mediana (h)" }]} empty="Nenhuma pendência concluída no período — ainda não há base para calcular." />
        <BarBlock title="Pendências por responsável" hint="Abertas, atrasadas e concluídas no período. Clique numa barra para ver as abertas do responsável." data={k.by_owner.map((r) => ({ nome: r.name, id: r.user_id, Abertas: r.open, Atrasadas: r.overdue, Concluídas: r.resolved }))} xKey="nome"
          series={[{ key: "Abertas", label: "Abertas" }, { key: "Atrasadas", label: "Atrasadas", color: "hsl(var(--destructive))" }, { key: "Concluídas", label: "Concluídas", color: "hsl(var(--success))" }]}
          onBarClick={(r) => { if (r.id) onOpen({ rpc: "adm_central_detail", title: `Pendências abertas de ${r.nome}`, params: { p_kind: "open_pendencies", p_value: null, p_from: from, p_to: to, p_unit: unit || null, p_owner: r.id, p_type: filters.type || null, p_kind_filter: filters.kind || null, p_status: null }, scope: unitName }); }} empty="Nenhuma pendência registrada." />
        <BarBlock title="Pendências por unidade" hint="Abertas, atrasadas e concluídas no período." data={k.by_unit.map((r) => ({ unidade: r.name, Abertas: r.open, Atrasadas: r.overdue, Concluídas: r.resolved }))} xKey="unidade"
          series={[{ key: "Abertas", label: "Abertas" }, { key: "Atrasadas", label: "Atrasadas", color: "hsl(var(--destructive))" }, { key: "Concluídas", label: "Concluídas", color: "hsl(var(--success))" }]} empty="Nenhuma pendência registrada." />
          {cadastroAnalise}
        </div>
        {mapa}
      </LevelSection>

      <section aria-label="Lista de prioridades">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="text-xl">Lista de prioridades</h2>
          <Link to="/admin/adm/pendencias" className="text-sm text-accent hover:underline">Gerenciar todas as pendências</Link>
        </div>
        <State loading={prio.isLoading} error={prio.error} empty={prio.data?.length === 0} emptyText="Nenhuma pendência aberta. Use “Gerenciar pendências” para registrar uma ou rode a sincronização para detectar problemas." />
        {prio.data && prio.data.length > 0 && (
          <Table head={["Registro", "Motivo", "Responsável", "Prazo", "Ação"]}>
            {prio.data.map((p) => { const route = subjectRoute(p.subject_type, p.subject_name);
              return (<tr key={p.id}>
                <Td><span className="font-medium">{p.subject_name ?? "—"}</span><span className="block text-xs text-muted-foreground">{PEND_KIND[p.kind] ?? p.kind}{p.unit_name ? ` · ${p.unit_name}` : ""}</span></Td>
                <Td>{p.title}{p.origin === "auto" && <span className="block text-[11px] text-muted-foreground">detectada automaticamente</span>}</Td>
                <Td>{p.responsible_name ?? <span className="text-muted-foreground">Sem responsável</span>}</Td>
                <Td>{p.due_date ? <span className={p.overdue ? "text-destructive font-medium" : ""}>{fmtDate(`${p.due_date}T12:00:00Z`)}{p.overdue && ` (${p.overdue_days} d atraso)`}</span> : "—"}</Td>
                <Td><span className="flex flex-wrap gap-1.5"><button type="button" className={`${btnGhost} hp-btn-sm`} onClick={() => resolve(p.id)}>Concluir</button>{route && <Link className={`${btnGhost} hp-btn-sm`} to={route}>Abrir</Link>}</span></Td>
              </tr>); })}
          </Table>)}
      </section>
    </div>
  );
};

export default AdmCentral;
