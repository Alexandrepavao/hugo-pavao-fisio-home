-- HP Group Hub — 040 Auditoria para números de WhatsApp da captação (mesmo padrão genérico já usado em
-- people/units/role_assignments/invitations — private.audit_row já existente, só um novo gatilho).
create trigger audit_quiz_whatsapp_numbers after insert or update or delete on public.quiz_whatsapp_numbers
  for each row execute function private.audit_row('journey', 'unit_id', 'phone', 'active');
