create type public.app_role as enum ('admin', 'user');
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create policy "Users see own roles" on public.user_roles for select to authenticated using (auth.uid() = user_id);

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;

create table public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  message text not null check (char_length(message) between 1 and 4000),
  page text,
  user_agent text,
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.bug_reports to authenticated;
grant all on public.bug_reports to service_role;
alter table public.bug_reports enable row level security;
create policy "Users submit own reports" on public.bug_reports for insert to authenticated with check (auth.uid() = user_id);
create policy "Admins read reports" on public.bug_reports for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "Admins update reports" on public.bug_reports for update to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "Admins delete reports" on public.bug_reports for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

insert into public.user_roles (user_id, role) values ('0ee1f758-5701-4ceb-b900-8b5d48550a77', 'admin');