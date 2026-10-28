CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, login text NOT NULL UNIQUE, name text NOT NULL,
 student_no text UNIQUE, password_hash text NOT NULL, is_admin boolean NOT NULL DEFAULT false,
 disabled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS groups (id integer PRIMARY KEY, name text NOT NULL UNIQUE, sort_order integer NOT NULL UNIQUE);
INSERT INTO groups VALUES (1,'编辑组',1),(2,'视觉组',2),(3,'文案组',3),(4,'联络组',4),(5,'视频号',5) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS memberships (
 user_id uuid NOT NULL REFERENCES users(id), group_id integer NOT NULL REFERENCES groups(id),
 is_reviewer boolean NOT NULL DEFAULT false, PRIMARY KEY(user_id,group_id)
);
CREATE TABLE IF NOT EXISTS periods (month char(7) PRIMARY KEY CHECK(month ~ '^\d{4}-(0[1-9]|1[0-2])$'), rate integer NOT NULL DEFAULT 2500 CHECK(rate = 2500));
CREATE TABLE IF NOT EXISTS group_periods (
 group_id integer NOT NULL REFERENCES groups(id), month char(7) NOT NULL REFERENCES periods(month),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','checked')), checked_by uuid REFERENCES users(id),
 checked_at timestamptz, invalidated_at timestamptz, invalidate_reason text, PRIMARY KEY(group_id,month)
);
CREATE TABLE IF NOT EXISTS records (
 id uuid PRIMARY KEY, student_id uuid NOT NULL REFERENCES users(id), group_id integer NOT NULL REFERENCES groups(id),
 month char(7) NOT NULL REFERENCES periods(month), name text NOT NULL, student_no text NOT NULL,
 content text NOT NULL DEFAULT '', hours_units integer CHECK(hours_units BETWEEN 0 AND 2000000), remark text NOT NULL DEFAULT '',
 confirmed_hours_units integer CHECK(confirmed_hours_units BETWEEN 0 AND 2000000),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','approved','rejected','pending_revision')),
 revision integer NOT NULL DEFAULT 1, last_approved_version_id uuid, reject_reason text, adjust_reason text,
 reviewed_at timestamptz, reviewer_id uuid REFERENCES users(id), created_by uuid NOT NULL REFERENCES users(id),
 submitted_at timestamptz, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS record_group_month ON records(group_id,month,status);
CREATE INDEX IF NOT EXISTS record_student_month ON records(student_id,month);
CREATE TABLE IF NOT EXISTS record_versions (
 id uuid PRIMARY KEY, record_id uuid NOT NULL REFERENCES records(id), revision integer NOT NULL, action text NOT NULL,
 snapshot jsonb NOT NULL, actor_id uuid NOT NULL REFERENCES users(id), note text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS record_history ON record_versions(record_id,revision);
CREATE TABLE IF NOT EXISTS exports (
 id uuid PRIMARY KEY, month char(7) NOT NULL REFERENCES periods(month), version integer NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id), snapshot jsonb NOT NULL, diff jsonb NOT NULL, excluded jsonb NOT NULL,
 idempotency_key text NOT NULL, request_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(month,version), UNIQUE(actor_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS invites (
 token_hash text PRIMARY KEY, group_id integer NOT NULL REFERENCES groups(id), expires_at timestamptz NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), used_by uuid REFERENCES users(id), used_at timestamptz, revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_requests (
 actor_id uuid NOT NULL REFERENCES users(id), operation text NOT NULL, key text NOT NULL,
 request_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,operation,key)
);
CREATE TABLE IF NOT EXISTS auth_attempts (
 key text PRIMARY KEY, count integer NOT NULL, window_start timestamptz NOT NULL
);
