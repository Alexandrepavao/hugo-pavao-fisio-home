-- HP Group Hub — 152 Avaliação completa: condições por área (catálogo N:N), plano inicial, orçamento, evidências por condição e casos educativos autorizados.
-- ADITIVA: não recria jornadas. Reaproveita pessoa/vínculo/apresentação/deck/produtos/vendas. Nada é inventado: o catálogo de condições é uma BASE INICIAL sujeita à revisão clínica (review_status = 'pending_review').
-- Uma ÁREA não é diagnóstico; "idoso", "acamado", "pós-operatório" etc. são CONTEXTO (context_tags), nunca condição. A queixa pode sugerir opções na tela, mas nenhum diagnóstico é gravado sem o profissional.
-- Autoria separada: relato do paciente (queixa) × diagnóstico documentado × avaliação/hipótese do profissional. O orçamento NÃO cria venda, cobrança nem ativa paciente (a regra de ativação por 1ª parcela quitada é intocada).

-- ---------------------------------------------------------------- 1. produto: desconto máximo autorizado pela gestão (política, não preço fixo no código)
alter table public.products add column if not exists max_discount_pct numeric(5,2) not null default 0 check (max_discount_pct between 0 and 100);

-- ---------------------------------------------------------------- 2. catálogo de condições (global, leitura por autenticados) e relação N:N com as áreas
create table public.physio_conditions (
  key text primary key check (key ~ '^[a-z0-9_]{2,60}$'),
  label text not null check (length(btrim(label)) between 2 and 160),
  synonyms text[] not null default '{}',
  subtypes jsonb not null default '[]'::jsonb,            -- [{ "key": "...", "label": "..." }]
  uses_region boolean not null default false, uses_laterality boolean not null default false,
  review_status text not null default 'pending_review' check (review_status in ('pending_review', 'reviewed')),
  sort int not null default 100
);
create table public.physio_condition_areas (
  condition_key text not null references public.physio_conditions(key) on delete cascade,
  area_key text not null references public.physio_areas(key) on delete cascade,
  primary key (condition_key, area_key)
);
create index physio_condition_areas_area_idx on public.physio_condition_areas (area_key);
alter table public.physio_conditions enable row level security; alter table public.physio_condition_areas enable row level security;
revoke all on public.physio_conditions, public.physio_condition_areas from public, anon, authenticated;
create policy physio_conditions_read on public.physio_conditions for select to authenticated using (true);
create policy physio_condition_areas_read on public.physio_condition_areas for select to authenticated using (true);
grant select on public.physio_conditions, public.physio_condition_areas to authenticated;

