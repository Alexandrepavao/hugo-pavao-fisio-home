import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, LayoutDashboard, LifeBuoy, Settings, ShieldCheck, Sparkles, UserCheck, Users, Wallet } from "lucide-react";
import { weekdayOf } from "./seed";
import { addDays, brl, brl0, fmtDay, fmtDayLong, fmtTime, patientById, protocolOf, useDemo } from "./store";
import type { ApptStatus, Demo, Representation, Ticket } from "./types";
import { PERIOD_ADMIN, adm, canReopen, clinicBuckets, clinicPatients, continuityOf, physioName, revenueOf, slaOf, teamOf, ticketsAttention, ticketsOpen, type ClinicPatient } from "./admin-logic";
import { ApptBadge } from "./patient";
import { KIND, PHASE, PatientFile } from "./physio";
import { AlertBox, Avatar, Badge, Btn, Empty, Field, Group, Indicator, NavHost, Page, Progress, Row, Segmented, Sheet, Switch, TabBar, useNav, type Screen } from "./ui";
import { useShell } from "./shell-context";

const short = (n: string) => n.replace(/^(Dr\.|Dra\.)\s*/, "");
const toCents = (v: string) => { const n = Number(v.replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
const reais = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const inWin = (d: Demo, day: string, days = 30) => day >= addDays(d.anchor, -(days - 1)) && day <= d.anchor;
const FlagsC = ({ p }: { p: ClinicPatient }) => <>{p.flags.evolution > 0 && <Badge tone="warn">Evolução pendente</Badge>} {p.flags.reassessment > 0 && <Badge tone="bad">Reavaliação</Badge>} {p.flags.feedback > 0 && <Badge tone="info">Feedback sem resposta</Badge>}</>;
const SLA_TONE = { no_prazo: "ok", escalado: "warn", vencido: "bad", ok: "ok", fora: "warn" } as const;

// ---------------------------------------------------------------- PAINEL
const Painel = () => {
  const d = useDemo(); const nav = useNav(); const team = teamOf(d); const cp = clinicPatients(d); const active = cp.filter((p) => p.phase !== "concluido"); const rev = revenueOf(d); const b = clinicBuckets(d); const cont = continuityOf(d);
  const sessions = team.reduce((s, t) => s + t.sessions30, 0); const lostW = sessions ? Math.round(team.reduce((s, t) => s + t.sessions30 * t.noShowPct, 0) / sessions) : 0; const adh = active.length ? Math.round(active.reduce((s, p) => s + p.adherencePct, 0) / active.length) : 0;
  const open = ticketsOpen(d); const att = ticketsAttention(d); const reav = cp.filter((p) => p.flags.reassessment > 0); const evo = cp.reduce((s, p) => s + p.flags.evolution, 0); const repPend = d.admin.representations.filter((r) => r.status === "pendente");
  const attention: { key: string; title: string; sub: string; go: () => void }[] = [
    ...(att.length ? [{ key: "tk", title: `${att.length} chamado(s) com prazo em risco`, sub: "SLA de 24 h: escalados (12 h) ou vencidos", go: () => nav.push({ id: "chamados" }) }] : []),
    ...(b.apurado > 0 ? [{ key: "ap", title: `${brl(b.apurado)} em repasses aguardando autorização`, sub: "Sessões realizadas e apuradas", go: () => nav.setTab("financeiro") }] : []),
    ...(b.liberado > 0 ? [{ key: "lb", title: `${brl(b.liberado)} liberados, a pagar`, sub: "Já autorizados e ainda não pagos", go: () => nav.setTab("financeiro") }] : []),
    ...(reav.length ? [{ key: "rv", title: `${reav.length} reavaliação(ões) pendente(s)`, sub: reav.map((p) => p.name.split(" ")[0]).join(", "), go: () => nav.setTab("pacientes") }] : []),
    ...(evo ? [{ key: "ev", title: `${evo} evolução(ões) por registrar`, sub: "Atendimentos realizados sem evolução", go: () => nav.setTab("pacientes") }] : []),
    ...(repPend.length ? [{ key: "rp", title: `${repPend.length} responsável(is) a verificar`, sub: "Só a administração verifica", go: () => nav.push({ id: "responsaveis" }) }] : []),
  ];
  return (
    <Page title="Painel" back={false}>
      <div className="ios-gap">
        <p className="ios-dim" style={{ marginTop: -8 }}>{d.admin.name} · {fmtDayLong(d.anchor)}</p>
        <div className="ios-grid2" data-testid="admin-kpis">
          <Indicator label="Receita contratada" value={brl0(rev.total)} sub={`${rev.rows.length} vendas · ${brl(rev.pending)} a receber`} period={PERIOD_ADMIN} definition="Valor final de venda dos protocolos contratados no período (preço cadastrado pela administração). Venda pendente ainda não é dinheiro recebido." rows={rev.rows.map((s) => ({ title: `${fmtDay(s.date)} · ${s.patientName}`, sub: `${d.protocols.find((p) => p.id === s.protocolId)?.name} · ${short(physioName(d, s.physioId))}`, right: `${brl(s.cents)}${s.status === "pendente" ? " (pend.)" : ""}` }))} />
          <Indicator label="Atendimentos realizados" value={String(sessions)} sub="na clínica toda" period={PERIOD_ADMIN} definition="Atendimentos com status realizado, registrados pelos fisioterapeutas, no período." rows={team.map((t) => ({ title: t.name, sub: t.specialty, right: String(t.sessions30) }))} />
          <Indicator label="Pacientes ativos" value={String(active.length)} sub={`${cp.length} cadastrados`} period="Situação atual" definition="Pacientes cujo acompanhamento ainda não foi concluído." rows={active.map((p) => ({ title: p.name, sub: `${d.protocols.find((x) => x.id === p.protocolId)?.name} · ${short(physioName(d, p.physioId))}`, right: PHASE[p.phase][0] }))} />
          <Indicator label="Faltas e cancel. tardios" value={`${lostW}%`} sub="média ponderada" tone={lostW > 10 ? "warn" : undefined} period={PERIOD_ADMIN} definition="Faltas do paciente + cancelamentos com menos de 24 h ÷ (realizados + faltas + cancelamentos tardios), por fisioterapeuta, ponderado pelo volume de atendimentos." rows={team.map((t) => ({ title: t.name, sub: `${t.sessions30} realizados`, right: `${t.noShowPct}%` }))} />
          <Indicator label="Adesão declarada" value={`${adh}%`} sub="média dos ativos" period="Últimos 14 dias" definition="Média dos dias com ao menos um exercício declarado pelo paciente (concluído ou parcial). Autodeclaração: mede constância, não resultado clínico." rows={active.map((p) => ({ title: p.name, sub: short(physioName(d, p.physioId)), right: `${p.adherencePct}%` }))} />
          <Indicator label="Continuidade (LTV)" value={`${cont.pct}%`} sub={`${cont.recommended} recomendação · ${cont.interested} interesse`} period="Situação atual" definition="Pacientes concluídos para os quais o fisioterapeuta registrou uma recomendação de continuidade. “Interesse” é o paciente pedir informações; não é venda." rows={cp.filter((p) => p.phase === "concluido").map((p) => { const r = d.recommendations.find((x) => x.patientId === p.id); return { title: p.name, sub: r ? r.protocolName : "Sem recomendação", right: r ? (r.interested ? "Interesse" : "Recomendado") : "—" }; })} />
          <Indicator label="Chamados abertos" value={String(open.length)} sub={`${att.length} com prazo em risco`} tone={att.length ? "bad" : "ok"} period="Situação atual" definition="Chamados sem resposta da equipe. SLA de 24 h (corridas no clínico, úteis no administrativo); escalada com 12 h." rows={open.map((t) => ({ title: `${t.patientName} · ${t.subject}`, sub: t.kind === "clinico" ? "Clínico" : "Administrativo", right: slaOf(t).label }))} />
          <Indicator label="Repasses a pagar" value={brl0(b.apurado + b.liberado)} sub={`${brl(b.liberado)} já liberados`} period="Situação atual" definition="Valores apurados (aguardando autorização) + liberados (aguardando pagamento), somando todos os fisioterapeutas." rows={team.map((t) => ({ title: t.name, sub: `apurado ${brl(t.buckets.apurado)} · liberado ${brl(t.buckets.liberado)}`, right: brl(t.buckets.apurado + t.buckets.liberado) }))} />
        </div>
        <Group title="Atenção agora">{attention.length === 0 ? <Row title="Tudo em dia" left={<ShieldCheck size={18} color="var(--success)" aria-hidden />} /> : attention.map((a) => <Row key={a.key} onClick={a.go} title={a.title} sub={a.sub} />)}</Group>
        <p className="ios-dim ios-small">Números da demonstração: o Dr. Rafael e os pacientes dele são os mesmos dos outros apps; o restante da clínica é fictício, de apoio.</p>
      </div>
    </Page>
  );
};

// ---------------------------------------------------------------- PACIENTES
const Pacientes = () => {
  const d = useDemo(); const nav = useNav(); const [q, setQ] = useState(""); const [fis, setFis] = useState("todos"); const [phase, setPhase] = useState("todas");
  const all = clinicPatients(d); const list = all.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) && (fis === "todos" || p.physioId === fis) && (phase === "todas" || p.phase === phase));
  return (
    <Page title="Pacientes" back={false}>
      <div className="ios-gap">
        <div className="ios-grid2">
          <Indicator label="Reavaliações pendentes" value={String(all.filter((p) => p.flags.reassessment > 0).length)} tone="warn" sub="aguardam decisão do fisio" period="Situação atual" definition="Pacientes em fase de reavaliação: o próximo passo (concluir, manter ou recomendar) é decisão clínica do fisioterapeuta." rows={all.filter((p) => p.flags.reassessment > 0).map((p) => ({ title: p.name, sub: short(physioName(d, p.physioId)) }))} />
          <Indicator label="Evoluções por registrar" value={String(all.reduce((s, p) => s + p.flags.evolution, 0))} sub="atendimentos sem evolução" period="Situação atual" definition="Atendimentos realizados (últimos 14 dias) sem evolução registrada pelo fisioterapeuta." rows={all.filter((p) => p.flags.evolution > 0).map((p) => ({ title: p.name, sub: short(physioName(d, p.physioId)), right: String(p.flags.evolution) }))} />
        </div>
        <input className="ios-field" placeholder="Buscar paciente" aria-label="Buscar paciente" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="ios-chips" role="group" aria-label="Filtrar por fisioterapeuta">{[["todos", "Todos os fisios"], ...d.admin.team.map((t) => [t.id, short(t.name)])].map(([id, l]) => <button key={id} className="ios-chip" aria-pressed={fis === id} onClick={() => setFis(id)}>{l}</button>)}</div>
        <div className="ios-chips" role="group" aria-label="Filtrar por fase">{[["todas", "Todas as fases"], ["avaliacao", "Avaliação"], ["tratamento", "Tratamento"], ["reavaliacao", "Reavaliação"], ["concluido", "Concluído"]].map(([id, l]) => <button key={id} className="ios-chip" aria-pressed={phase === id} onClick={() => setPhase(id)}>{l}</button>)}</div>
        <Group foot={`${list.length} paciente(s). Leitura clínica pelo gestor é somente leitura e fica registrada.`}>{list.length === 0 ? <Row title="Nenhum paciente com esses filtros" /> : list.map((p) => <Row key={p.id} onClick={() => nav.push({ id: p.live ? "paciente" : "paciente-lite", params: { id: p.id } })} left={<Avatar name={p.name} hue={p.hue} size={42} />} title={p.name} sub={<><span>{d.protocols.find((x) => x.id === p.protocolId)?.name} · {short(physioName(d, p.physioId))} · {PHASE[p.phase][0]}</span><br /><FlagsC p={p} /></>} />)}</Group>
      </div>
    </Page>
  );
};
const AdminPatient = ({ id }: { id: string }) => {
  const d = useDemo(); const p = patientById(d, id);
  useEffect(() => { adm.logAccess(id, p.name); }, [id, p.name]);
  return <PatientFile id={id} readOnly banner={<div className="ios-card ios-card-pad" style={{ borderLeft: "4px solid var(--accent)" }} data-testid="admin-read-banner"><p className="ios-small ios-dim" style={{ fontWeight: 700 }}>LEITURA DO GESTOR · SOMENTE LEITURA</p><p className="ios-small" style={{ marginTop: 2 }}>Este acesso ao prontuário foi <b>registrado</b> e o paciente pode ver quem acessou. Você vê também as notas internas; não altera rotina, evolução nem reavaliação (decisões do fisioterapeuta).</p></div>} />;
};
const PatientLite = ({ id }: { id: string }) => {
  const d = useDemo(); const p = clinicPatients(d).find((x) => x.id === id)!; const pr = d.protocols.find((x) => x.id === p.protocolId);
  return (
    <Page title={p.name} large={false}>
      <div className="ios-gap">
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}><Avatar name={p.name} hue={p.hue} size={58} /><div><h1 className="ios-display" style={{ fontSize: 22, fontWeight: 800 }}>{p.name}</h1><p className="ios-dim ios-small">{p.age} anos · paciente {p.code} · {pr?.name}</p><div style={{ marginTop: 4 }}><Badge tone={PHASE[p.phase][1]}>{PHASE[p.phase][0]}</Badge> <FlagsC p={p} /></div></div></div>
        <div className="ios-card ios-card-pad"><p className="ios-small ios-dim" style={{ fontWeight: 700 }}>OBJETIVO DO PACIENTE</p><p className="ios-display" style={{ fontSize: 18, fontWeight: 800 }}>{p.goal}</p></div>
        <div className="ios-card ios-card-pad"><p style={{ fontWeight: 700 }}>Plano: {p.total} encontros · {physioName(d, p.physioId)}</p><Progress value={p.done} max={p.total} label="Encontros realizados" /><p className="ios-dim ios-small" style={{ marginTop: 6 }}>{p.done} realizados · adesão declarada {p.adherencePct}% (14 dias).</p></div>
        <p className="ios-dim ios-small">Paciente de apoio desta demonstração: a ficha clínica completa (medidas, evolução, treino e feedbacks) existe apenas para os pacientes do Dr. Rafael. No app real, o gestor lê qualquer ficha, sempre com registro de acesso.</p>
      </div>
    </Page>
  );
};

