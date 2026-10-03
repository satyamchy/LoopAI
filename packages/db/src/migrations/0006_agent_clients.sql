-- The MCP server records which client connected. The name comes from the initialize handshake, not from a list in the app.

alter table agent_keys add column if not exists client_name text;
alter table agent_keys add column if not exists client_version text;
alter table agent_keys add column if not exists last_seen_at timestamptz;