-- BASE INICIAL de condições (cadastro), sujeita à revisão clínica: review_status = 'pending_review'. Uma condição pode pertencer a várias áreas (N:N), sem cadastros duplicados.
insert into public.physio_conditions (key, label, synonyms, subtypes, uses_region, uses_laterality, sort) values
  ('avc', 'AVC (acidente vascular cerebral)', array['derrame', 'AVE', 'acidente vascular encefálico']::text[], '[{"key": "isquemico", "label": "Isquêmico"}, {"key": "hemorragico", "label": "Hemorrágico"}]'::jsonb, false, true, 10),
  ('parkinson', 'Doença de Parkinson', array['parkinsonismo', 'mal de Parkinson']::text[], '[]'::jsonb, false, false, 20),
  ('esclerose_multipla', 'Esclerose múltipla', array['EM']::text[], '[{"key": "surto_remissao", "label": "Surto-remissão"}, {"key": "progressiva", "label": "Progressiva"}]'::jsonb, false, false, 30),
  ('tce', 'Traumatismo cranioencefálico (TCE)', array['TCE', 'trauma de crânio']::text[], '[{"key": "leve", "label": "Leve"}, {"key": "moderado", "label": "Moderado"}, {"key": "grave", "label": "Grave"}]'::jsonb, false, false, 40),
  ('lesao_medular', 'Lesão medular', array['paraplegia', 'tetraplegia', 'trauma raquimedular']::text[], '[{"key": "tetraplegia", "label": "Tetraplegia"}, {"key": "paraplegia", "label": "Paraplegia"}, {"key": "incompleta", "label": "Incompleta"}, {"key": "completa", "label": "Completa"}]'::jsonb, false, false, 50),
  ('paralisia_facial', 'Paralisia facial periférica', array['paralisia de Bell', 'paralisia do nervo facial']::text[], '[]'::jsonb, false, true, 60),
  ('neuropatia_periferica', 'Neuropatia periférica', array['polineuropatia', 'neuropatia diabética']::text[], '[]'::jsonb, true, true, 70),
  ('guillain_barre', 'Síndrome de Guillain-Barré', array['Guillain Barré']::text[], '[]'::jsonb, false, false, 80),
  ('paralisia_cerebral', 'Paralisia cerebral', array['PC', 'encefalopatia crônica não progressiva']::text[], '[{"key": "espastica", "label": "Espástica"}, {"key": "discinetica", "label": "Discinética"}, {"key": "ataxica", "label": "Atáxica"}, {"key": "mista", "label": "Mista"}]'::jsonb, false, false, 90),
  ('ataxia', 'Ataxia', array['incoordenação']::text[], '[]'::jsonb, false, false, 100),
  ('demencia', 'Demência (inclui Alzheimer)', array['Alzheimer', 'doença de Alzheimer', 'declínio cognitivo']::text[], '[{"key": "alzheimer", "label": "Doença de Alzheimer"}, {"key": "vascular", "label": "Vascular"}, {"key": "outra", "label": "Outra"}]'::jsonb, false, false, 110),
  ('disfuncao_vestibular', 'Disfunção vestibular', array['labirintite', 'vertigem', 'VPPB', 'tontura']::text[], '[{"key": "vppb", "label": "VPPB"}, {"key": "hipofuncao", "label": "Hipofunção vestibular"}, {"key": "outra", "label": "Outra"}]'::jsonb, false, false, 120),
  ('ela', 'Esclerose lateral amiotrófica (ELA)', array['ELA', 'doença do neurônio motor']::text[], '[]'::jsonb, false, false, 130),
  ('lombalgia', 'Lombalgia (dor lombar)', array['dor nas costas', 'dor lombar', 'lumbago']::text[], '[{"key": "aguda", "label": "Aguda"}, {"key": "subaguda", "label": "Subaguda"}, {"key": "cronica", "label": "Crônica"}, {"key": "com_irradiacao", "label": "Com irradiação"}]'::jsonb, false, true, 140),
  ('cervicalgia', 'Cervicalgia (dor cervical)', array['dor no pescoço', 'torcicolo', 'dor cervical']::text[], '[{"key": "aguda", "label": "Aguda"}, {"key": "cronica", "label": "Crônica"}, {"key": "com_irradiacao", "label": "Com irradiação para o braço"}]'::jsonb, false, true, 150),
  ('dorsalgia', 'Dorsalgia (dor torácica/dorsal)', array['dor nas costas alta', 'dor dorsal']::text[], '[]'::jsonb, false, true, 160),
  ('hernia_disco', 'Hérnia de disco', array['protrusão discal', 'abaulamento discal', 'discopatia']::text[], '[{"key": "lombar", "label": "Lombar"}, {"key": "cervical", "label": "Cervical"}, {"key": "toracica", "label": "Torácica"}]'::jsonb, false, true, 170),
  ('ciatalgia', 'Ciatalgia', array['ciática', 'dor no nervo ciático']::text[], '[]'::jsonb, false, true, 180),
  ('dor_sacroiliaca', 'Disfunção/dor sacroilíaca', array['dor na bacia', 'sacroileíte']::text[], '[]'::jsonb, false, true, 190),
  ('escoliose', 'Escoliose', array['desvio de coluna']::text[], '[{"key": "idiopatica", "label": "Idiopática"}, {"key": "degenerativa", "label": "Degenerativa"}, {"key": "outra", "label": "Outra"}]'::jsonb, false, false, 200),
  ('osteoartrite', 'Osteoartrite (artrose)', array['artrose', 'gonartrose', 'coxartrose', 'desgaste articular']::text[], '[{"key": "joelho", "label": "Joelho"}, {"key": "quadril", "label": "Quadril"}, {"key": "mao", "label": "Mão"}, {"key": "coluna", "label": "Coluna"}, {"key": "outra", "label": "Outra articulação"}]'::jsonb, true, true, 210),
  ('fratura', 'Fratura', array['quebrou o osso', 'fratura óssea']::text[], '[{"key": "conservador", "label": "Tratamento conservador"}, {"key": "cirurgico", "label": "Tratamento cirúrgico"}]'::jsonb, true, true, 220),
  ('lesao_lca', 'Lesão do ligamento cruzado anterior (LCA)', array['LCA', 'ruptura de LCA']::text[], '[{"key": "reconstruida", "label": "Reconstruída (cirurgia)"}, {"key": "conservadora", "label": "Tratamento conservador"}]'::jsonb, false, true, 230),
  ('lesao_menisco', 'Lesão meniscal', array['menisco', 'ruptura de menisco']::text[], '[{"key": "conservadora", "label": "Tratamento conservador"}, {"key": "pos_cirurgica", "label": "Pós-cirúrgica"}]'::jsonb, false, true, 240),
  ('tendinopatia_manguito', 'Tendinopatia/lesão do manguito rotador', array['manguito rotador', 'tendinite do ombro', 'síndrome do impacto']::text[], '[{"key": "tendinopatia", "label": "Tendinopatia"}, {"key": "ruptura_parcial", "label": "Ruptura parcial"}, {"key": "ruptura_total", "label": "Ruptura total"}]'::jsonb, false, true, 250),
  ('capsulite_adesiva', 'Capsulite adesiva (ombro congelado)', array['ombro congelado']::text[], '[]'::jsonb, false, true, 260),
  ('luxacao_ombro', 'Instabilidade/luxação do ombro', array['ombro deslocado', 'luxação glenoumeral']::text[], '[]'::jsonb, false, true, 270),
  ('epicondilopatia', 'Epicondilopatia (cotovelo de tenista/golfista)', array['epicondilite', 'cotovelo de tenista']::text[], '[{"key": "lateral", "label": "Lateral"}, {"key": "medial", "label": "Medial"}]'::jsonb, false, true, 280),
  ('sindrome_tunel_carpo', 'Síndrome do túnel do carpo', array['túnel do carpo', 'compressão do nervo mediano']::text[], '[]'::jsonb, false, true, 290),
  ('tendinopatia_patelar', 'Tendinopatia patelar', array['joelho do saltador', 'tendinite patelar']::text[], '[]'::jsonb, false, true, 300),
  ('dor_patelofemoral', 'Dor patelofemoral', array['condromalácia', 'dor anterior do joelho']::text[], '[]'::jsonb, false, true, 310),
  ('entorse_tornozelo', 'Entorse de tornozelo', array['torção de tornozelo']::text[], '[{"key": "aguda", "label": "Aguda"}, {"key": "cronica", "label": "Instabilidade crônica"}]'::jsonb, false, true, 320),
  ('fascite_plantar', 'Fascite plantar', array['dor no calcanhar', 'esporão']::text[], '[]'::jsonb, false, true, 330),
  ('tendinopatia_aquiles', 'Tendinopatia do calcâneo (Aquiles)', array['tendão de Aquiles', 'tendinite de Aquiles']::text[], '[]'::jsonb, false, true, 340),
  ('lesao_muscular', 'Lesão muscular (distensão/estiramento)', array['estiramento', 'distensão muscular', 'rotura muscular']::text[], '[{"key": "grau1", "label": "Grau I"}, {"key": "grau2", "label": "Grau II"}, {"key": "grau3", "label": "Grau III"}]'::jsonb, true, true, 350),
  ('canelite', 'Síndrome do estresse tibial medial (canelite)', array['canelite', 'dor na canela']::text[], '[]'::jsonb, false, true, 360),
  ('artroplastia', 'Artroplastia (prótese articular)', array['prótese de joelho', 'prótese de quadril', 'artroplastia total']::text[], '[{"key": "joelho", "label": "Joelho"}, {"key": "quadril", "label": "Quadril"}, {"key": "ombro", "label": "Ombro"}]'::jsonb, false, true, 370),
  ('dtm', 'Disfunção temporomandibular (DTM)', array['ATM', 'dor na mandíbula', 'bruxismo']::text[], '[]'::jsonb, false, false, 380),
  ('ler_dort', 'LER/DORT (lesão por esforço repetitivo)', array['LER', 'DORT', 'tenossinovite']::text[], '[]'::jsonb, true, true, 390),
  ('bursite', 'Bursite', array['bursite trocantérica', 'bursite do ombro']::text[], '[]'::jsonb, true, true, 400),
  ('artrite_reumatoide', 'Artrite reumatoide', array['AR']::text[], '[]'::jsonb, false, false, 410),
  ('fibromialgia', 'Fibromialgia', array['dor difusa crônica']::text[], '[]'::jsonb, false, false, 420),
  ('espondilite_anquilosante', 'Espondilite anquilosante', array['espondiloartrite axial']::text[], '[]'::jsonb, false, false, 430),
  ('lupus', 'Lúpus eritematoso sistêmico', array['LES']::text[], '[]'::jsonb, false, false, 440),
  ('artrite_psoriatica', 'Artrite psoriásica', array['artrite psoriática']::text[], '[]'::jsonb, false, false, 450),
  ('osteoporose', 'Osteoporose', array['osteopenia', 'perda de massa óssea']::text[], '[]'::jsonb, false, false, 460),
  ('dpoc', 'DPOC', array['enfisema', 'bronquite crônica', 'doença pulmonar obstrutiva crônica']::text[], '[]'::jsonb, false, false, 470),
  ('asma', 'Asma', array['bronquite asmática']::text[], '[]'::jsonb, false, false, 480),
  ('fibrose_pulmonar', 'Fibrose pulmonar', array['doença pulmonar intersticial']::text[], '[]'::jsonb, false, false, 490),
  ('bronquiectasia', 'Bronquiectasia', array[]::text[], '[]'::jsonb, false, false, 500),
  ('fibrose_cistica', 'Fibrose cística', array['mucoviscidose']::text[], '[]'::jsonb, false, false, 510),
  ('sequela_covid', 'Sequelas/síndrome pós-COVID', array['COVID longa', 'pós-covid']::text[], '[]'::jsonb, false, false, 520),
  ('pneumonia', 'Pneumonia (recuperação)', array[]::text[], '[]'::jsonb, false, false, 530),
  ('insuficiencia_cardiaca', 'Insuficiência cardíaca', array['IC', 'coração fraco']::text[], '[]'::jsonb, false, false, 540),
  ('infarto', 'Infarto agudo do miocárdio (recuperação)', array['IAM', 'ataque cardíaco']::text[], '[]'::jsonb, false, false, 550),
  ('doenca_coronariana', 'Doença arterial coronariana', array['DAC', 'angina']::text[], '[]'::jsonb, false, false, 560),
  ('hipertensao', 'Hipertensão arterial', array['pressão alta', 'HAS']::text[], '[]'::jsonb, false, false, 570),
  ('doenca_arterial_periferica', 'Doença arterial periférica', array['claudicação', 'DAP']::text[], '[]'::jsonb, false, true, 580),
  ('insuficiencia_venosa', 'Insuficiência venosa crônica', array['varizes', 'úlcera venosa']::text[], '[]'::jsonb, false, true, 590),
  ('cirurgia_cardiaca', 'Pós-cirurgia cardíaca', array['revascularização', 'ponte de safena', 'troca valvar']::text[], '[]'::jsonb, false, false, 600),
  ('sarcopenia', 'Sarcopenia', array['perda de massa muscular']::text[], '[]'::jsonb, false, false, 610),
  ('risco_quedas', 'Risco de quedas', array['quedas frequentes', 'desequilíbrio']::text[], '[]'::jsonb, false, false, 620),
  ('fragilidade', 'Síndrome de fragilidade', array['idoso frágil']::text[], '[]'::jsonb, false, false, 630),
  ('declinio_funcional', 'Declínio funcional', array['perda de autonomia']::text[], '[]'::jsonb, false, false, 640),
  ('incontinencia_urinaria', 'Incontinência urinária', array['perda de urina', 'bexiga hiperativa']::text[], '[{"key": "esforco", "label": "De esforço"}, {"key": "urgencia", "label": "De urgência"}, {"key": "mista", "label": "Mista"}]'::jsonb, false, false, 650),
  ('dor_pelvica', 'Dor pélvica crônica', array['vulvodínia', 'dispareunia', 'vaginismo']::text[], '[]'::jsonb, false, false, 660),
  ('prolapso', 'Prolapso de órgãos pélvicos', array['bexiga caída', 'cistocele']::text[], '[]'::jsonb, false, false, 670),
  ('dor_lombopelvica_gestacao', 'Dor lombopélvica na gestação', array['dor na gravidez', 'dor gestacional']::text[], '[]'::jsonb, false, false, 680),
  ('diastase', 'Diástase dos músculos retos abdominais', array['diástase abdominal']::text[], '[]'::jsonb, false, false, 690),
  ('endometriose', 'Endometriose (dor associada)', array[]::text[], '[]'::jsonb, false, false, 700),
  ('cancer_mama', 'Câncer de mama (reabilitação)', array['mastectomia', 'pós-mastectomia']::text[], '[{"key": "pos_cirurgico", "label": "Pós-cirúrgico"}, {"key": "quimioterapia", "label": "Em quimioterapia"}, {"key": "radioterapia", "label": "Em radioterapia"}, {"key": "hormonoterapia", "label": "Em hormonoterapia"}]'::jsonb, false, true, 710),
  ('linfedema', 'Linfedema', array['inchaço no braço', 'edema linfático']::text[], '[{"key": "primario", "label": "Primário"}, {"key": "secundario", "label": "Secundário"}]'::jsonb, true, true, 720),
  ('fadiga_oncologica', 'Fadiga relacionada ao câncer', array['cansaço oncológico']::text[], '[]'::jsonb, false, false, 730),
  ('neuropatia_quimio', 'Neuropatia induzida por quimioterapia', array['formigamento por quimioterapia']::text[], '[]'::jsonb, true, true, 740),
  ('cancer_cabeca_pescoco', 'Câncer de cabeça e pescoço (reabilitação)', array[]::text[], '[]'::jsonb, false, false, 750),
  ('fibro_edema', 'Fibro edema gelóide', array['celulite']::text[], '[]'::jsonb, true, true, 760),
  ('cicatriz', 'Cicatriz alterada (aderência/queloide)', array['fibrose', 'queloide', 'cicatriz hipertrófica']::text[], '[{"key": "aderida", "label": "Aderida"}, {"key": "hipertrofica", "label": "Hipertrófica"}, {"key": "queloide", "label": "Queloide"}]'::jsonb, true, false, 770),
  ('pos_estetico', 'Pós-operatório de cirurgia estética (reabilitação)', array['lipoaspiração', 'abdominoplastia']::text[], '[]'::jsonb, true, false, 780),
  ('flacidez', 'Flacidez tissular', array[]::text[], '[]'::jsonb, true, false, 790),
  ('fraqueza_uti', 'Fraqueza adquirida na UTI', array['polineuropatia do doente crítico']::text[], '[]'::jsonb, false, false, 800),
  ('insuficiencia_respiratoria', 'Insuficiência respiratória', array['ventilação mecânica', 'desmame ventilatório']::text[], '[]'::jsonb, false, false, 810),
  ('sindrome_pos_uti', 'Síndrome pós-cuidados intensivos', array['pós-UTI']::text[], '[]'::jsonb, false, false, 820),
  ('cefaleia', 'Cefaleia', array['dor de cabeça', 'enxaqueca', 'migrânea']::text[], '[{"key": "tensional", "label": "Tensional"}, {"key": "enxaqueca", "label": "Enxaqueca"}, {"key": "cervicogenica", "label": "Cervicogênica"}]'::jsonb, false, false, 830),
  ('dor_cronica', 'Dor crônica', array['dor persistente']::text[], '[]'::jsonb, true, true, 840);