// ---------------------------------------------------------------- AGENDA
const weekStart = (day: string) => addDays(day, -((weekdayOf(day) + 6) % 7));
interface Row2 { id: string; physioId: string; name: string; code: string; at: string; durationMin: number; kind: keyof typeof KIND; status: ApptStatus; place: string; live: boolean; patientId?: string }
const allAppts = (d: Demo): Row2[] => [...d.appts.map((a): Row2 => ({ id: a.id, physioId: d.physio.id, name: patientById(d, a.patientId).name, code: patientById(d, a.patientId).code, at: a.at, durationMin: a.durationMin, kind: a.kind, status: a.status, place: a.place, live: true, patientId: a.patientId })), ...d.admin.extraAppts.map((a): Row2 => ({ id: a.id, physioId: a.physioId, name: a.patientName, code: a.patientCode, at: a.at, durationMin: a.durationMin, kind: a.kind, status: a.status, place: a.place, live: false }))];
const Agenda = () => {
  const d = useDemo(); const nav = useNav(); const [day, setDay] = useState(d.anchor); const [fis, setFis] = useState("todos"); const all = useMemo(() => allAppts(d), [d]);
  const dayRows = all.filter((a) => a.at.slice(0, 10) === day && (fis === "todos" || a.physioId === fis)).sort((x, y) => x.at.localeCompare(y.at));
  const ws = weekStart(d.anchor); const wk = Array.from({ length: 7 }, (_, i) => addDays(ws, i)); const BOOKED: ApptStatus[] = ["scheduled", "confirmed", "done"];
  const occ = d.admin.team.map((t) => { const rows = all.filter((a) => a.physioId === t.id && wk.includes(a.at.slice(0, 10)) && BOOKED.includes(a.status)); const min = rows.reduce((s, a) => s + a.durationMin, 0); return { t, rows, pct: Math.round((100 * min) / 2400) }; });
  const avg = Math.round(occ.reduce((s, o) => s + o.pct, 0) / occ.length); const lost = all.filter((a) => inWin(d, a.at.slice(0, 10)) && ["no_show", "cancelled", "cancelled_late"].includes(a.status));
  return (
    <Page title="Agenda" back={false}>
      <div className="ios-gap">
        <div className="ios-grid2">
          <Indicator label="Ocupação da agenda" value={`${avg}%`} sub="média da semana" period={`Semana de ${fmtDay(ws)}`} definition="Minutos de atendimento marcados (agendados, confirmados ou realizados) ÷ 40 h semanais de disponibilidade de referência por fisioterapeuta (demonstração)." rows={occ.map((o) => ({ title: o.t.name, sub: `${o.rows.length} atendimentos na semana`, right: `${o.pct}%` }))} />
          <Indicator label="Faltas e cancelamentos" value={String(lost.length)} sub="últimos 30 dias" tone={lost.length > 4 ? "warn" : undefined} period={PERIOD_ADMIN} definition="Atendimentos com falta, cancelamento ou cancelamento tardio, na clínica toda." rows={lost.sort((a, b) => b.at.localeCompare(a.at)).map((a) => ({ title: `${fmtDay(a.at)} · ${a.name}`, sub: short(physioName(d, a.physioId)), right: a.status === "no_show" ? "Falta" : a.status === "cancelled" ? "Cancelado" : "Cancel. tardio" }))} />
        </div>
        <div className="ios-chips" role="group" aria-label="Filtrar por fisioterapeuta">{[["todos", "Todos os fisios"], ...d.admin.team.map((t) => [t.id, short(t.name)])].map(([id, l]) => <button key={id} className="ios-chip" aria-pressed={fis === id} onClick={() => setFis(id)}>{l}</button>)}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><button className="ios-bar-btn" aria-label="Dia anterior" onClick={() => setDay(addDays(day, -1))}><ChevronLeft /></button><b data-testid="day-title">{fmtDayLong(day)}{day === d.anchor ? " · hoje" : ""}</b><button className="ios-bar-btn" aria-label="Próximo dia" onClick={() => setDay(addDays(day, 1))}><ChevronRight /></button></div>
        <Group foot="Atendimentos do Dr. Rafael são os mesmos do app dele; os demais fisioterapeutas são fictícios.">{dayRows.length === 0 ? <Row title="Sem atendimentos neste dia" /> : dayRows.map((a) => <Row key={a.id} onClick={a.live ? () => nav.push({ id: "paciente", params: { id: a.patientId! } }) : undefined} left={<div style={{ width: 48, textAlign: "center", flex: "none" }}><p className="ios-display" style={{ fontWeight: 800 }}>{fmtTime(a.at)}</p><p className="ios-dim" style={{ fontSize: 11 }}>{a.durationMin} min</p></div>} title={a.name} sub={`${KIND[a.kind]} · ${a.place} · ${short(physioName(d, a.physioId))}`} right={<ApptBadge s={a.status} />} />)}</Group>
      </div>
    </Page>
  );
};
const AdminAppt = ({ id }: { id: string }) => {
  const d = useDemo(); const nav = useNav(); const a = d.appts.find((x) => x.id === id)!; const p = patientById(d, a.patientId);
  return <Page title="Atendimento" large={false}><div className="ios-gap"><div className="ios-card ios-card-pad"><h1 className="ios-display" style={{ fontSize: 22 }}>{fmtDayLong(a.at)} · {fmtTime(a.at)}</h1><p className="ios-dim">{KIND[a.kind]} · {a.place} · {a.durationMin} min</p><div style={{ marginTop: 8 }}><ApptBadge s={a.status} /></div></div><Group><Row onClick={() => nav.push({ id: "paciente", params: { id: p.id } })} left={<Avatar name={p.name} hue={p.hue} size={40} />} title={p.name} sub={protocolOf(d, p).name} /></Group><p className="ios-dim ios-small">Registrar atendimento realizado, falta e evolução é do fisioterapeuta; aqui a administração só acompanha.</p></div></Page>;
};

