-- Login columns. 0001 created users with email only.

alter table users add column if not exists username text;
alter table users add column if not exists password_hash text;
alter table users add column if not exists display_name text;
alter table users add column if not exists google_sub text;
alter table users alter column email drop not null;

create unique index if not exists users_username_idx on users (username);
create unique index if not exists users_google_sub_idx on users (google_sub);