insert into public.physio_condition_areas (condition_key, area_key) values
  ('avc', 'aquatica'),
  ('avc', 'gerontologia'),
  ('avc', 'neurofuncional'),
  ('parkinson', 'aquatica'),
  ('parkinson', 'gerontologia'),
  ('parkinson', 'neurofuncional'),
  ('esclerose_multipla', 'neurofuncional'),
  ('tce', 'neurofuncional'),
  ('lesao_medular', 'neurofuncional'),
  ('paralisia_facial', 'neurofuncional'),
  ('neuropatia_periferica', 'neurofuncional'),
  ('neuropatia_periferica', 'oncologia'),
  ('guillain_barre', 'neurofuncional'),
  ('guillain_barre', 'terapia_intensiva'),
  ('paralisia_cerebral', 'aquatica'),
  ('paralisia_cerebral', 'neurofuncional'),
  ('ataxia', 'neurofuncional'),
  ('demencia', 'gerontologia'),
  ('demencia', 'neurofuncional'),
  ('disfuncao_vestibular', 'gerontologia'),
  ('disfuncao_vestibular', 'neurofuncional'),
  ('ela', 'neurofuncional'),
  ('lombalgia', 'aquatica'),
  ('lombalgia', 'esportiva'),
  ('lombalgia', 'osteopatia'),
  ('lombalgia', 'quiropraxia'),
  ('lombalgia', 'trabalho'),
  ('lombalgia', 'traumato_ortopedica'),
  ('cervicalgia', 'osteopatia'),
  ('cervicalgia', 'quiropraxia'),
  ('cervicalgia', 'trabalho'),
  ('cervicalgia', 'traumato_ortopedica'),
  ('dorsalgia', 'osteopatia'),
  ('dorsalgia', 'quiropraxia'),
  ('dorsalgia', 'trabalho'),
  ('dorsalgia', 'traumato_ortopedica'),
  ('hernia_disco', 'osteopatia'),
  ('hernia_disco', 'quiropraxia'),
  ('hernia_disco', 'traumato_ortopedica'),
  ('ciatalgia', 'osteopatia'),
  ('ciatalgia', 'quiropraxia'),
  ('ciatalgia', 'traumato_ortopedica'),
  ('dor_sacroiliaca', 'osteopatia'),
  ('dor_sacroiliaca', 'quiropraxia'),
  ('dor_sacroiliaca', 'traumato_ortopedica'),
  ('escoliose', 'osteopatia'),
  ('escoliose', 'quiropraxia'),
  ('escoliose', 'traumato_ortopedica'),
  ('osteoartrite', 'aquatica'),
  ('osteoartrite', 'gerontologia'),
  ('osteoartrite', 'reumatologia'),
  ('osteoartrite', 'traumato_ortopedica'),
  ('fratura', 'esportiva'),
  ('fratura', 'gerontologia'),
  ('fratura', 'traumato_ortopedica'),
  ('lesao_lca', 'esportiva'),
  ('lesao_lca', 'traumato_ortopedica'),
  ('lesao_menisco', 'esportiva'),
  ('lesao_menisco', 'traumato_ortopedica'),
  ('tendinopatia_manguito', 'esportiva'),
  ('tendinopatia_manguito', 'trabalho'),
  ('tendinopatia_manguito', 'traumato_ortopedica'),
  ('capsulite_adesiva', 'reumatologia'),
  ('capsulite_adesiva', 'traumato_ortopedica'),
  ('luxacao_ombro', 'esportiva'),
  ('luxacao_ombro', 'traumato_ortopedica'),
  ('epicondilopatia', 'esportiva'),
  ('epicondilopatia', 'trabalho'),
  ('epicondilopatia', 'traumato_ortopedica'),
  ('sindrome_tunel_carpo', 'trabalho'),
  ('sindrome_tunel_carpo', 'traumato_ortopedica'),
  ('tendinopatia_patelar', 'esportiva'),
  ('tendinopatia_patelar', 'traumato_ortopedica'),
  ('dor_patelofemoral', 'esportiva'),
  ('dor_patelofemoral', 'traumato_ortopedica'),
  ('entorse_tornozelo', 'esportiva'),
  ('entorse_tornozelo', 'traumato_ortopedica'),
  ('fascite_plantar', 'esportiva'),
  ('fascite_plantar', 'traumato_ortopedica'),
  ('tendinopatia_aquiles', 'esportiva'),
  ('tendinopatia_aquiles', 'traumato_ortopedica'),
  ('lesao_muscular', 'esportiva'),
  ('lesao_muscular', 'traumato_ortopedica'),
  ('canelite', 'esportiva'),
  ('artroplastia', 'gerontologia'),
  ('artroplastia', 'traumato_ortopedica'),
  ('dtm', 'acupuntura'),
  ('dtm', 'osteopatia'),
  ('dtm', 'quiropraxia'),
  ('dtm', 'traumato_ortopedica'),
  ('ler_dort', 'trabalho'),
  ('ler_dort', 'traumato_ortopedica'),
  ('bursite', 'esportiva'),
  ('bursite', 'traumato_ortopedica'),
  ('artrite_reumatoide', 'reumatologia'),
  ('fibromialgia', 'acupuntura'),
  ('fibromialgia', 'aquatica'),
  ('fibromialgia', 'reumatologia'),
  ('espondilite_anquilosante', 'reumatologia'),
  ('lupus', 'reumatologia'),
  ('artrite_psoriatica', 'reumatologia'),
  ('osteoporose', 'gerontologia'),
  ('osteoporose', 'reumatologia'),
  ('osteoporose', 'traumato_ortopedica'),
  ('dpoc', 'cardiovascular'),
  ('dpoc', 'gerontologia'),
  ('dpoc', 'respiratoria'),
  ('asma', 'respiratoria'),
  ('fibrose_pulmonar', 'respiratoria'),
  ('bronquiectasia', 'respiratoria'),
  ('fibrose_cistica', 'respiratoria'),
  ('sequela_covid', 'neurofuncional'),
  ('sequela_covid', 'respiratoria'),
  ('sequela_covid', 'terapia_intensiva'),
  ('pneumonia', 'gerontologia'),
  ('pneumonia', 'respiratoria'),
  ('pneumonia', 'terapia_intensiva'),
  ('insuficiencia_cardiaca', 'cardiovascular'),
  ('insuficiencia_cardiaca', 'gerontologia'),
  ('infarto', 'cardiovascular'),
  ('doenca_coronariana', 'cardiovascular'),
  ('hipertensao', 'cardiovascular'),
  ('hipertensao', 'gerontologia'),
  ('doenca_arterial_periferica', 'cardiovascular'),
  ('doenca_arterial_periferica', 'gerontologia'),
  ('insuficiencia_venosa', 'cardiovascular'),
  ('insuficiencia_venosa', 'dermatofuncional'),
  ('cirurgia_cardiaca', 'cardiovascular'),
  ('sarcopenia', 'gerontologia'),
  ('risco_quedas', 'gerontologia'),
  ('risco_quedas', 'neurofuncional'),
  ('fragilidade', 'gerontologia'),
  ('declinio_funcional', 'gerontologia'),
  ('incontinencia_urinaria', 'saude_mulher'),
  ('dor_pelvica', 'saude_mulher'),
  ('prolapso', 'saude_mulher'),
  ('dor_lombopelvica_gestacao', 'saude_mulher'),
  ('dor_lombopelvica_gestacao', 'traumato_ortopedica'),
  ('diastase', 'dermatofuncional'),
  ('diastase', 'saude_mulher'),
  ('endometriose', 'saude_mulher'),
  ('cancer_mama', 'oncologia'),
  ('cancer_mama', 'saude_mulher'),
  ('linfedema', 'cardiovascular'),
  ('linfedema', 'dermatofuncional'),
  ('linfedema', 'oncologia'),
  ('fadiga_oncologica', 'oncologia'),
  ('neuropatia_quimio', 'neurofuncional'),
  ('neuropatia_quimio', 'oncologia'),
  ('cancer_cabeca_pescoco', 'oncologia'),
  ('fibro_edema', 'dermatofuncional'),
  ('cicatriz', 'dermatofuncional'),
  ('cicatriz', 'traumato_ortopedica'),
  ('pos_estetico', 'dermatofuncional'),
  ('flacidez', 'dermatofuncional'),
  ('fraqueza_uti', 'neurofuncional'),
  ('fraqueza_uti', 'terapia_intensiva'),
  ('insuficiencia_respiratoria', 'respiratoria'),
  ('insuficiencia_respiratoria', 'terapia_intensiva'),
  ('sindrome_pos_uti', 'terapia_intensiva'),
  ('cefaleia', 'acupuntura'),
  ('cefaleia', 'osteopatia'),
  ('cefaleia', 'quiropraxia'),
  ('cefaleia', 'traumato_ortopedica'),
  ('dor_cronica', 'acupuntura'),
  ('dor_cronica', 'reumatologia');


-- ---------------------------------------------------------------- 3. condições da avaliação (várias; principal + associadas) e campos novos da apresentação
alter table public.evaluation_presentations
  add column if not exists context_tags text[] not null default '{}',
  add column if not exists initial_sessions smallint check (initial_sessions is null or initial_sessions between 1 and 200),
  add column if not exists session_minutes smallint check (session_minutes is null or session_minutes between 10 and 240),
  add column if not exists approach_text text check (approach_text is null or length(approach_text) <= 2000);

create table public.presentation_conditions (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null references public.evaluation_presentations(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete restrict,
  condition_key text references public.physio_conditions(key) on delete restrict,
  free_text text check (free_text is null or length(btrim(free_text)) between 2 and 200),
  role text not null default 'principal' check (role in ('principal', 'associated')),
  status text not null check (status in ('documented', 'assessed', 'hypothesis', 'investigating', 'not_informed')),
  subtype_key text, body_region text check (body_region is null or length(body_region) <= 60),
  laterality text check (laterality is null or laterality in ('right', 'left', 'bilateral', 'na')),
  onset_text text check (onset_text is null or length(onset_text) <= 120),
  position int not null default 1,
  check (condition_key is not null or free_text is not null or status = 'not_informed')
);
create unique index presentation_conditions_one_principal on public.presentation_conditions (presentation_id) where role = 'principal';
create index presentation_conditions_pres_idx on public.presentation_conditions (presentation_id, position);
alter table public.presentation_conditions enable row level security; revoke all on public.presentation_conditions from public, anon, authenticated;
do $$ begin
  if to_regprocedure('private.org_fk_guard_attach()') is not null then perform private.org_fk_map_refresh(); perform private.org_fk_guard_attach(); end if;   -- só existe com o white label
end $$;

create or replace function private.context_tag_label(k text) returns text language sql immutable set search_path = '' as $$
  select case k when 'idoso' then 'Pessoa idosa' when 'acamado' then 'Acamado(a)' when 'pos_operatorio' then 'Pós-operatório' when 'pos_alta_hospitalar' then 'Pós-alta hospitalar'
                when 'cuidador_presente' then 'Cuidador(a) presente' when 'dispositivo_auxiliar' then 'Usa dispositivo auxiliar (muleta, andador…)' when 'gestante' then 'Gestante' end
$$;

-- linhas da avaliação já com o nome do catálogo (equipe) — usado também no retrato do paciente (sem ids internos)
create or replace function private.presentation_conditions_json(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'condition_key', c.condition_key, 'label', coalesce(pc.label, c.free_text), 'free_text', c.free_text, 'role', c.role, 'status', c.status,
      'subtype_key', c.subtype_key, 'subtype_label', (select s ->> 'label' from jsonb_array_elements(coalesce(pc.subtypes, '[]'::jsonb)) s where s ->> 'key' = c.subtype_key limit 1),
      'body_region', c.body_region, 'laterality', c.laterality, 'onset_text', c.onset_text, 'position', c.position) order by c.role, c.position), '[]'::jsonb)
    from public.presentation_conditions c left join public.physio_conditions pc on pc.key = c.condition_key where c.presentation_id = p_id
$$;

