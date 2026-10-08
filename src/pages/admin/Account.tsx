import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, Settings } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { MY_ACCOUNT_KEY, shownName, useMyAccount } from "@/components/hp/useMyAccount";
import { ROLE_LABEL } from "@/components/hp/nav";
import { btnGhost, btnPrimary, errText, Msg, PageHead, State, useConfirm, useMsg } from "@/lib/ui";

const MIN_PASSWORD = 10;
const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

const Card = ({ title, hint, children, testid }: { title: string; hint?: string; children: ReactNode; testid?: string }) => (
  <section className="card-hp !p-5 mb-5 max-w-3xl" data-testid={testid}>
    <h3 className="text-base font-semibold text-foreground">{title}</h3>
    {hint && <p className="text-[13px] text-muted-foreground mt-0.5 mb-4">{hint}</p>}
    {!hint && <div className="mb-3" />}
    {children}
  </section>
);

/** Mensagens do Supabase Auth chegam em inglês: troca as conhecidas por texto claro. */
const authError = (message: string) => {
  const t = message.toLowerCase();
  if (t.includes("different from the old")) return "A nova senha precisa ser diferente da atual.";
  if (t.includes("at least") || t.includes("too short")) return `Use ao menos ${MIN_PASSWORD} caracteres.`;
  if (t.includes("weak") || t.includes("pwned") || t.includes("easy to guess")) return "Essa senha é fraca ou já apareceu em vazamentos. Escolha outra.";
  if (t.includes("reauth") || t.includes("recent")) return "Por segurança, saia e entre de novo antes de trocar a senha.";
  return "Não foi possível trocar a senha agora. Tente novamente.";
};

const Profile = () => {
  const qc = useQueryClient(); const { user } = useAuth(); const account = useMyAccount();
  const [msg, m] = useMsg(); const [name, setName] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { if (account.data) setName(shownName(account.data, user?.email)); }, [account.data, user?.email]);
  const current = shownName(account.data, user?.email);
  const save = async (e: FormEvent) => {
    e.preventDefault(); m.clear();
    if (name.trim().length < 2) return m.err("Informe um nome com ao menos 2 caracteres.");
    setBusy(true);
    const { error } = await supabase.rpc("my_account_update", { p_display_name: name });
    setBusy(false);
    if (error) return m.err(errText(error));
    m.ok("Nome atualizado."); void qc.invalidateQueries({ queryKey: [MY_ACCOUNT_KEY] });
  };
  return (
    <Card title="Perfil" hint="Como você aparece no sistema: no cabeçalho, na saudação, nas atribuições e nos históricos." testid="conta-perfil">
      <Msg m={msg} />
      <State loading={account.isLoading} error={account.error} />
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2 items-end" noValidate>
        <div><label htmlFor="ac-name" className="block text-xs mb-1">Nome de exibição</label>
          <input id="ac-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" /></div>
        <div><label htmlFor="ac-email" className="block text-xs mb-1">E-mail de acesso</label>
          <input id="ac-email" value={user?.email ?? ""} readOnly aria-describedby="ac-email-hint" className="!bg-muted" /></div>
        <p id="ac-email-hint" className="sm:col-span-2 text-xs text-muted-foreground -mt-2">O e-mail é o login e não pode ser trocado por aqui. Para mudar, peça a um gestor em Equipe e acessos.</p>
        <div className="sm:col-span-2 flex gap-2"><button className={btnPrimary} disabled={busy || name.trim() === current}>{busy ? "Salvando…" : "Salvar nome"}</button></div>
      </form>
    </Card>
  );
};

interface PersonRow { full_name: string; preferred_name: string | null; city: string | null; state_uf: string | null }