// ---------------------------------------------------------------- FINANCEIRO
const Financeiro = () => {
  const d = useDemo(); const nav = useNav(); const team = teamOf(d); const b = clinicBuckets(d); const rev = revenueOf(d); const [prod, setProd] = useState<string | null>(null); const [confirm, setConfirm] = useState(false); const [price, setPrice] = useState(""); const [share, setShare] = useState("");
  const pr = d.protocols.find((p) => p.id === prod); const rule = d.admin.rules.find((r) => r.protocolId === prod);
  const openProd = (id: string) => { const p = d.protocols.find((x) => x.id === id)!; setPrice(reais(p.priceCents)); setShare(reais(d.admin.rules.find((r) => r.protocolId === id)!.shareCents)); setProd(id); };
  const okPrice = toCents(price) > 0 && toCents(share) >= 0 && toCents(share) <= toCents(price);
  const rows = (k: "apurado" | "liberado" | "pago") => team.map((t) => ({ title: t.name, sub: t.specialty, right: brl(t.buckets[k]) }));
  return (
    <Page title="Financeiro" back={false}>
      <div className="ios-gap">
        <div className="ios-hero"><p style={{ fontSize: 12, fontWeight: 700, opacity: .8, textTransform: "uppercase", letterSpacing: ".05em" }}>Receita contratada · {PERIOD_ADMIN}</p><p className="ios-display" style={{ fontSize: 32, fontWeight: 800, marginTop: 2 }} data-testid="admin-revenue">{brl(rev.total)}</p><p style={{ opacity: .85, fontSize: 13 }}>{brl(rev.paid)} recebidos · {brl(rev.pending)} a receber · ticket médio {brl(rev.ticket)}</p></div>
        <p className="ios-dim ios-small">Repasses por fisioterapeuta, em quatro situações separadas. <b>Agendado não é dinheiro recebido</b> e “apurado” ainda não foi autorizado.</p>
        <div className="ios-grid2" data-testid="admin-buckets">
          <Indicator label="Apurados" value={brl0(b.apurado)} sub="aguardam autorização" tone={b.apurado ? "warn" : undefined} period="Situação atual" definition="Sessões realizadas e elegíveis (pacote pago) que ainda não foram autorizadas pela administração. Inclui ajustes e estornos nesta situação." rows={rows("apurado")} />
          <Indicator label="Liberados" value={brl0(b.liberado)} sub="autorizados, a pagar" period="Situação atual" definition="Valores já autorizados pela administração e ainda não pagos ao fisioterapeuta." rows={rows("liberado")} />
          <Indicator label="Pagos" value={brl0(b.pago)} sub="já repassados" tone="ok" period="Situação atual" definition="Valores já pagos aos fisioterapeutas." rows={rows("pago")} />
          <Indicator label="A receber (vendas)" value={brl0(rev.pending)} sub="vendas pendentes" period={PERIOD_ADMIN} definition="Vendas de protocolos com pagamento ainda pendente. Sessão de pacote não pago não gera repasse." rows={rev.rows.filter((s) => s.status === "pendente").map((s) => ({ title: `${fmtDay(s.date)} · ${s.patientName}`, sub: d.protocols.find((p) => p.id === s.protocolId)?.name, right: brl(s.cents) }))} />
        </div>
        <Group title="Repasses por fisioterapeuta" foot="Toque para autorizar, pagar, lançar ajuste ou estorno. O que você faz aparece em “Ganhos” no app do fisioterapeuta.">{team.map((t) => <Row key={t.id} onClick={() => nav.push({ id: "fin-fisio", params: { id: t.id } })} left={<Avatar name={t.name} hue={t.hue} size={40} />} title={t.name} sub={`apurado ${brl(t.buckets.apurado)} · liberado ${brl(t.buckets.liberado)} · pago ${brl(t.buckets.pago)}`} right={<b className="ios-small">{brl(t.buckets.apurado + t.buckets.liberado + t.buckets.pago)}</b>} />)}</Group>
        <Group title="Preços e repasses por produto" foot="Preço cadastrado = valor FINAL de venda. O repasse por sessão é igual para todos os fisioterapeutas, definido por produto e congelado em cada lançamento.">{d.protocols.map((p) => <Row key={p.id} onClick={() => openProd(p.id)} left={<ClipboardList size={18} aria-hidden />} title={p.name} sub={`${p.totalSessions} encontros · venda ${brl(p.priceCents)} · repasse ${brl(d.admin.rules.find((r) => r.protocolId === p.id)!.shareCents)} por sessão`} />)}</Group>
        <Group title="Vendas recentes">{[...d.admin.sales].sort((a, b2) => b2.date.localeCompare(a.date)).map((s) => <Row key={s.id} title={s.patientName} sub={`${fmtDay(s.date)} · ${d.protocols.find((p) => p.id === s.protocolId)?.name} · ${short(physioName(d, s.physioId))}`} right={<><b className="ios-small">{brl(s.cents)}</b> <Badge tone={s.status === "pago" ? "ok" : "warn"}>{s.status === "pago" ? "Pago" : "Pendente"}</Badge></>} />)}</Group>
      </div>
      <Sheet open={!!prod && !confirm} onClose={() => setProd(null)} title={pr ? `Preço e repasse · ${pr.name}` : "Produto"}>
        {pr && rule && <div data-testid="product-form"><Field id="pp-price" label="Preço final de venda (R$)" value={price} onChange={setPrice} /><Field id="pp-share" label="Repasse por sessão atendida (R$)" value={share} onChange={setShare} />
          <p className="ios-dim ios-small" style={{ marginTop: 8 }}>O repasse vale para as sessões lançadas <b>daqui para frente</b>; as já lançadas ficam congeladas. É igual para todos os fisioterapeutas.</p>
          <div style={{ marginTop: 14 }}><Btn disabled={!okPrice} onClick={() => setConfirm(true)}>Revisar e salvar</Btn></div>{!okPrice && <p className="ios-small" style={{ color: "var(--danger)", marginTop: 6 }}>Informe valores válidos; o repasse não pode passar do preço.</p>}</div>}
      </Sheet>
      <AlertBox open={confirm} title="Confirmar alteração?" message={pr ? `${pr.name}: venda ${brl(toCents(price))} e repasse ${brl(toCents(share))} por sessão. Decisão da administração; só vale para vendas e sessões daqui para frente.` : ""} actions={[{ label: "Voltar", onClick: () => setConfirm(false) }, { label: "Confirmar", onClick: () => { adm.setPrice(prod!, toCents(price)); adm.setShare(prod!, toCents(share)); setConfirm(false); setProd(null); nav.toast("Preço e repasse atualizados."); } }]} />
    </Page>
  );
};
const FinFisio = ({ id }: { id: string }) => {
  const d = useDemo(); const nav = useNav(); const t = teamOf(d).find((x) => x.id === id)!; const [ask, setAsk] = useState<null | "auth" | "pay">(null); const [sheet, setSheet] = useState<null | "adj">(null); const [sign, setSign] = useState<"1" | "-1">("1"); const [val, setVal] = useState(""); const [why, setWhy] = useState(""); const [voidId, setVoidId] = useState<string | null>(null); const [vWhy, setVWhy] = useState("");
  const pays = d.payouts.slice().sort((a, b) => b.date.localeCompare(a.date)); const po = d.payouts.find((p) => p.id === voidId);
  const cents = toCents(val);
  return (
    <Page title={t.name} large={false}>
      <div className="ios-gap" data-testid="fin-fisio">
        <div className="ios-grid2" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>{([["Apurado", t.buckets.apurado], ["Liberado", t.buckets.liberado], ["Pago", t.buckets.pago]] as const).map(([l, v]) => <div key={l} className="ios-kpi" style={{ cursor: "default" }}><div className="l">{l}</div><div className="v" style={{ fontSize: 17 }}>{brl(v)}</div></div>)}</div>
        <Btn disabled={t.buckets.apurado <= 0} onClick={() => setAsk("auth")}>Autorizar apurados ({brl(Math.max(0, t.buckets.apurado))})</Btn>
        <Btn variant="secondary" disabled={t.buckets.liberado <= 0} onClick={() => setAsk("pay")}>Marcar liberados como pagos ({brl(t.buckets.liberado)})</Btn>
        <Btn variant="plain" onClick={() => { setVal(""); setWhy(""); setSign("1"); setSheet("adj"); }}>Lançar ajuste ou estorno</Btn>
        {t.live ? <Group title="Lançamentos" foot="Toque em uma sessão ainda não paga para estornar (cria um lançamento negativo; nada é apagado).">{pays.map((p) => { const a = d.appts.find((x) => x.id === p.apptId); return <Row key={p.id} onClick={p.kind === "sessao" && p.state !== "pago" ? () => { setVWhy(""); setVoidId(p.id); } : undefined} title={p.kind === "sessao" && a ? `${fmtDay(p.date)} · ${KIND[a.kind]} · Paciente ${patientById(d, a.patientId).code}` : p.label} sub={`${fmtDay(p.date)} · ${p.kind === "sessao" ? "Sessão elegível" : p.kind === "estorno" ? "Estorno" : "Ajuste"}`} right={<><b style={{ color: p.cents < 0 ? "var(--danger)" : undefined }}>{brl(p.cents)}</b> <Badge tone={p.state === "pago" ? "ok" : p.state === "liberado" ? "info" : "warn"}>{p.state}</Badge></>} />; })}</Group>
          : <p className="ios-dim ios-small">Fisioterapeuta de apoio da demonstração: o detalhe por sessão existe apenas para o Dr. Rafael. Autorizar, pagar e ajustar funcionam nos totais.</p>}
      </div>
      <AlertBox open={ask === "auth"} title="Autorizar repasses apurados?" message={`${brl(t.buckets.apurado)} de ${t.name} passam de “apurado” para “liberado”. Ainda não é pagamento.`} actions={[{ label: "Voltar", onClick: () => setAsk(null) }, { label: "Autorizar", onClick: () => { adm.authorize(id); setAsk(null); nav.toast("Repasses autorizados."); } }]} />
      <AlertBox open={ask === "pay"} title="Marcar como pagos?" message={`${brl(t.buckets.liberado)} de ${t.name} passam para “pago”. Em produção isto registra o pagamento já feito fora do app.`} actions={[{ label: "Voltar", onClick: () => setAsk(null) }, { label: "Marcar como pagos", onClick: () => { adm.pay(id); setAsk(null); nav.toast("Pagamento registrado."); } }]} />
      <Sheet open={sheet === "adj"} onClose={() => setSheet(null)} title="Ajuste ou estorno"><div className="ios-gap"><Segmented label="Tipo de lançamento" value={sign} onChange={(v) => setSign(v as "1" | "-1")} options={[{ id: "1", label: "Ajuste (+)" }, { id: "-1", label: "Estorno (−)" }]} /><Field id="aj-val" label="Valor (R$)" value={val} onChange={setVal} placeholder="Ex.: 50,00" /><Field id="aj-why" label="Motivo (aparece para o fisioterapeuta)" value={why} onChange={setWhy} multiline /><Btn disabled={!(cents > 0) || why.trim().length < 5} onClick={() => { adm.adjust(id, Number(sign) * cents, why); setSheet(null); nav.toast("Lançamento registrado como apurado."); }}>Lançar</Btn></div></Sheet>
      <Sheet open={!!po} onClose={() => setVoidId(null)} title="Estornar sessão">{po && <div className="ios-gap"><p>Cria um estorno de <b>{brl(po.cents)}</b> na mesma situação ({po.state}). O fisioterapeuta vê o motivo.</p><Field id="vd-why" label="Motivo" value={vWhy} onChange={setVWhy} multiline /><Btn variant="danger" disabled={vWhy.trim().length < 5} onClick={() => { adm.voidPayout(po.id, vWhy); setVoidId(null); nav.toast("Estorno lançado."); }}>Estornar</Btn></div>}</Sheet>
    </Page>
  );
};

