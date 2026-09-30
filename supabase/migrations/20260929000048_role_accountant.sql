-- HP Group Hub — 048 Papel "accountant" (contador/contabilidade) para o app Contábil.
-- Fica sozinho nesta migration: um valor novo de enum não pode ser usado na mesma transação em que é criado.
-- O papel só LÊ e prepara a competência (classificar, anexar, exportar) nas unidades atribuídas; fechar/reabrir
-- exige, além do papel, uma concessão explícita (acc_grants — migration 049).
alter type public.app_role add value if not exists 'accountant';