const PersonalData = ({ personId }: { personId: string }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [busy, setBusy] = useState(false);
  const [pref, setPref] = useState(""); const [phone, setPhone] = useState(""); const [city, setCity] = useState(""); const [uf, setUf] = useState("");
  const data = useQuery({
    queryKey: ["my-person-data", personId],
    queryFn: async () => {
      const [p, c] = await Promise.all([
        supabase.from("people").select("full_name, preferred_name, city, state_uf").eq("id", personId).maybeSingle(),
        supabase.from("person_contacts").select("value").eq("person_id", personId).eq("type", "phone").eq("is_primary", true).maybeSingle(),
      ]);
      return { person: p.data as PersonRow | null, phone: (c.data as { value: string } | null)?.value ?? "" };
    },
  });
  useEffect(() => {
    if (!data.data?.person) return;
    setPref(data.data.person.preferred_name ?? ""); setCity(data.data.person.city ?? ""); setUf(data.data.person.state_uf ?? ""); setPhone(data.data.phone);
  }, [data.data]);
  const save = async (e: FormEvent) => {
    e.preventDefault(); m.clear(); setBusy(true);
    const { error } = await supabase.rpc("my_profile_update", { p_preferred_name: pref.trim(), p_phone: phone.trim() || null, p_city: city.trim(), p_state_uf: uf });
    setBusy(false);
    if (error) return m.err(errText(error));
    m.ok("Dados atualizados."); void qc.invalidateQueries({ queryKey: ["my-person-data", personId] });
  };
  return (
    <Card title="Dados pessoais" hint="Do seu cadastro na base central. O nome completo e o documento só um gestor altera." testid="conta-dados">
      <Msg m={msg} />
      <State loading={data.isLoading} error={data.error} />
      {data.data?.person && (
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <div className="sm:col-span-2"><label className="block text-xs mb-1" htmlFor="pd-full">Nome completo</label><input id="pd-full" value={data.data.person.full_name} readOnly className="!bg-muted" /></div>
          <div><label className="block text-xs mb-1" htmlFor="pd-pref">Como prefere ser chamado(a)</label><input id="pd-pref" value={pref} onChange={(e) => setPref(e.target.value)} maxLength={120} /></div>
          <div><label className="block text-xs mb-1" htmlFor="pd-phone">Telefone / WhatsApp</label><input id="pd-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="(11) 98888-7777" autoComplete="tel" /></div>
          <div><label className="block text-xs mb-1" htmlFor="pd-city">Cidade</label><input id="pd-city" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" /></div>
          <div><label className="block text-xs mb-1" htmlFor="pd-uf">UF</label>
            <select id="pd-uf" value={uf} onChange={(e) => setUf(e.target.value)}><option value="">—</option>{UFS.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
          <div className="sm:col-span-2"><button className={btnPrimary} disabled={busy}>{busy ? "Salvando…" : "Salvar dados"}</button></div>
        </form>
      )}
    </Card>
  );
};

const Access = () => {
  const { roles } = useAuth();
  const units = useQuery({ queryKey: ["my-units-names"], queryFn: async () => (await supabase.from("units").select("id, name")).data ?? [] });
  const unitName = (id: string | null) => (id ? units.data?.find((u) => u.id === id)?.name ?? "unidade" : "todas as unidades");
  return (
    <Card title="Acesso e papéis" hint="O que você pode ver e fazer. Papéis e unidades são definidos por um gestor em Equipe e acessos." testid="conta-acesso">
      <ul className="flex flex-wrap gap-2">
        {roles.map((r, i) => <li key={i} className="rounded-full border border-border bg-muted px-3 py-1 text-xs"><strong className="font-semibold">{ROLE_LABEL[r.role]}</strong> · {unitName(r.unit_id)}</li>)}
        {roles.length === 0 && <li className="text-sm text-muted-foreground">Nenhum papel ativo.</li>}
      </ul>
    </Card>
  );
};

const Security = () => {
  const confirm = useConfirm(); const [msg, m] = useMsg(); const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const change = async (e: FormEvent) => {
    e.preventDefault(); m.clear();
    if (pw.length < MIN_PASSWORD) return m.err(`Use ao menos ${MIN_PASSWORD} caracteres.`);
    if (pw !== pw2) return m.err("A confirmação não confere com a nova senha.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return m.err(authError(error.message));
    setPw(""); setPw2(""); m.ok("Senha alterada. Nos outros aparelhos você continua conectado até sair; use “Sair de todos os aparelhos” se quiser encerrá-los.");
  };
  const signOutEverywhere = async () => {
    if (!(await confirm("Sair de todos os aparelhos?", "Você será desconectado aqui e em qualquer outro navegador ou celular onde esteja conectado.", "Sair de todos", true))) return;
    await supabase.auth.signOut({ scope: "global" });
  };
  return (
    <Card title="Segurança" hint={`A senha precisa ter ao menos ${MIN_PASSWORD} caracteres.`} testid="conta-seguranca">
      <Msg m={msg} />
      <form onSubmit={change} className="grid gap-4 sm:grid-cols-2 items-end" noValidate>
        <div><label htmlFor="sec-pw" className="block text-xs mb-1">Nova senha</label><input id="sec-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>
        <div><label htmlFor="sec-pw2" className="block text-xs mb-1">Confirmar nova senha</label><input id="sec-pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></div>
        <div className="sm:col-span-2 flex flex-wrap gap-2">
          <button className={btnPrimary} disabled={busy || !pw}>{busy ? "Salvando…" : "Alterar senha"}</button>
          <button type="button" className={btnGhost} onClick={() => void signOutEverywhere()}><LogOut size={14} aria-hidden className="mr-1.5" />Sair de todos os aparelhos</button>
        </div>
      </form>
    </Card>
  );
};

/** Configurações da conta de quem está logado (qualquer papel da equipe). As configurações do SISTEMA ficam em /admin/configuracoes, só para administradores. */
const Account = () => {
  const { hasRole } = useAuth(); const account = useMyAccount();
  return (
    <div>
      <PageHead eyebrow="Conta" title="Configurações" hint="Seu nome, seus dados e a segurança do seu acesso." />
      <Profile />
      {account.data?.person_id
        ? <PersonalData personId={account.data.person_id} />
        : account.data && <Card title="Dados pessoais" testid="conta-dados"><p className="text-sm text-muted-foreground">Sua conta ainda não está ligada a um cadastro de pessoa, então não há dados pessoais a editar aqui. Um gestor pode fazer essa ligação.</p></Card>}
      <Access />
      <Security />
      {hasRole("manager", "ops_admin") && (
        <Card title="Configurações do sistema" hint="Unidades, serviços, funis, números de WhatsApp e demais parâmetros da operação." testid="conta-sistema">
          <Link to="/admin/configuracoes" className={btnGhost}><Settings size={14} aria-hidden className="mr-1.5" />Abrir configurações do sistema</Link>
        </Card>
      )}
    </div>
  );
};

export default Account;