// ---------------------------------------------------------------- GESTÃO
const Gestao = () => {
  const d = useDemo(); const nav = useNav(); const sh = useShell(); const open = ticketsOpen(d); const att = ticketsAttention(d); const repPend = d.admin.representations.filter((r) => r.status === "pendente");
  return (
    <Page title="Gestão" back={false}>
      <div className="ios-gap">
        <div className="ios-card ios-card-pad" style={{ display: "flex", gap: 14, alignItems: "center" }}><div className="ios-avatar" style={{ width: 58, height: 58, background: "var(--primary)" }} aria-hidden><ShieldCheck size={28} /></div><div><p className="ios-display" style={{ fontSize: 19, fontWeight: 800 }}>{d.admin.name}</p><p className="ios-dim ios-small">Gestor (dono): lê dado clínico só em leitura, com registro</p><Badge tone="gold">Dados de demonstração</Badge></div></div>
        <Group title="Operação">
          <Row onClick={() => nav.push({ id: "chamados" })} left={<LifeBuoy size={18} aria-hidden />} title="Chamados" sub={`${open.length} aberto(s) · SLA de 24 h`} right={att.length ? <Badge tone="bad">{att.length} em risco</Badge> : undefined} />
          <Row onClick={() => nav.push({ id: "programas" })} left={<Sparkles size={18} aria-hidden />} title="Programas e ofertas" sub="Preços, quem pode receber, interesse dos pacientes" />
          <Row onClick={() => nav.push({ id: "responsaveis" })} left={<UserCheck size={18} aria-hidden />} title="Responsáveis e cuidadores" sub={`${repPend.length} a verificar`} right={repPend.length ? <Badge tone="warn">{repPend.length}</Badge> : undefined} />
          <Row onClick={() => nav.push({ id: "equipe" })} left={<Users size={18} aria-hidden />} title="Equipe" sub={`${d.admin.team.length} fisioterapeutas`} />
        </Group>
        <Group title="Privacidade e auditoria"><Row onClick={() => nav.push({ id: "acessos" })} left={<ShieldCheck size={18} aria-hidden />} title="Acessos ao prontuário" sub={`${d.admin.accessLog.length} registros · o paciente também os vê`} /></Group>
        <Group title="Ver o app como" foot="Mesma demonstração, outra visão. O que você mudar aqui aparece nos outros apps."><Row onClick={() => sh.setRole("patient")} left={<Avatar name="Marina Duarte" hue={330} size={34} />} title="Paciente" sub="Marina Duarte" /><Row onClick={() => sh.setRole("physio")} left={<Avatar name="Rafael Moreira" hue={205} size={34} />} title="Fisioterapeuta" sub="Dr. Rafael Moreira" /></Group>
        <Group title="Aparência e demonstração"><div className="ios-card-pad ios-gap"><Segmented label="Tema" value={sh.theme} onChange={(v) => sh.setTheme(v as never)} options={[{ id: "light", label: "Claro" }, { id: "dark", label: "Escuro" }]} /><Segmented label="Tamanho do texto" value={String(sh.textScale)} onChange={(v) => sh.setTextScale(Number(v))} options={[{ id: "1", label: "Padrão" }, { id: "1.15", label: "Maior" }, { id: "1.3", label: "Bem maior" }]} /><Btn variant="secondary" onClick={() => { sh.reset(); nav.toast("Demonstração restaurada."); }}>Restaurar demonstração</Btn><Btn variant="plain" onClick={sh.exit}>Sair da demonstração</Btn></div></Group>
      </div>
    </Page>
  );
};

