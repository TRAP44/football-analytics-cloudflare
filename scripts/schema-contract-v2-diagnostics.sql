\set ON_ERROR_STOP on

with contract_roles(role_name) as (
  values ('anon'::name), ('authenticated'::name), ('service_role'::name)
),
parts as (
  select 'relations'::text as category,
    'R|' || c.relname || '|kind=' || c.relkind::text
      || '|rls=' || c.relrowsecurity::text
      || '|force_rls=' || c.relforcerowsecurity::text as part
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p','v','m','f','S')

  union all
  select 'columns',
    'C|' || c.table_name || '|' || c.ordinal_position || '|' || c.column_name
      || '|' || c.data_type || '|' || coalesce(c.udt_name,'')
      || '|nullable=' || c.is_nullable || '|default=' || coalesce(c.column_default,'')
      || '|identity=' || coalesce(c.is_identity,'NO')
      || '|identity_generation=' || coalesce(c.identity_generation,'')
      || '|generated=' || coalesce(c.is_generated,'NEVER')
      || '|generation=' || coalesce(c.generation_expression,'')
  from information_schema.columns c where c.table_schema='public'

  union all
  select 'constraints',
    'K|' || c.relname || '|' || pc.conname || '|type=' || pc.contype::text
      || '|' || pg_get_constraintdef(pc.oid,true)
  from pg_constraint pc
  join pg_class c on c.oid=pc.conrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'

  union all
  select 'indexes', 'I|' || tablename || '|' || indexname || '|' || indexdef
  from pg_indexes where schemaname='public'

  union all
  select 'functions',
    'F|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
      || '|result=' || coalesce(pg_get_function_result(p.oid),'')
      || '|kind=' || p.prokind::text || '|volatility=' || p.provolatile::text
      || '|strict=' || p.proisstrict::text || '|definer=' || p.prosecdef::text
      || '|parallel=' || p.proparallel::text
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'

  union all
  select 'policies',
    'P|' || p.tablename || '|' || p.policyname
      || '|permissive=' || coalesce(p.permissive,'')
      || '|cmd=' || coalesce(p.cmd,'')
      || '|roles=' || coalesce(array_to_string(p.roles,','),'')
      || '|qual=' || coalesce(p.qual,'')
      || '|check=' || coalesce(p.with_check,'')
  from pg_policies p where p.schemaname='public'

  union all
  select 'triggers',
    'TR|' || c.relname || '|' || t.tgname || '|' || pg_get_triggerdef(t.oid,true)
  from pg_trigger t
  join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and not t.tgisinternal

  union all
  select 'table_grants',
    'G|' || c.relname || '|role=' || r.role_name::text
      || '|select=' || has_table_privilege(r.role_name::text,c.oid,'SELECT')::text
      || '|insert=' || has_table_privilege(r.role_name::text,c.oid,'INSERT')::text
      || '|update=' || has_table_privilege(r.role_name::text,c.oid,'UPDATE')::text
      || '|delete=' || has_table_privilege(r.role_name::text,c.oid,'DELETE')::text
      || '|truncate=' || has_table_privilege(r.role_name::text,c.oid,'TRUNCATE')::text
      || '|references=' || has_table_privilege(r.role_name::text,c.oid,'REFERENCES')::text
      || '|trigger=' || has_table_privilege(r.role_name::text,c.oid,'TRIGGER')::text
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  cross join contract_roles r
  where n.nspname='public' and c.relkind in ('r','p','v','m','f')

  union all
  select 'sequence_grants',
    'S|' || c.relname || '|role=' || r.role_name::text
      || '|usage=' || has_sequence_privilege(r.role_name::text,c.oid,'USAGE')::text
      || '|select=' || has_sequence_privilege(r.role_name::text,c.oid,'SELECT')::text
      || '|update=' || has_sequence_privilege(r.role_name::text,c.oid,'UPDATE')::text
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  cross join contract_roles r
  where n.nspname='public' and c.relkind='S'

  union all
  select 'function_grants',
    'X|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
      || '|role=' || r.role_name::text
      || '|execute=' || has_function_privilege(r.role_name::text,p.oid,'EXECUTE')::text
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  cross join contract_roles r
  where n.nspname='public'
)
select category, count(*) as parts, md5(string_agg(part,E'\n' order by part)) as fingerprint
from parts
group by category
order by category;