-- substitui TODAS as condições da apresentação pelas enviadas (validação completa) e devolve o resumo legado (condition_kind/condition_text), que o resto do sistema já usa
create or replace function private.presentation_set_conditions(p public.evaluation_presentations, p_rows jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare r jsonb; n int := 0; v_principal int := 0; v_key text; v_status text; v_sub text; v_pos int := 0; v_cat public.physio_conditions;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'condições inválidas'; end if;
  if jsonb_array_length(p_rows) > 8 then raise exception 'use no máximo 8 condições por avaliação'; end if;
  delete from public.presentation_conditions where presentation_id = p.id;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_pos := v_pos + 1; v_key := nullif(btrim(r ->> 'condition_key'), ''); v_status := coalesce(nullif(r ->> 'status', ''), 'assessed'); v_sub := nullif(btrim(r ->> 'subtype_key'), '');
    if v_status not in ('documented', 'assessed', 'hypothesis', 'investigating', 'not_informed') then raise exception 'situação da condição inválida'; end if;
    if v_key is not null then
      select * into v_cat from public.physio_conditions where key = v_key; if not found then raise exception 'condição inválida: %', v_key; end if;
      if v_sub is not null and not exists (select 1 from jsonb_array_elements(v_cat.subtypes) s where s ->> 'key' = v_sub) then raise exception 'subtipo inválido para %', v_cat.label; end if;
    elsif v_sub is not null then raise exception 'subtipo exige uma condição do catálogo'; end if;
    if v_key is null and nullif(btrim(r ->> 'free_text'), '') is null and v_status <> 'not_informed' then raise exception 'escolha uma condição ou descreva em texto'; end if;
    if coalesce(r ->> 'role', 'principal') = 'principal' then v_principal := v_principal + 1; end if;
    insert into public.presentation_conditions (presentation_id, org_id, condition_key, free_text, role, status, subtype_key, body_region, laterality, onset_text, position)
      values (p.id, p.org_id, v_key, nullif(btrim(r ->> 'free_text'), ''), coalesce(nullif(r ->> 'role', ''), 'principal'), v_status, v_sub, nullif(btrim(r ->> 'body_region'), ''), nullif(r ->> 'laterality', ''), nullif(btrim(r ->> 'onset_text'), ''), v_pos);
    n := n + 1;
  end loop;
  if v_principal > 1 then raise exception 'só pode haver uma condição principal'; end if;
end $$;

create or replace function private.presentation_conditions_legacy(p_id uuid, out o_kind text, out o_text text) language plpgsql stable security definer set search_path = '' as $$
declare c record;
begin
  select pc.status, coalesce(cat.label, pc.free_text) as lbl, (select s ->> 'label' from jsonb_array_elements(coalesce(cat.subtypes, '[]'::jsonb)) s where s ->> 'key' = pc.subtype_key limit 1) as sub
    into c from public.presentation_conditions pc left join public.physio_conditions cat on cat.key = pc.condition_key
   where pc.presentation_id = p_id order by (pc.role = 'principal') desc, pc.position limit 1;
  if not found or c.status = 'not_informed' or c.lbl is null then o_kind := null; o_text := null; return; end if;
  o_text := left(c.lbl || coalesce(' — ' || c.sub, ''), 500);
  o_kind := case when c.status in ('documented', 'assessed') then 'assessed' else 'hypothesis' end;
end $$;

-- ---------------------------------------------------------------- 4. evidências: condição, população, fase, intervenção e resultado medido (não só a especialidade)
alter table public.evidence_references
  add column if not exists intervention text check (intervention is null or length(intervention) <= 800),
  add column if not exists outcome_measure text check (outcome_measure is null or length(outcome_measure) <= 600),
  add column if not exists phase text check (phase is null or length(phase) <= 200),
  add column if not exists condition_keys text[] not null default '{}';

create or replace function private.evidence_json(r public.evidence_references) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'title', r.title, 'authors', r.authors, 'journal', r.journal, 'year', r.year, 'doi', r.doi, 'url', r.url, 'design', r.study_design,
    'population', r.population, 'comparison', r.comparison, 'benefits', r.benefits, 'duration', r.duration_text, 'follow_up', r.follow_up_text, 'limitations', r.limitations,
    'intervention', r.intervention, 'outcome_measure', r.outcome_measure, 'phase', r.phase, 'condition_keys', to_jsonb(r.condition_keys),
    'area_keys', to_jsonb(r.area_keys), 'conditions', to_jsonb(r.conditions), 'status', r.status, 'version', r.version, 'reviewed_at', r.reviewed_at, 'source_verified_at', r.source_verified_at)
$$;

create or replace function public.evidence_save(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); r public.evidence_references; v_doi text := nullif(btrim(p ->> 'doi'), ''); v_url text := nullif(btrim(p ->> 'url'), ''); v_areas text[]; v_ckeys text[]; v_id uuid;
  v_conds text[];
begin
  if v_org is null or not (private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) or exists (select 1 from public.role_assignments ra where ra.user_id = (select auth.uid()) and ra.role = 'physio' and ra.revoked_at is null)) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if v_doi is not null then v_doi := regexp_replace(v_doi, '^(https?://(dx\.)?doi\.org/|doi:)', '', 'i'); end if;
  if v_doi is null and v_url is null then raise exception 'informe o DOI ou o link da fonte original'; end if;
  if length(btrim(coalesce(p ->> 'title', ''))) < 5 then raise exception 'informe o título'; end if;
  select coalesce(array_agg(x), '{}') into v_areas from jsonb_array_elements_text(coalesce(p -> 'area_keys', '[]'::jsonb)) x;
  if exists (select 1 from unnest(v_areas) k where not exists (select 1 from public.physio_areas a where a.key = k)) then raise exception 'área inválida'; end if;
  select coalesce(array_agg(x), '{}') into v_ckeys from jsonb_array_elements_text(coalesce(p -> 'condition_keys', '[]'::jsonb)) x;
  if exists (select 1 from unnest(v_ckeys) k where not exists (select 1 from public.physio_conditions c where c.key = k)) then raise exception 'condição inválida'; end if;
  v_conds := coalesce((select array_agg(btrim(x)) from jsonb_array_elements_text(coalesce(p -> 'conditions', '[]'::jsonb)) x where btrim(x) <> ''), '{}');
  if p_id is null then
    insert into public.evidence_references (org_id, title, authors, journal, year, doi, url, study_design, population, comparison, benefits, duration_text, follow_up_text, limitations, area_keys, conditions, license_note, proposed_by,
                                            intervention, outcome_measure, phase, condition_keys)
      values (v_org, btrim(p ->> 'title'), nullif(btrim(p ->> 'authors'), ''), nullif(btrim(p ->> 'journal'), ''), nullif(p ->> 'year', '')::int, v_doi, v_url, nullif(btrim(p ->> 'study_design'), ''),
              nullif(btrim(p ->> 'population'), ''), nullif(btrim(p ->> 'comparison'), ''), nullif(btrim(p ->> 'benefits'), ''), nullif(btrim(p ->> 'duration'), ''), nullif(btrim(p ->> 'follow_up'), ''),
              nullif(btrim(p ->> 'limitations'), ''), v_areas, v_conds, nullif(btrim(p ->> 'license_note'), ''), (select auth.uid()),
              nullif(btrim(p ->> 'intervention'), ''), nullif(btrim(p ->> 'outcome_measure'), ''), nullif(btrim(p ->> 'phase'), ''), v_ckeys) returning id into v_id;
    return v_id;
  end if;
  select * into r from public.evidence_references where id = p_id and org_id = v_org for update;
  if not found then raise exception 'referência não encontrada'; end if;
  if r.status = 'retired' then raise exception 'referência aposentada não pode ser editada'; end if;
  if r.proposed_by is distinct from (select auth.uid()) and not private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.evidence_references set title = btrim(p ->> 'title'), authors = nullif(btrim(p ->> 'authors'), ''), journal = nullif(btrim(p ->> 'journal'), ''), year = nullif(p ->> 'year', '')::int,
      doi = v_doi, url = v_url, study_design = nullif(btrim(p ->> 'study_design'), ''), population = nullif(btrim(p ->> 'population'), ''), comparison = nullif(btrim(p ->> 'comparison'), ''),
      benefits = nullif(btrim(p ->> 'benefits'), ''), duration_text = nullif(btrim(p ->> 'duration'), ''), follow_up_text = nullif(btrim(p ->> 'follow_up'), ''), limitations = nullif(btrim(p ->> 'limitations'), ''),
      intervention = nullif(btrim(p ->> 'intervention'), ''), outcome_measure = nullif(btrim(p ->> 'outcome_measure'), ''), phase = nullif(btrim(p ->> 'phase'), ''), condition_keys = v_ckeys,
      area_keys = v_areas, conditions = v_conds, license_note = nullif(btrim(p ->> 'license_note'), ''), updated_at = now(),
      -- editar uma ficha aprovada a devolve para revisão (nova versão); o paciente deixa de vê-la até nova aprovação
      status = case when r.status = 'approved' then 'draft' else r.status end, version = case when r.status = 'approved' then r.version + 1 else r.version end,
      reviewed_by = case when r.status = 'approved' then null else r.reviewed_by end, reviewed_at = case when r.status = 'approved' then null else r.reviewed_at end,
      source_verified_at = case when r.status = 'approved' then null else r.source_verified_at end
    where id = p_id;
  return p_id;
end $$;

