-- HP Group Hub — 051 Privilégios das funções internas (schema private) criadas em 047–050.
-- O schema private não é exposto pela API, mas por defesa em profundidade:
--  · helpers de livro/período do Contábil (SECURITY DEFINER, sem checagem própria de papel — quem as chama já checou) só
--    podem ser executados pelas RPCs públicas (que rodam como dono) — nenhum papel de API precisa de EXECUTE;
--  · anon nunca executa nada aqui;
--  · ficam com EXECUTE para authenticated apenas o que policies/RPCs SECURITY INVOKER precisam:
--    can_acc*, has_acc_grant, acc_path_unit (RLS) e pj_import_analyze / pj_norm / pj_import_fields / adm_record_* (importação PJ).
revoke execute on function
  private.acc_ledger(uuid, uuid, date, text, boolean), private.acc_changes(uuid, uuid, date), private.acc_metrics(uuid, uuid, date),
  private.acc_check(uuid), private.acc_month(date), private.acc_is_closed(uuid, uuid, date), private.acc_period_ensure(uuid, uuid, date),
  private.acc_settings_row(uuid), private.acc_local_month(uuid), private.acc_user_name(uuid), private.acc_source_month(uuid, uuid, text, uuid)
from public, anon, authenticated;
revoke execute on function
  private.can_acc(uuid), private.can_acc_any(), private.can_acc_admin(), private.can_acc_see_names(uuid), private.has_acc_grant(text, uuid), private.acc_path_unit(text),
  private.adm_column_catalog(), private.pj_import_fields(), private.pj_norm(text, text), private.pj_import_analyze(jsonb),
  private.adm_record_audit(text, text, text, uuid, text[], jsonb, jsonb), private.adm_record_batch(text, text, uuid, jsonb, jsonb)
from public, anon;