const Chamados = () => {
  const d = useDemo(); const nav = useNav(); const [st, setSt] = useState<"aberto" | "respondido" | "fechado">("aberto"); const list = d.admin.tickets.filter((t) => t.status === st);
  return (
    <Page title="Chamados" large={false}>
      <div className="ios-gap">
        <Segmented label="Situação dos chamados" value={st} onChange={(v) => setSt(v as never)} options={[{ id: "aberto", label: `Abertos (${d.admin.tickets.filter((t) => t.status === "aberto").length})` }, { id: "respondido", label: "Respondidos" }, { id: "fechado", label: "Fechados" }]} />
        <Group foot="Só pacientes com pagamento confirmado abrem chamado. SLA de 24 h: clínico em horas corridas, administrativo em horas úteis (sem sábado e domingo). Escalada com 12 h.">{list.length === 0 ? <Row title="Nenhum chamado nesta situação" /> : list.map((t) => { const s = slaOf(t); return <Row key={t.id} onClick={() => nav.push({ id: "chamado", params: { id: t.id } })} title={`${t.patientName} · ${t.subject}`} sub={<><Badge tone={t.kind === "clinico" ? "info" : "gray"}>{t.kind === "clinico" ? "Clínico" : "Administrativo"}</Badge> <Badge tone={SLA_TONE[s.state]}>{s.label}</Badge></>} />; })}</Group>
      </div>
    </Page>
  );
};
const Chamado = ({ id }: { id: string }) => {
  const d = useDemo(); const nav = useNav(); const t = d.admin.tickets.find((x) => x.id === id) as Ticket; const [mode, setMode] = useState<"resposta" | "interna">("resposta"); const [txt, setTxt] = useState(""); const s = slaOf(t);
  return (
    <Page title="Chamado" large={false}>
      <div className="ios-gap" data-testid="ticket">
        <div className="ios-card ios-card-pad"><p className="ios-display" style={{ fontSize: 18, fontWeight: 800 }}>{t.subject}</p><p className="ios-dim ios-small">{t.patientName} · paciente {t.patientCode}</p><div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}><Badge tone={t.kind === "clinico" ? "info" : "gray"}>{t.kind === "clinico" ? "Clínico (24 h corridas)" : "Administrativo (24 h úteis)"}</Badge><Badge tone={SLA_TONE[s.state]}>{s.label}</Badge><Badge tone={t.status === "fechado" ? "gray" : t.status === "respondido" ? "ok" : "warn"}>{t.status}</Badge></div></div>
        <Group title="Conversa" foot={t.kind === "clinico" ? "Chamado clínico: lido só pelo gestor, com registro de acesso." : undefined}>{t.thread.map((m, i) => <Row key={i} title={m.text} sub={`${m.from === "paciente" ? "Paciente" : m.internal ? "Nota interna (o paciente NÃO vê)" : "Equipe HP"} · ${fmtDay(m.at)} ${fmtTime(m.at)}`} right={m.internal ? <Badge tone="gray">Interna</Badge> : undefined} />)}</Group>
        {t.status !== "fechado" && <div className="ios-card ios-card-pad"><Segmented label="Tipo de mensagem" value={mode} onChange={(v) => setMode(v as never)} options={[{ id: "resposta", label: "Responder ao paciente" }, { id: "interna", label: "Nota interna" }]} /><Field id="tk-txt" label={mode === "resposta" ? "Resposta (o paciente vê)" : "Nota interna (só a equipe)"} value={txt} onChange={setTxt} multiline /><div style={{ marginTop: 10 }}><Btn disabled={!txt.trim()} onClick={() => { adm.replyTicket(id, txt, mode === "interna"); setTxt(""); nav.toast(mode === "interna" ? "Nota interna salva." : t.patientId ? "Resposta enviada. A paciente já a vê em Perfil › Atendimento da equipe." : "Resposta registrada (demonstração)."); }}>{mode === "interna" ? "Salvar nota interna" : "Enviar resposta"}</Btn></div></div>}
        {t.status !== "fechado" && <Btn variant="secondary" onClick={() => { adm.closeTicket(id); nav.toast("Chamado fechado. Pode ser reaberto por 7 dias."); }}>Fechar chamado</Btn>}
        {t.status === "fechado" && (canReopen(d, t) ? <Btn variant="secondary" onClick={() => { adm.reopenTicket(id); nav.toast("Chamado reaberto."); }}>Reabrir (até 7 dias após o fechamento)</Btn> : <p className="ios-dim ios-small">Passaram mais de 7 dias do fechamento: abra um novo chamado.</p>)}
      </div>
    </Page>
  );
};