-- sugestões: casa por condição do catálogo (peso 8), por citação textual (5) e por área (3). O motivo de cada uma é mostrado; a profissional confirma a pertinência.
create or replace function public.evidence_suggest(p_presentation uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.evaluation_presentations; v_text text; v_keys text[];
begin
  select * into p from public.evaluation_presentations where id = p_presentation and org_id = private.current_org();
  if not found then raise exception 'apresentação não encontrada' using errcode = '42501'; end if;
  perform private.presentation_can_edit(p.enrollment_id);
  select coalesce(array_agg(c.condition_key) filter (where c.condition_key is not null and c.status <> 'not_informed'), '{}'),
         lower(coalesce(string_agg(coalesce(cat.label, c.free_text) || ' ' || array_to_string(coalesce(cat.synonyms, '{}'), ' ') || ' ' || coalesce((select s ->> 'label' from jsonb_array_elements(coalesce(cat.subtypes, '[]'::jsonb)) s where s ->> 'key' = c.subtype_key limit 1), ''), ' ') filter (where c.status <> 'not_informed'), ''))
    into v_keys, v_text from public.presentation_conditions c left join public.physio_conditions cat on cat.key = c.condition_key where c.presentation_id = p.id;
  v_text := v_text || ' ' || lower(coalesce(p.condition_text, '') || ' ' || coalesce(p.complaint, ''));
  return coalesce((
    select jsonb_agg(x.j order by x.score desc, x.title) from (
      select r.title,
             (select count(*) from unnest(r.area_keys) k where k = any (p.area_keys)) * 3
           + (select count(*) from unnest(r.conditions) c where length(btrim(c)) >= 3 and v_text like '%' || lower(btrim(c)) || '%') * 5
           + (select count(*) from unnest(r.condition_keys) k where k = any (v_keys)) * 8 as score,
             private.evidence_json(r) || jsonb_build_object(
               'why', to_jsonb(array_remove(array[
                  case when exists (select 1 from unnest(r.condition_keys) k where k = any (v_keys)) then 'Condição do cadastro: ' || (select string_agg(pc.label, ', ') from public.physio_conditions pc where pc.key = any (r.condition_keys) and pc.key = any (v_keys)) end,
                  case when exists (select 1 from unnest(r.area_keys) k where k = any (p.area_keys)) then 'Mesma área: ' || (select string_agg(a.label, ', ') from public.physio_areas a where a.key = any (r.area_keys) and a.key = any (p.area_keys)) end,
                  case when exists (select 1 from unnest(r.conditions) c where length(btrim(c)) >= 3 and v_text like '%' || lower(btrim(c)) || '%') then 'Condição citada na ficha aparece na avaliação: ' || (select string_agg(btrim(c), ', ') from unnest(r.conditions) c where length(btrim(c)) >= 3 and v_text like '%' || lower(btrim(c)) || '%') end,
                  case when r.population is not null then 'Confira a população estudada: ' || r.population end,
                  case when r.phase is not null then 'Fase estudada: ' || r.phase end], null)),
               'picked', exists (select 1 from public.presentation_evidence pe where pe.presentation_id = p.id and pe.evidence_id = r.id)) as j
        from public.evidence_references r where r.org_id = p.org_id and r.status = 'approved'
    ) x where x.score > 0 or ((select coalesce(array_length(p.area_keys, 1), 0)) = 0 and coalesce(array_length(v_keys, 1), 0) = 0)), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- 5. retrato do paciente e visão da profissional (com condições, contexto e plano inicial)
create or replace function private.presentation_patient_payload(p public.evaluation_presentations) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return jsonb_build_object(
    'areas', coalesce((select jsonb_agg(jsonb_build_object('key', a.key, 'label', a.label) order by a.sort) from public.physio_areas a where a.key = any (p.area_keys)), '[]'::jsonb),
    'reported', jsonb_build_object('complaint', p.complaint, 'symptom_duration', p.symptom_duration, 'limitations', p.limitations, 'activities', p.activities),
    'assessed', jsonb_build_object('condition_kind', p.condition_kind, 'condition_text', p.condition_text,
                  'conditions', coalesce((select jsonb_agg(e - 'id') from jsonb_array_elements(private.presentation_conditions_json(p.id)) e), '[]'::jsonb),
                  'context', coalesce((select jsonb_agg(private.context_tag_label(t)) from unnest(p.context_tags) t where private.context_tag_label(t) is not null), '[]'::jsonb)),
    'goal', case when p.goal_title is not null then jsonb_build_object('title', p.goal_title, 'target_date', p.goal_target_date) end,
    'plan', jsonb_build_object('freq_per_week', p.freq_per_week, 'duration_weeks', p.duration_weeks, 'routine', p.routine_text, 'reassessment_on', p.reassessment_on, 'reassessment_criteria', p.reassessment_criteria,
                  'initial_sessions', p.initial_sessions, 'session_minutes', p.session_minutes, 'approach', p.approach_text),
    'evidence', coalesce((select jsonb_agg(private.evidence_json(r) || jsonb_build_object('relation', pe.rationale, 'differences', pe.differences) order by pe.position, pe.picked_at)
                            from public.presentation_evidence pe join public.evidence_references r on r.id = pe.evidence_id where pe.presentation_id = p.id and r.status = 'approved'), '[]'::jsonb));
end $$;

create or replace function private.presentation_staff_json(p public.evaluation_presentations) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_payload jsonb := private.presentation_patient_payload(p); v_last jsonb; v_missing text[] := '{}';
begin
  select payload into v_last from public.presentation_versions where presentation_id = p.id order by version desc limit 1;
  if coalesce(array_length(p.area_keys, 1), 0) = 0 then v_missing := array_append(v_missing, 'Escolha ao menos uma área da fisioterapia'::text); end if;
  if coalesce(btrim(p.complaint), '') = '' then v_missing := array_append(v_missing, 'Registre a queixa principal (relatada pelo paciente)'::text); end if;
  if coalesce(btrim(p.goal_title), '') = '' then v_missing := array_append(v_missing, 'Defina o objetivo do paciente'::text); end if;
  return jsonb_build_object('id', p.id, 'enrollment_id', p.enrollment_id, 'person_id', p.person_id, 'rev', p.rev, 'status', p.status, 'published_version', p.published_version,
    'published_at', p.published_at, 'updated_at', p.updated_at, 'area_keys', to_jsonb(p.area_keys),
    'complaint', p.complaint, 'symptom_duration', p.symptom_duration, 'limitations', p.limitations, 'activities', p.activities,
    'condition_kind', p.condition_kind, 'condition_text', p.condition_text, 'goal_title', p.goal_title, 'goal_target_date', p.goal_target_date,
    'freq_per_week', p.freq_per_week, 'duration_weeks', p.duration_weeks, 'routine_text', p.routine_text, 'reassessment_on', p.reassessment_on, 'reassessment_criteria', p.reassessment_criteria,
    'initial_sessions', p.initial_sessions, 'session_minutes', p.session_minutes, 'approach_text', p.approach_text, 'context_tags', to_jsonb(p.context_tags),
    'conditions', private.presentation_conditions_json(p.id),
    'internal_notes', p.internal_notes,
    'patient_payload', v_payload, 'missing', to_jsonb(v_missing), 'can_publish', coalesce(array_length(v_missing, 1), 0) = 0,
    'unpublished_changes', v_last is distinct from v_payload,
    'evidence_picked', coalesce((select jsonb_agg(jsonb_build_object('evidence', private.evidence_json(r), 'rationale', pe.rationale, 'differences', pe.differences, 'position', pe.position) order by pe.position, pe.picked_at)
                                   from public.presentation_evidence pe join public.evidence_references r on r.id = pe.evidence_id where pe.presentation_id = p.id), '[]'::jsonb),
    'cases_picked', coalesce((select jsonb_agg(private.case_json(c) || jsonb_build_object('status', c.status) order by pc.picked_at) from public.presentation_cases pc join public.educational_cases c on c.id = pc.case_id where pc.presentation_id = p.id), '[]'::jsonb));
end $$;

create or replace function public.presentation_save(p_id uuid, p_rev int, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.evaluation_presentations; k text; v_areas text[]; v_tags text[]; v_lk text; v_ck text;
  v_allowed text[] := array['area_keys', 'complaint', 'symptom_duration', 'limitations', 'activities', 'condition_kind', 'condition_text', 'goal_title', 'goal_target_date', 'freq_per_week', 'duration_weeks', 'routine_text',
                            'reassessment_on', 'reassessment_criteria', 'internal_notes', 'context_tags', 'initial_sessions', 'session_minutes', 'approach_text', 'conditions'];
begin
  select * into p from public.evaluation_presentations where id = p_id and org_id = private.current_org() for update;
  if not found then raise exception 'apresentação não encontrada' using errcode = '42501'; end if;
  perform private.presentation_can_edit(p.enrollment_id);
  if jsonb_typeof(p_patch) <> 'object' then raise exception 'conteúdo inválido'; end if;
  for k in select jsonb_object_keys(p_patch) loop if not (k = any (v_allowed)) then raise exception 'campo não permitido: %', k; end if; end loop;
  if p.rev <> p_rev then raise exception 'EDICAO_CONFLITO: a apresentação foi alterada em outra tela (revisão % ≠ %)', p.rev, p_rev using errcode = 'P0010'; end if;
  if p_patch ? 'area_keys' then
    select coalesce(array_agg(x), '{}') into v_areas from jsonb_array_elements_text(p_patch -> 'area_keys') x;
    if exists (select 1 from unnest(v_areas) a where not exists (select 1 from public.physio_areas pa where pa.key = a)) then raise exception 'área inválida'; end if;
    p.area_keys := v_areas;
  end if;
  if p_patch ? 'context_tags' then
    select coalesce(array_agg(distinct x), '{}') into v_tags from jsonb_array_elements_text(p_patch -> 'context_tags') x;
    if exists (select 1 from unnest(v_tags) t where private.context_tag_label(t) is null) then raise exception 'contexto inválido'; end if;
    p.context_tags := v_tags;
  end if;
  if p_patch ? 'complaint' then p.complaint := nullif(btrim(p_patch ->> 'complaint'), ''); end if;
  if p_patch ? 'symptom_duration' then p.symptom_duration := nullif(btrim(p_patch ->> 'symptom_duration'), ''); end if;
  if p_patch ? 'limitations' then p.limitations := nullif(btrim(p_patch ->> 'limitations'), ''); end if;
  if p_patch ? 'activities' then p.activities := nullif(btrim(p_patch ->> 'activities'), ''); end if;
  if p_patch ? 'condition_kind' then p.condition_kind := nullif(p_patch ->> 'condition_kind', ''); end if;
  if p_patch ? 'condition_text' then p.condition_text := nullif(btrim(p_patch ->> 'condition_text'), ''); end if;
  if p_patch ? 'goal_title' then p.goal_title := nullif(btrim(p_patch ->> 'goal_title'), ''); end if;
  if p_patch ? 'goal_target_date' then p.goal_target_date := nullif(p_patch ->> 'goal_target_date', '')::date; end if;
  if p_patch ? 'freq_per_week' then p.freq_per_week := nullif(p_patch ->> 'freq_per_week', '')::smallint; end if;
  if p_patch ? 'duration_weeks' then p.duration_weeks := nullif(p_patch ->> 'duration_weeks', '')::smallint; end if;
  if p_patch ? 'initial_sessions' then p.initial_sessions := nullif(p_patch ->> 'initial_sessions', '')::smallint; end if;
  if p_patch ? 'session_minutes' then p.session_minutes := nullif(p_patch ->> 'session_minutes', '')::smallint; end if;
  if p_patch ? 'routine_text' then p.routine_text := nullif(btrim(p_patch ->> 'routine_text'), ''); end if;
  if p_patch ? 'approach_text' then p.approach_text := nullif(btrim(p_patch ->> 'approach_text'), ''); end if;
  if p_patch ? 'reassessment_on' then p.reassessment_on := nullif(p_patch ->> 'reassessment_on', '')::date; end if;
  if p_patch ? 'reassessment_criteria' then p.reassessment_criteria := nullif(btrim(p_patch ->> 'reassessment_criteria'), ''); end if;
  if p_patch ? 'internal_notes' then p.internal_notes := nullif(btrim(p_patch ->> 'internal_notes'), ''); end if;
  -- condições estruturadas: substituem as anteriores; o resumo legado (kind/text) é derivado da principal para o resto do sistema continuar igual
  if p_patch ? 'conditions' then
    perform private.presentation_set_conditions(p, p_patch -> 'conditions');
    select o_kind, o_text into p.condition_kind, p.condition_text from private.presentation_conditions_legacy(p.id);
  end if;
  if p.condition_text is not null and p.condition_kind is null then raise exception 'diga se a condição foi avaliada ou é uma hipótese'; end if;
  update public.evaluation_presentations set area_keys = p.area_keys, complaint = p.complaint, symptom_duration = p.symptom_duration, limitations = p.limitations, activities = p.activities,
      condition_kind = p.condition_kind, condition_text = p.condition_text, goal_title = p.goal_title, goal_target_date = p.goal_target_date, freq_per_week = p.freq_per_week, duration_weeks = p.duration_weeks,
      initial_sessions = p.initial_sessions, session_minutes = p.session_minutes, approach_text = p.approach_text, context_tags = p.context_tags,
      routine_text = p.routine_text, reassessment_on = p.reassessment_on, reassessment_criteria = p.reassessment_criteria, internal_notes = p.internal_notes,
      rev = p.rev + 1, updated_at = now(), updated_by = (select auth.uid()) where id = p_id returning * into p;
  return jsonb_build_object('rev', p.rev, 'saved_at', p.updated_at);
end $$;

-- catálogo para a tela (busca por nome e sinônimos é feita na tela; aqui vem tudo, com as áreas de cada condição)
create or replace function public.physio_conditions_list() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label, 'synonyms', to_jsonb(c.synonyms), 'subtypes', c.subtypes, 'uses_region', c.uses_region, 'uses_laterality', c.uses_laterality,
           'review_status', c.review_status, 'areas', coalesce((select jsonb_agg(a.area_key order by a.area_key) from public.physio_condition_areas a where a.condition_key = c.key), '[]'::jsonb)) order by c.label), '[]'::jsonb)
    from public.physio_conditions c where (select auth.uid()) is not null
