-- Organisations, users, tenders, bills of quantities, invitations and bids.
-- Every tenant-owned table has row-level security forced on, so a query that forgets its
-- organisation sees nothing rather than everything (see 002_row_level_security.sql).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('contractor', 'subcontractor')),
  region     text NOT NULL,
  trades     text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations (id),
  email      text NOT NULL UNIQUE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations (id),
  name       text NOT NULL,
  city       text NOT NULL,
  region     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations (id),
  project_id      uuid NOT NULL REFERENCES projects (id),
  title           text NOT NULL,
  trade           text NOT NULL,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed', 'awarded')),
  deadline        timestamptz,
  current_version int NOT NULL DEFAULT 1,
  awarded_bid_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tenders_org ON tenders (org_id, status);

CREATE TABLE boq_versions (
  tender_id  uuid NOT NULL REFERENCES tenders (id) ON DELETE CASCADE,
  version    int NOT NULL,
  note       text NOT NULL DEFAULT '',
  source     text NOT NULL CHECK (source IN ('gaeb', 'api', 'addendum')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tender_id, version)
);

CREATE TABLE boq_positions (
  tender_id         uuid NOT NULL,
  version           int NOT NULL,
  oz                text NOT NULL,
  ordinal           int NOT NULL,
  section           text[] NOT NULL DEFAULT '{}',
  short_text        text NOT NULL,
  long_text         text NOT NULL DEFAULT '',
  unit              text NOT NULL,
  unit_code         text,
  quantity          numeric(14, 3) NOT NULL CHECK (quantity >= 0),
  kind              text NOT NULL CHECK (kind IN ('normal', 'optional', 'alternative', 'lump')),
  alternative_group text,
  work_hash         text NOT NULL,
  norm_words        text NOT NULL,
  attributes        jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tender_id, version, oz),
  FOREIGN KEY (tender_id, version) REFERENCES boq_versions (tender_id, version) ON DELETE CASCADE
);

CREATE TABLE invitations (
  tender_id  uuid NOT NULL REFERENCES tenders (id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES organizations (id),
  status     text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'viewed', 'declined', 'submitted')),
  invited_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tender_id, org_id)
);
CREATE INDEX invitations_org ON invitations (org_id);

CREATE TABLE bids (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id    uuid NOT NULL REFERENCES tenders (id) ON DELETE CASCADE,
  org_id       uuid NOT NULL REFERENCES organizations (id),
  version      int NOT NULL,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'withdrawn')),
  revision     int NOT NULL DEFAULT 0,
  submitted_at timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tender_id, org_id),
  FOREIGN KEY (tender_id, org_id) REFERENCES invitations (tender_id, org_id)
);

CREATE TABLE bid_items (
  bid_id           uuid NOT NULL REFERENCES bids (id) ON DELETE CASCADE,
  oz               text NOT NULL,
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  PRIMARY KEY (bid_id, oz)
);

ALTER TABLE tenders ADD CONSTRAINT tenders_awarded_bid FOREIGN KEY (awarded_bid_id) REFERENCES bids (id);

-- What happened on a tender, for the activity feed and the live stream. Who may read an
-- event is decided by row-level security, not by the code that streams it.
CREATE TABLE events (
  id        bigserial PRIMARY KEY,
  tender_id uuid NOT NULL REFERENCES tenders (id) ON DELETE CASCADE,
  actor_org uuid NOT NULL REFERENCES organizations (id),
  kind      text NOT NULL,
  public    boolean NOT NULL DEFAULT false,
  payload   jsonb NOT NULL DEFAULT '{}',
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_tender ON events (tender_id, id);

CREATE FUNCTION notify_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('tender_events', json_build_object('tender_id', NEW.tender_id, 'id', NEW.id)::text);
  RETURN NEW;
END $$;
CREATE TRIGGER events_notify AFTER INSERT ON events FOR EACH ROW EXECUTE FUNCTION notify_event();