const Programas = () => {
  const d = useDemo(); const nav = useNav(); const cont = continuityOf(d); const [edit, setEdit] = useState<string | null>(null); const [price, setPrice] = useState(""); const [confirm, setConfirm] = useState(false); const pg = d.admin.programs.find((p) => p.id === edit);
  return (
    <Page title="Programas e ofertas" large={false}>
      <div className="ios-gap">
        <div className="ios-grid2"><Indicator label="Continuidade (LTV)" value={`${cont.pct}%`} sub={`${cont.recommended} de ${cont.concluded} concluídos`} period="Situação atual" definition="Concluídos com recomendação de continuidade registrada pelo fisioterapeuta ÷ pacientes concluídos." rows={d.recommendations.map((r) => ({ title: patientById(d, r.patientId).name, sub: r.protocolName, right: r.interested ? "Interesse" : "Recomendado" }))} />
          <Indicator label="Interesse registrado" value={String(cont.interested)} sub="pedidos de informação" period="Situação atual" definition="Pacientes que tocaram em “Tenho interesse”. Não é venda: a equipe comercial entra em contato." rows={d.recommendations.filter((r) => r.interested).map((r) => ({ title: patientById(d, r.patientId).name, sub: r.protocolName }))} /></div>
        {d.admin.programs.map((p) => <div key={p.id} className="ios-card ios-card-pad" data-testid="program-card"><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}><p className="ios-display" style={{ fontSize: 17, fontWeight: 800 }}>{p.name}</p><Switch checked={p.active} onChange={(v) => { adm.setProgram(p.id, { active: v }); nav.toast(v ? "Programa ativado." : "Programa desativado."); }} label={`Ativar ${p.name}`} /></div>
          <p className="ios-dim ios-small" style={{ marginTop: 2 }}>{p.sessions} encontros · {brl(p.priceCents)} · {p.status === "em_criacao" ? "em criação" : "ativo"}</p><p className="ios-small" style={{ marginTop: 4 }}>Público: {p.audience}</p>
          <div style={{ marginTop: 10 }}><Btn small variant="secondary" onClick={() => { setPrice(reais(p.priceCents)); setEdit(p.id); }}>Editar preço</Btn></div></div>)}
        <Group title="Interesse dos pacientes" foot="Recomendação é decisão clínica do fisioterapeuta; o fisioterapeuta não vende. Ofertas só com consentimento de comunicação comercial. “Tenho interesse” não cobra nada.">{d.recommendations.length === 0 ? <Row title="Nenhuma recomendação registrada" sub="Aparecem quando um fisioterapeuta recomenda continuidade na reavaliação." /> : d.recommendations.map((r) => <Row key={r.id} title={patientById(d, r.patientId).name} sub={`${r.protocolName} · ${r.reason}`} right={<Badge tone={r.interested ? "ok" : "gray"}>{r.interested ? "Interesse" : "Sem resposta"}</Badge>} />)}</Group>
      </div>
      <Sheet open={!!pg && !confirm} onClose={() => setEdit(null)} title={pg ? `Preço · ${pg.name}` : "Programa"}>{pg && <div><Field id="pg-price" label="Preço final (R$)" value={price} onChange={setPrice} /><div style={{ marginTop: 14 }}><Btn disabled={!(toCents(price) > 0)} onClick={() => setConfirm(true)}>Revisar e salvar</Btn></div></div>}</Sheet>
      <AlertBox open={confirm} title="Confirmar novo preço?" message={pg ? `${pg.name}: ${brl(toCents(price))}. Vale para novas ofertas; quem já contratou mantém o valor.` : ""} actions={[{ label: "Voltar", onClick: () => setConfirm(false) }, { label: "Confirmar", onClick: () => { adm.setProgram(edit!, { priceCents: toCents(price) }); setConfirm(false); setEdit(null); nav.toast("Preço atualizado."); } }]} />
    </Page>
  );
};