$$;

-- o que o PACIENTE informou ao se cadastrar (respostas do questionário de atendimento): leitura só por quem tem vínculo assistencial; não vira diagnóstico
create or replace function public.presentation_lead_info(p_enrollment uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.patient_enrollments; q record;
begin
  e := private.presentation_can_edit(p_enrollment);
  select l.answers, l.completed_at, l.created_at, l.journey into q from public.quiz_leads l where l.org_id = e.org_id and l.person_id = e.person_id and l.journey = 'atendimento' order by coalesce(l.completed_at, l.created_at) desc limit 1;
  perform private.log_clinical_access(e.person_id, 'professional', 'queixa_cadastro');
  if q.answers is null then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'answered_at', coalesce(q.completed_at, q.created_at),
    'answers', coalesce((select jsonb_agg(jsonb_build_object('key', a.key, 'value', a.value ->> 'value', 'label', a.value ->> 'label') order by a.key) from jsonb_each(q.answers) a where a.key in ('dor_intensidade', 'motivacao_melhora', 'impacto_qualidade_vida', 'atividade_desejada')), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- 6. modelos de plano (editáveis; a profissional confirma ao aplicar — nenhum mínimo universal de sessões)
create table public.plan_templates (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (length(btrim(name)) between 3 and 80),
  area_key text references public.physio_areas(key) on delete set null, condition_key text references public.physio_conditions(key) on delete set null,
  freq_per_week smallint check (freq_per_week is null or freq_per_week between 1 and 14), duration_weeks smallint check (duration_weeks is null or duration_weeks between 1 and 104),
  initial_sessions smallint check (initial_sessions is null or initial_sessions between 1 and 200), session_minutes smallint check (session_minutes is null or session_minutes between 10 and 240),
  routine_text text check (routine_text is null or length(routine_text) <= 2000), approach_text text check (approach_text is null or length(approach_text) <= 2000),
  reassessment_criteria text check (reassessment_criteria is null or length(reassessment_criteria) <= 1000),
  active boolean not null default true, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.plan_templates enable row level security; revoke all on public.plan_templates from public, anon, authenticated;
create or replace function private.is_clinical_staff() returns boolean language sql stable security definer set search_path = '' as $$
  select private.current_org() is not null and (private.has_org_role(array['manager', 'ops_admin']::public.app_role[])
         or exists (select 1 from public.role_assignments ra where ra.user_id = (select auth.uid()) and ra.role = 'physio' and ra.revoked_at is null))
$$;
create or replace function public.plan_template_list() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_clinical_staff() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'area_key', t.area_key, 'condition_key', t.condition_key, 'freq_per_week', t.freq_per_week, 'duration_weeks', t.duration_weeks,
           'initial_sessions', t.initial_sessions, 'session_minutes', t.session_minutes, 'routine_text', t.routine_text, 'approach_text', t.approach_text, 'reassessment_criteria', t.reassessment_criteria,
           'mine', t.created_by = (select auth.uid())) order by t.name) from public.plan_templates t where t.org_id = private.current_org() and t.active), '[]'::jsonb);
end $$;
create or replace function public.plan_template_save(p_id uuid, p jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); t public.plan_templates; v_id uuid;
begin
  if not private.is_clinical_staff() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if length(btrim(coalesce(p ->> 'name', ''))) < 3 then raise exception 'dê um nome ao modelo'; end if;
  if p_id is null then
    insert into public.plan_templates (org_id, name, area_key, condition_key, freq_per_week, duration_weeks, initial_sessions, session_minutes, routine_text, approach_text, reassessment_criteria, created_by)
      values (v_org, btrim(p ->> 'name'), nullif(p ->> 'area_key', ''), nullif(p ->> 'condition_key', ''), nullif(p ->> 'freq_per_week', '')::smallint, nullif(p ->> 'duration_weeks', '')::smallint,
              nullif(p ->> 'initial_sessions', '')::smallint, nullif(p ->> 'session_minutes', '')::smallint, nullif(btrim(p ->> 'routine_text'), ''), nullif(btrim(p ->> 'approach_text'), ''),
              nullif(btrim(p ->> 'reassessment_criteria'), ''), (select auth.uid())) returning id into v_id;
    return v_id;
  end if;
  select * into t from public.plan_templates where id = p_id and org_id = v_org for update; if not found then raise exception 'modelo não encontrado'; end if;
  if t.created_by is distinct from (select auth.uid()) and not private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.plan_templates set name = btrim(p ->> 'name'), area_key = nullif(p ->> 'area_key', ''), condition_key = nullif(p ->> 'condition_key', ''), freq_per_week = nullif(p ->> 'freq_per_week', '')::smallint,
      duration_weeks = nullif(p ->> 'duration_weeks', '')::smallint, initial_sessions = nullif(p ->> 'initial_sessions', '')::smallint, session_minutes = nullif(p ->> 'session_minutes', '')::smallint,
      routine_text = nullif(btrim(p ->> 'routine_text'), ''), approach_text = nullif(btrim(p ->> 'approach_text'), ''), reassessment_criteria = nullif(btrim(p ->> 'reassessment_criteria'), ''), updated_at = now() where id = p_id;
  return p_id;
end $$;
create or replace function public.plan_template_archive(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare t public.plan_templates;
begin
  if not private.is_clinical_staff() then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into t from public.plan_templates where id = p_id and org_id = private.current_org() for update; if not found then raise exception 'modelo não encontrado'; end if;
  if t.created_by is distinct from (select auth.uid()) and not private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.plan_templates set active = false, updated_at = now() where id = p_id;
end $$;

-- ---------------------------------------------------------------- 7. casos educativos AUTORIZADOS (dados minimizados; só a gestão aprova/revoga; sem identificação; nunca entre organizações)
create table public.educational_cases (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete restrict,
  title text not null check (length(btrim(title)) between 5 and 160),
  initial_situation text not null check (length(btrim(initial_situation)) between 10 and 800),
  objective text not null check (length(btrim(objective)) between 5 and 400),
  measure_label text not null check (length(btrim(measure_label)) between 2 and 120), measure_unit text check (measure_unit is null or length(measure_unit) <= 40),
  baseline_value numeric not null, observed_value numeric not null,
  interval_text text not null check (length(btrim(interval_text)) between 2 and 120),
  sessions_done int check (sessions_done is null or sessions_done between 0 and 1000),
  limitations text not null check (length(btrim(limitations)) between 20 and 800),             -- limites da comparação: obrigatório
  area_keys text[] not null default '{}', condition_keys text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'approved', 'revoked')),
  authorization_ref text check (authorization_ref is null or length(btrim(authorization_ref)) between 3 and 300), authorized_on date,
  identifiers_removed boolean not null default false,
  reviewed_by uuid references auth.users(id) on delete set null, reviewed_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null, revoked_at timestamptz, revoke_reason text check (revoke_reason is null or length(btrim(revoke_reason)) between 3 and 400),
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (status <> 'approved' or (authorization_ref is not null and authorized_on is not null and identifiers_removed and reviewed_by is not null and reviewed_at is not null)),
  check (status <> 'revoked' or (revoked_by is not null and revoked_at is not null and revoke_reason is not null))
);
create index educational_cases_org_idx on public.educational_cases (org_id, status);
create table public.presentation_cases (
  presentation_id uuid not null references public.evaluation_presentations(id) on delete cascade, case_id uuid not null references public.educational_cases(id) on delete restrict,
  picked_by uuid references auth.users(id) on delete set null, picked_at timestamptz not null default now(), primary key (presentation_id, case_id)
);
alter table public.educational_cases enable row level security; alter table public.presentation_cases enable row level security;
revoke all on public.educational_cases, public.presentation_cases from public, anon, authenticated;
create trigger audit_educational_cases after insert or update on public.educational_cases for each row execute function private.audit_row('status', 'authorization_ref', 'reviewed_by', 'revoked_by');
do $$ begin
  if to_regprocedure('private.org_fk_guard_attach()') is not null then perform private.org_fk_map_refresh(); perform private.org_fk_guard_attach(); end if;
end $$;

-- visão segura do caso (sem autorização, sem quem criou): é o que o retrato da apresentação carrega
create or replace function private.case_json(c public.educational_cases) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'title', c.title, 'situation', c.initial_situation, 'objective', c.objective, 'measure_label', c.measure_label, 'measure_unit', c.measure_unit,
    'baseline', c.baseline_value, 'observed', c.observed_value, 'interval_text', c.interval_text, 'sessions_done', c.sessions_done, 'limitations', c.limitations,
    'area_keys', to_jsonb(c.area_keys), 'condition_keys', to_jsonb(c.condition_keys),
    'condition_labels', coalesce((select jsonb_agg(pc.label order by pc.label) from public.physio_conditions pc where pc.key = any (c.condition_keys)), '[]'::jsonb))
$$;

create or replace function public.case_save(p_id uuid, p jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); c public.educational_cases; v_id uuid; v_areas text[]; v_ckeys text[];
begin
  if not private.is_clinical_staff() then raise exception 'sem permissão' using errcode = '42501'; end if;
  select coalesce(array_agg(x), '{}') into v_areas from jsonb_array_elements_text(coalesce(p -> 'area_keys', '[]'::jsonb)) x;
  if exists (select 1 from unnest(v_areas) k where not exists (select 1 from public.physio_areas a where a.key = k)) then raise exception 'área inválida'; end if;
  select coalesce(array_agg(x), '{}') into v_ckeys from jsonb_array_elements_text(coalesce(p -> 'condition_keys', '[]'::jsonb)) x;
  if exists (select 1 from unnest(v_ckeys) k where not exists (select 1 from public.physio_conditions pc where pc.key = k)) then raise exception 'condição inválida'; end if;
  if p_id is null then
    insert into public.educational_cases (org_id, title, initial_situation, objective, measure_label, measure_unit, baseline_value, observed_value, interval_text, sessions_done, limitations, area_keys, condition_keys, created_by)
      values (v_org, btrim(p ->> 'title'), btrim(p ->> 'initial_situation'), btrim(p ->> 'objective'), btrim(p ->> 'measure_label'), nullif(btrim(p ->> 'measure_unit'), ''), (p ->> 'baseline_value')::numeric, (p ->> 'observed_value')::numeric,
              btrim(p ->> 'interval_text'), nullif(p ->> 'sessions_done', '')::int, btrim(p ->> 'limitations'), v_areas, v_ckeys, (select auth.uid())) returning id into v_id;
    return v_id;
  end if;
  select * into c from public.educational_cases where id = p_id and org_id = v_org for update; if not found then raise exception 'caso não encontrado'; end if;
  if c.status = 'revoked' then raise exception 'caso revogado não pode ser editado'; end if;
  if c.created_by is distinct from (select auth.uid()) and not private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  -- editar um caso aprovado o devolve ao rascunho: a autorização precisa ser conferida de novo antes de voltar a aparecer
  update public.educational_cases set title = btrim(p ->> 'title'), initial_situation = btrim(p ->> 'initial_situation'), objective = btrim(p ->> 'objective'), measure_label = btrim(p ->> 'measure_label'),
      measure_unit = nullif(btrim(p ->> 'measure_unit'), ''), baseline_value = (p ->> 'baseline_value')::numeric, observed_value = (p ->> 'observed_value')::numeric, interval_text = btrim(p ->> 'interval_text'),
      sessions_done = nullif(p ->> 'sessions_done', '')::int, limitations = btrim(p ->> 'limitations'), area_keys = v_areas, condition_keys = v_ckeys, updated_at = now(),
      status = case when c.status = 'approved' then 'draft' else c.status end, reviewed_by = case when c.status = 'approved' then null else c.reviewed_by end, reviewed_at = case when c.status = 'approved' then null else c.reviewed_at end,
      identifiers_removed = case when c.status = 'approved' then false else c.identifiers_removed end
    where id = p_id;
  return p_id;
end $$;

-- aprovar (confere a autorização específica e a ausência de dados identificáveis) ou revogar (com motivo): só a gestão
create or replace function public.case_review(p_id uuid, p_decision text, p_authorization_ref text default null, p_authorized_on date default null, p_identifiers_removed boolean default false, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); c public.educational_cases;
begin
  if v_org is null or not private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into c from public.educational_cases where id = p_id and org_id = v_org for update; if not found then raise exception 'caso não encontrado'; end if;
  if p_decision = 'approve' then
    if c.status = 'revoked' then raise exception 'caso revogado não volta; crie um novo registro com nova autorização'; end if;
    if length(btrim(coalesce(p_authorization_ref, ''))) < 3 or p_authorized_on is null then raise exception 'registre a autorização específica (documento e data)'; end if;
    if p_authorized_on > current_date then raise exception 'a data da autorização não pode ser futura'; end if;
    if not coalesce(p_identifiers_removed, false) then raise exception 'confirme que o caso não traz dados que identifiquem a pessoa'; end if;
    update public.educational_cases set status = 'approved', authorization_ref = btrim(p_authorization_ref), authorized_on = p_authorized_on, identifiers_removed = true, reviewed_by = (select auth.uid()), reviewed_at = now(), updated_at = now() where id = p_id;
  elsif p_decision = 'revoke' then
    if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'informe o motivo da revogação'; end if;
    update public.educational_cases set status = 'revoked', revoked_by = (select auth.uid()), revoked_at = now(), revoke_reason = btrim(p_note), updated_at = now() where id = p_id;
  elsif p_decision = 'reject' then
    update public.educational_cases set status = 'draft', reviewed_by = null, reviewed_at = null, identifiers_removed = false, updated_at = now() where id = p_id and status <> 'revoked';
  else raise exception 'decisão inválida'; end if;
end $$;

create or replace function public.case_list(p_status text default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_mgr boolean := private.has_org_role(array['manager', 'ops_admin']::public.app_role[]);
begin
  if not private.is_clinical_staff() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(private.case_json(c) || jsonb_build_object('status', c.status, 'authorization_ref', case when v_mgr then c.authorization_ref end, 'authorized_on', case when v_mgr then c.authorized_on end,
                    'revoke_reason', case when v_mgr then c.revoke_reason end, 'mine', c.created_by = (select auth.uid()), 'created_at', c.created_at) order by c.created_at desc)
                     from public.educational_cases c where c.org_id = v_org and (p_status is null or c.status = p_status) and (v_mgr or c.status = 'approved' or c.created_by = (select auth.uid()))), '[]'::jsonb);
end $$;