const REP_TONE = { pendente: "warn", verificado: "ok", suspenso: "bad", revogado: "gray" } as const;
const Responsaveis = () => {
  const d = useDemo(); const nav = useNav(); const [id, setId] = useState<string | null>(null); const r = d.admin.representations.find((x) => x.id === id) as Representation | undefined;
  const rule = (x: Representation) => x.patientAge < 12 ? "Criança com menos de 12 anos: não tem login; o responsável atua pelo paciente." : x.patientAge < 18 ? "Adolescente (12–17): o responsável só atua com autorização registrada." : "Maior de idade: o responsável legal cessa aos 18; cuidador/delegado só atua por delegação do próprio paciente.";
  return (
    <Page title="Responsáveis" large={false}>
      <div className="ios-gap">
        <Group foot="Só a administração verifica o vínculo. Suspensão (disputa) bloqueia a atuação do responsável sem apagar nada.">{d.admin.representations.map((x) => <Row key={x.id} onClick={() => setId(x.id)} title={`${x.responsible} → ${x.patientName}`} sub={`${x.relation} · ${x.patientAge} anos · ${x.docs} documento(s)`} right={<Badge tone={REP_TONE[x.status]}>{x.status}</Badge>} />)}</Group>
      </div>
      <Sheet open={!!r} onClose={() => setId(null)} title={r ? r.responsible : "Responsável"}>{r && <div className="ios-gap" data-testid="rep-sheet"><p><b>{r.relation}</b> de {r.patientName} ({r.patientAge} anos) · situação: <b>{r.status}</b></p><p className="ios-dim ios-small">{rule(r)}</p><p className="ios-dim ios-small">Documentos anexados: {r.docs}. O responsável não envia documento pelo app ainda; a administração anexa.</p>
        {r.status === "pendente" && <Btn disabled={r.docs === 0} onClick={() => { adm.setRep(r.id, "verificado"); nav.toast("Vínculo verificado."); }}>{r.docs === 0 ? "Anexe um documento para verificar" : "Verificar vínculo"}</Btn>}
        {r.status === "verificado" && <Btn variant="secondary" onClick={() => { adm.setRep(r.id, "suspenso"); nav.toast("Atuação suspensa."); }}>Suspender (disputa)</Btn>}
        {r.status === "suspenso" && <Btn onClick={() => { adm.setRep(r.id, "verificado"); nav.toast("Suspensão retirada."); }}>Retirar suspensão</Btn>}
        {r.status !== "revogado" && <Btn variant="danger" onClick={() => { adm.setRep(r.id, "revogado"); nav.toast("Vínculo revogado."); }}>Revogar vínculo</Btn>}</div>}</Sheet>
    </Page>
  );
};