create or replace function public.case_suggest(p_presentation uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.evaluation_presentations; v_keys text[];
begin
  select * into p from public.evaluation_presentations where id = p_presentation and org_id = private.current_org(); if not found then raise exception 'apresentação não encontrada' using errcode = '42501'; end if;
  perform private.presentation_can_edit(p.enrollment_id);
  select coalesce(array_agg(condition_key) filter (where condition_key is not null and status <> 'not_informed'), '{}') into v_keys from public.presentation_conditions where presentation_id = p.id;
  return coalesce((select jsonb_agg(x.j order by x.score desc, x.t) from (
    select c.title as t, (select count(*) from unnest(c.condition_keys) k where k = any (v_keys)) * 8 + (select count(*) from unnest(c.area_keys) k where k = any (p.area_keys)) * 3 as score,
           private.case_json(c) || jsonb_build_object('picked', exists (select 1 from public.presentation_cases pc where pc.presentation_id = p.id and pc.case_id = c.id),
             'why', to_jsonb(array_remove(array[
               case when exists (select 1 from unnest(c.condition_keys) k where k = any (v_keys)) then 'Mesma condição do cadastro: ' || (select string_agg(pcn.label, ', ') from public.physio_conditions pcn where pcn.key = any (c.condition_keys) and pcn.key = any (v_keys)) end,
               case when exists (select 1 from unnest(c.area_keys) k where k = any (p.area_keys)) then 'Mesma área: ' || (select string_agg(a.label, ', ') from public.physio_areas a where a.key = any (c.area_keys) and a.key = any (p.area_keys)) end], null))) as j
      from public.educational_cases c where c.org_id = p.org_id and c.status = 'approved') x
    where x.score > 0), '[]'::jsonb);
end $$;

create or replace function public.presentation_case_pick(p_id uuid, p_case uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.evaluation_presentations; c public.educational_cases;
begin
  select * into p from public.evaluation_presentations where id = p_id and org_id = private.current_org() for update; if not found then raise exception 'apresentação não encontrada' using errcode = '42501'; end if;
  perform private.presentation_can_edit(p.enrollment_id);
  select * into c from public.educational_cases where id = p_case and org_id = p.org_id;
  if not found or c.status <> 'approved' then raise exception 'só casos educativos APROVADOS e com autorização vigente podem ser usados'; end if;
  if (select count(*) from public.presentation_cases where presentation_id = p_id and case_id <> p_case) >= 2 then raise exception 'use no máximo dois casos educativos'; end if;
  insert into public.presentation_cases (presentation_id, case_id, picked_by) values (p_id, p_case, (select auth.uid())) on conflict do nothing;
  update public.evaluation_presentations set rev = rev + 1, updated_at = now(), updated_by = (select auth.uid()) where id = p_id returning * into p;
  return private.presentation_staff_json(p);
end $$;
create or replace function public.presentation_case_unpick(p_id uuid, p_case uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.evaluation_presentations;
begin
  select * into p from public.evaluation_presentations where id = p_id and org_id = private.current_org() for update; if not found then raise exception 'apresentação não encontrada' using errcode = '42501'; end if;
  perform private.presentation_can_edit(p.enrollment_id);
  delete from public.presentation_cases where presentation_id = p_id and case_id = p_case;
  update public.evaluation_presentations set rev = rev + 1, updated_at = now(), updated_by = (select auth.uid()) where id = p_id returning * into p;
  return private.presentation_staff_json(p);
end $$;

-- ---------------------------------------------------------------- 8. orçamento do documento (produtos e preços EXISTENTES; não cria venda nem lançamento; o desconto respeita o limite autorizado no produto)
create or replace function private.deck_quote_offer(e public.patient_enrollments, p_product uuid, p_quote jsonb, p_plan_sessions int) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v public.products; q jsonb := coalesce(p_quote, '{}'::jsonb); v_qty int; v_src text; v_sub bigint; v_disc bigint; v_total bigint; v_n int; v_first date; v_valid date; v_methods text[]; v_inst jsonb := '[]'::jsonb;
  v_covered int; v_pkg boolean; i int; v_base bigint; v_rem bigint;
begin
  if p_product is null then return null; end if;
  select * into v from public.products where id = p_product and org_id = e.org_id and active;
  if v.id is null then raise exception 'escolha um produto ativo da organização' using errcode = '22023'; end if;
  v_pkg := v.kind::text in ('package', 'plan');
  -- quantidade: manual quando a profissional define; senão pacote = 1 e serviço avulso = sessões do plano inicial (acompanha as mudanças do plano)
  if coalesce(q ->> 'quantity_source', '') = 'manual' and (q ->> 'quantity') is not null then v_qty := (q ->> 'quantity')::int; v_src := 'manual';
  else v_qty := case when v_pkg then 1 else greatest(coalesce(p_plan_sessions, 1), 1) end; v_src := 'auto'; end if;
  if v_qty < 1 or v_qty > 200 then raise exception 'quantidade inválida (1 a 200)' using errcode = '22023'; end if;
  v_sub := v.price_cents * v_qty;
  v_disc := coalesce(nullif(q ->> 'discount_cents', '')::bigint, 0);
  if v_disc < 0 or v_disc > v_sub then raise exception 'desconto inválido' using errcode = '22023'; end if;
  if v_disc > floor(v_sub * v.max_discount_pct / 100.0) then raise exception 'desconto acima do autorizado para este produto (máximo % %% do valor)', v.max_discount_pct using errcode = '22023'; end if;
  v_total := v_sub - v_disc;
  v_n := coalesce(nullif(q ->> 'installments_count', '')::int, 1); if v_n < 1 or v_n > 12 then raise exception 'parcelas: de 1 a 12' using errcode = '22023'; end if;
  v_first := nullif(q ->> 'first_due', '')::date; if v_first is not null and v_first < current_date then raise exception 'o primeiro vencimento não pode estar no passado' using errcode = '22023'; end if;
  v_valid := coalesce(nullif(q ->> 'valid_until', '')::date, current_date + 15); if v_valid < current_date then raise exception 'a validade da proposta não pode estar no passado' using errcode = '22023'; end if;
  v_methods := coalesce((select array_agg(distinct x) from jsonb_array_elements_text(coalesce(q -> 'payment_methods', '["pix"]'::jsonb)) x), '{}');
  if exists (select 1 from unnest(v_methods) m where m not in ('pix', 'dinheiro', 'cartao', 'transferencia')) then raise exception 'forma de pagamento inválida' using errcode = '22023'; end if;
  if coalesce(array_length(v_methods, 1), 0) = 0 then raise exception 'escolha ao menos uma forma de pagamento' using errcode = '22023'; end if;
  v_base := v_total / v_n; v_rem := v_total - v_base * v_n;
  for i in 1..v_n loop
    v_inst := v_inst || jsonb_build_array(jsonb_build_object('no', i, 'amount_cents', v_base + case when i = 1 then v_rem else 0 end, 'due_date', case when v_first is null then null else (v_first + ((i - 1) || ' months')::interval)::date end));
  end loop;
  v_covered := case when v_pkg then coalesce(v.sessions_count, 0) * v_qty else v_qty end;
  return jsonb_build_object('product_id', v.id, 'name', v.name, 'kind', v.kind, 'price_cents', v.price_cents, 'sessions_count', v.sessions_count, 'validity_days', v.validity_days,
    'per_session_cents', case when v_covered > 0 then round(v_total::numeric / v_covered)::bigint end, 'consume_on_no_show', v.consume_on_no_show, 'late_cancel_hours', v.late_cancel_hours, 'quoted_at', now(),
    'quantity', v_qty, 'quantity_source', v_src, 'unit_price_cents', v.price_cents, 'subtotal_cents', v_sub, 'discount_cents', v_disc, 'discount_max_pct', v.max_discount_pct, 'total_cents', v_total,
    'installments_count', v_n, 'first_due', v_first, 'installments', v_inst, 'payment_methods', to_jsonb(v_methods), 'valid_until', v_valid,
    'sessions_covered', v_covered, 'plan_sessions', p_plan_sessions, 'plan_mismatch', (p_plan_sessions is not null and v_covered > 0 and v_covered <> p_plan_sessions));
end $$;

create or replace function public.deck_quote_update(p_id uuid, p_quote jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.presentation_decks; e public.patient_enrollments; v_offer jsonb;
begin
  select * into d from public.presentation_decks where id = p_id; if not found then raise exception 'rascunho não encontrado' using errcode = '42501'; end if;
  e := private.presentation_can_edit(d.enrollment_id);
  if d.status <> 'draft' then raise exception 'só o rascunho pode ser alterado' using errcode = '42501'; end if;
  if d.offer is null then raise exception 'escolha o produto antes de montar o orçamento' using errcode = '22023'; end if;
  v_offer := private.deck_quote_offer(e, (d.offer ->> 'product_id')::uuid, coalesce(p_quote, '{}'::jsonb), nullif(d.snapshot ->> 'planned_sessions', '')::int);
  update public.presentation_decks set offer = v_offer, updated_at = now() where id = d.id returning * into d;
  return private.deck_json(d);
end $$;

-- ---------------------------------------------------------------- 9. deck: retrato com casos autorizados e sessões do plano inicial; seleção ganha "cases"; casos revogados somem da leitura
-- marca para o documento: com o white label, a marca da organização; sem ele, a marca padrão da HP (a main tem uma só organização).
create or replace function private.deck_clinic(p_org uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if to_regprocedure('private.org_brand_json(uuid)') is not null then
    execute 'select private.org_brand_json($1) - ''org_id'' - ''texts'' - ''version'' - ''legal_name'' - ''logo_dark_path'' - ''color_ink'' - ''email_from_name'' - ''support_phone''' into v using p_org;
    if v is not null then return v; end if;
  end if;
  return jsonb_build_object('name', 'HP Fisioterapia', 'logo_path', null, 'color_primary', null, 'support_email', null, 'website_url', null, 'is_default_brand', true);
end $$;

create or replace function private.deck_default_selection(p_snapshot jsonb, p_offer jsonb) returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('goals', true, 'start', true, 'path', true, 'evolution', true, 'app', true, 'videos', true, 'continuity', true,
    'evidence', jsonb_array_length(coalesce(p_snapshot #> '{presentation,content,evidence}', '[]'::jsonb)) > 0, 'cases', jsonb_array_length(coalesce(p_snapshot -> 'cases', '[]'::jsonb)) > 0,
    'plan', true, 'commercial', p_offer is not null, 'next', true)
$$;

create or replace function private.deck_snapshot(e public.patient_enrollments, p public.evaluation_presentations) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_payload jsonb; v_ver int; raw jsonb := '{}'::jsonb; x jsonb; v_name text; v_planned int;
begin
  select payload, version into v_payload, v_ver from public.presentation_versions where presentation_id = p.id and version = p.published_version;
  select coalesce(nullif(btrim(preferred_name), ''), full_name) into v_name from public.people where id = e.person_id;
  begin x := public.presentation_preview_home(e.person_id); raw := raw || jsonb_build_object('home', x); exception when others then null; end;
  begin x := public.prof_patient_evolution(e.person_id); raw := raw || jsonb_build_object('evo', x); exception when others then null; end;
  begin x := public.prof_training(e.person_id); raw := raw || jsonb_build_object('trn', x); exception when others then null; end;
  begin x := public.professional_journey(e.person_id); raw := raw || jsonb_build_object('jny', x); exception when others then null; end;
  begin x := public.presentation_preview_appointments(e.person_id); raw := raw || jsonb_build_object('appts', x); exception when others then null; end;
  begin x := public.prof_journey_plan(e.person_id); raw := raw || jsonb_build_object('plan', x); exception when others then null; end;
  begin x := public.prof_education(e.person_id); raw := raw || jsonb_build_object('edu', x); exception when others then null; end;
  -- sessões previstas: as do PLANO INICIAL proposto nesta avaliação; sem elas, as do plano já existente do paciente (nunca calculadas por frequência × semanas)
  v_planned := coalesce(nullif(v_payload #>> '{plan,initial_sessions}', '')::int, nullif(raw #>> '{plan,plan,planned_sessions}', '')::int);
  return jsonb_build_object(
    'clinic', private.deck_clinic(e.org_id),
    'patient', jsonb_build_object('name', v_name, 'first_name', split_part(v_name, ' ', 1)),
    'professional', (select display_name from public.professionals where id = e.professional_id),
    'evaluation_at', (select lower(period) from public.appointments where id = e.evaluation_appointment_id),
    'enrollment_status', e.status,
    'presentation', jsonb_build_object('version', v_ver, 'content', v_payload),
    'measures', coalesce(raw -> 'evo' -> 'series', '[]'::jsonb),
    'planned_sessions', to_jsonb(v_planned),
    'cases', coalesce((select jsonb_agg(private.case_json(c) order by pc.picked_at) from public.presentation_cases pc join public.educational_cases c on c.id = pc.case_id where pc.presentation_id = p.id and c.status = 'approved' and c.org_id = e.org_id), '[]'::jsonb),
    'raw', raw,
    'generated_at', now());
end $$;

create or replace function private.deck_json(d public.presentation_decks) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_snap jsonb := d.snapshot;
begin
  if jsonb_typeof(v_snap -> 'cases') = 'array' then      -- caso revogado depois da aprovação deixa de aparecer (o retrato em si permanece intacto)
    v_snap := jsonb_set(v_snap, '{cases}', coalesce((select jsonb_agg(c) from jsonb_array_elements(v_snap -> 'cases') c
                                                      where exists (select 1 from public.educational_cases ec where ec.id = (c ->> 'id')::uuid and ec.org_id = d.org_id and ec.status = 'approved')), '[]'::jsonb));
  end if;
  return jsonb_build_object('id', d.id, 'status', d.status, 'version', d.version, 'presentation_version', d.presentation_version, 'snapshot', v_snap, 'offer', d.offer, 'selection', d.selection, 'is_demo', d.is_demo,
    'content_hash', d.content_hash, 'created_at', d.created_at, 'updated_at', d.updated_at, 'approved_at', d.approved_at);
end $$;

create or replace function public.deck_draft_generate(p_enrollment uuid, p_product uuid default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.patient_enrollments; p public.evaluation_presentations; v_snap jsonb; v_offer jsonb; v_prev jsonb; r public.presentation_decks;
begin
  e := private.presentation_can_edit(p_enrollment);
  perform pg_advisory_xact_lock(hashtextextended('deck:' || e.id::text, 0));
  select * into p from public.evaluation_presentations where enrollment_id = e.id;
  if not found or p.published_version = 0 then raise exception 'publique a apresentação antes de gerar a apresentação em PDF' using errcode = '22023'; end if;
  select offer into v_prev from public.presentation_decks where enrollment_id = e.id and status = 'draft';
  v_snap := private.deck_snapshot(e, p);
  -- mesmo produto: reaproveita parâmetros do orçamento (desconto, parcelas, formas, validade) e RECALCULA com o plano atual; produto novo: padrão
  v_offer := private.deck_quote_offer(e, p_product, case when v_prev ->> 'product_id' = p_product::text then v_prev else null end, nullif(v_snap ->> 'planned_sessions', '')::int);
  delete from public.presentation_decks where enrollment_id = e.id and status = 'draft';
  insert into public.presentation_decks (org_id, enrollment_id, person_id, presentation_id, presentation_version, snapshot, offer, selection, is_demo, created_by)
    values (e.org_id, e.id, e.person_id, p.id, p.published_version, v_snap, v_offer, private.deck_default_selection(v_snap, v_offer), (v_snap #>> '{patient,name}') ~* '\(exemplo\)', (select auth.uid())) returning * into r;
  perform private.log_clinical_access(e.person_id, 'professional', 'deck');
  return private.deck_json(r);
end $$;

create or replace function public.deck_draft_update(p_id uuid, p_selection jsonb, p_product uuid default null, p_clear_product boolean default false) returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.presentation_decks; e public.patient_enrollments; k text; v_sel jsonb; v_offer jsonb;
begin
  select * into d from public.presentation_decks where id = p_id; if not found then raise exception 'rascunho não encontrado' using errcode = '42501'; end if;
  e := private.presentation_can_edit(d.enrollment_id);
  if d.status <> 'draft' then raise exception 'só o rascunho pode ser alterado' using errcode = '42501'; end if;
  v_sel := d.selection;
  if p_selection is not null then
    for k in select jsonb_object_keys(p_selection) loop
      if not (v_sel ? k) or jsonb_typeof(p_selection -> k) <> 'boolean' then raise exception 'seleção inválida: %', k using errcode = '22023'; end if;
      v_sel := v_sel || jsonb_build_object(k, p_selection -> k);
    end loop;
  end if;
  v_offer := d.offer;
  if p_clear_product then v_offer := null; v_sel := v_sel || jsonb_build_object('commercial', false);
  elsif p_product is not null then
    v_offer := private.deck_quote_offer(e, p_product, case when d.offer ->> 'product_id' = p_product::text then d.offer else null end, nullif(d.snapshot ->> 'planned_sessions', '')::int);
    if p_selection is null or not (p_selection ? 'commercial') then v_sel := v_sel || jsonb_build_object('commercial', true); end if;
  end if;
  if coalesce((v_sel ->> 'commercial')::boolean, false) and v_offer is null then raise exception 'escolha o produto antes de incluir valores e condições comerciais' using errcode = '22023'; end if;
  update public.presentation_decks set selection = v_sel, offer = v_offer, updated_at = now() where id = d.id returning * into d;
  return private.deck_json(d);
end $$;

-- ---------------------------------------------------------------- 10. permissões: só autenticados executam; nada para anon/public
revoke all on function public.physio_conditions_list(), public.presentation_lead_info(uuid), public.plan_template_list(), public.plan_template_save(uuid, jsonb), public.plan_template_archive(uuid),
  public.case_save(uuid, jsonb), public.case_review(uuid, text, text, date, boolean, text), public.case_list(text), public.case_suggest(uuid), public.presentation_case_pick(uuid, uuid), public.presentation_case_unpick(uuid, uuid),
  public.deck_quote_update(uuid, jsonb) from public, anon;
grant execute on function public.physio_conditions_list(), public.presentation_lead_info(uuid), public.plan_template_list(), public.plan_template_save(uuid, jsonb), public.plan_template_archive(uuid),
  public.case_save(uuid, jsonb), public.case_review(uuid, text, text, date, boolean, text), public.case_list(text), public.case_suggest(uuid), public.presentation_case_pick(uuid, uuid), public.presentation_case_unpick(uuid, uuid),
  public.deck_quote_update(uuid, jsonb) to authenticated;
revoke all on function private.case_json(public.educational_cases), private.deck_quote_offer(public.patient_enrollments, uuid, jsonb, int), private.is_clinical_staff(), private.context_tag_label(text),
  private.presentation_conditions_json(uuid), private.presentation_set_conditions(public.evaluation_presentations, jsonb), private.presentation_conditions_legacy(uuid) from public, anon, authenticated;