const Equipe = () => {
  const d = useDemo(); const nav = useNav(); const team = teamOf(d); const [id, setId] = useState<string | null>(null); const t = team.find((x) => x.id === id);
  return (
    <Page title="Equipe" large={false}>
      <div className="ios-gap">
        <Group foot="Indicadores sem ranking público: cada fisioterapeuta vê só os próprios. Os do Dr. Rafael são calculados dos dados vivos.">{team.map((x) => <Row key={x.id} onClick={() => setId(x.id)} left={<Avatar name={x.name} hue={x.hue} size={42} />} title={x.name} sub={`${x.specialty} · ${x.patients} pacientes · ${x.sessions30} atendimentos`} right={x.pendingEvo ? <Badge tone="warn">{x.pendingEvo} evol.</Badge> : undefined} />)}</Group>
      </div>
      <Sheet open={!!t} onClose={() => setId(null)} title={t ? t.name : "Fisioterapeuta"}>{t && <div className="ios-gap"><p className="ios-dim ios-small">{t.specialty} · {t.council}</p>
        <div className="ios-grid2"><div className="ios-kpi" style={{ cursor: "default" }}><div className="l">Pacientes ativos</div><div className="v">{t.patients}</div></div><div className="ios-kpi" style={{ cursor: "default" }}><div className="l">Atendimentos (30 d)</div><div className="v">{t.sessions30}</div></div><div className="ios-kpi" style={{ cursor: "default" }}><div className="l">Faltas e cancel. tardios</div><div className="v">{t.noShowPct}%</div></div><div className="ios-kpi" style={{ cursor: "default" }}><div className="l">Adesão declarada</div><div className="v">{t.adherencePct}%</div></div></div>
        <Btn onClick={() => { setId(null); nav.push({ id: "fin-fisio", params: { id: t.id } }); }}><Wallet size={18} aria-hidden />Ver repasses de {short(t.name)}</Btn></div>}</Sheet>
    </Page>
  );
};

const Acessos = () => {
  const d = useDemo(); const rows = [...d.admin.accessLog].sort((a, b) => b.at.localeCompare(a.at));
  return <Page title="Acessos ao prontuário" large={false}><div className="ios-gap"><Group foot="Quem leu o quê, e quando. O paciente vê os acessos ao próprio prontuário no app dele (Perfil › Quem acessou meu prontuário).">{rows.length === 0 ? <Row title="Nenhum acesso" /> : rows.map((e) => <Row key={e.id} left={<ShieldCheck size={18} aria-hidden />} title={`${e.who} · ${e.patientName}`} sub={`${fmtDay(e.at)} ${fmtTime(e.at)} · ${e.what}`} />)}</Group></div></Page>;
};

export const AdminApp = () => {
  const d = useDemo(); const att = ticketsAttention(d).length; const sh = useShell();
  const render = (s: Screen) => { const id = s.params?.id ?? ""; switch (s.id) {
    case "paciente": return <AdminPatient key={id} id={id} />; case "paciente-lite": return <PatientLite key={id} id={id} />; case "appt": return <AdminAppt id={id} />;
    case "fin-fisio": return <FinFisio key={id} id={id} />; case "chamados": return <Chamados />; case "chamado": return <Chamado key={id} id={id} />; case "programas": return <Programas />; case "responsaveis": return <Responsaveis />; case "equipe": return <Equipe />; case "acessos": return <Acessos />;
    case "painel": return <Painel />; case "pacientes": return <Pacientes />; case "agenda": return <Agenda />; case "financeiro": return <Financeiro />; default: return <Gestao />; } };
  const items = [{ id: "painel", label: "Painel", icon: <LayoutDashboard size={24} aria-hidden /> }, { id: "pacientes", label: "Pacientes", icon: <Users size={24} aria-hidden /> }, { id: "agenda", label: "Agenda", icon: <CalendarDays size={24} aria-hidden /> }, { id: "financeiro", label: "Financeiro", icon: <Wallet size={24} aria-hidden /> }, { id: "gestao", label: "Gestão", icon: <Settings size={24} aria-hidden /> }];
  void sh; void Empty;
  return <NavHost tabs={items.map((i) => i.id)} initial="painel" render={render} renderTabBar={(t, set) => <TabBar items={items} active={t} onChange={set} badges={{ painel: att, gestao: att }} />} />;
};
