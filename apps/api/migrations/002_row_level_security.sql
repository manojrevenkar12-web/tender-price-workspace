-- Tenancy is enforced by Postgres. Each API request runs in a transaction that sets
-- app.org_id (set_config(..., true)); background jobs that must see everything set
-- app.system = 'on'. A connection that sets neither sees no tenant rows at all.

CREATE FUNCTION app_org() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.org_id', true), '')::uuid
$$;
CREATE FUNCTION app_system() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.system', true), '') = 'on'
$$;

-- A tender is visible to its owner, and to invited companies once it is published.
CREATE FUNCTION can_see_tender(t uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenders WHERE id = t AND (
      org_id = app_org()
      OR (status <> 'draft' AND EXISTS (SELECT 1 FROM invitations i WHERE i.tender_id = t AND i.org_id = app_org()))
    )
  )
$$;
CREATE FUNCTION owns_tender(t uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM tenders WHERE id = t AND org_id = app_org())
$$;
CREATE FUNCTION bid_visible(b uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- A bidder sees its own bid; the buyer sees a bid once it is submitted, never a draft.
  SELECT EXISTS (
    SELECT 1 FROM bids x WHERE x.id = b AND (x.org_id = app_org() OR (x.status = 'submitted' AND owns_tender(x.tender_id)))
  )
$$;

ALTER TABLE tenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenders_read ON tenders FOR SELECT USING (app_system() OR can_see_tender(id));
CREATE POLICY tenders_write ON tenders FOR ALL USING (app_system() OR org_id = app_org()) WITH CHECK (app_system() OR org_id = app_org());

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
CREATE POLICY projects_read ON projects FOR SELECT USING (
  app_system() OR org_id = app_org()
  OR EXISTS (SELECT 1 FROM tenders t WHERE t.project_id = projects.id AND can_see_tender(t.id))
);
CREATE POLICY projects_write ON projects FOR ALL USING (app_system() OR org_id = app_org()) WITH CHECK (app_system() OR org_id = app_org());

ALTER TABLE boq_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE boq_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY boq_versions_read ON boq_versions FOR SELECT USING (app_system() OR can_see_tender(tender_id));
CREATE POLICY boq_versions_write ON boq_versions FOR ALL USING (app_system() OR owns_tender(tender_id)) WITH CHECK (app_system() OR owns_tender(tender_id));

ALTER TABLE boq_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE boq_positions FORCE ROW LEVEL SECURITY;
CREATE POLICY boq_positions_read ON boq_positions FOR SELECT USING (app_system() OR can_see_tender(tender_id));
CREATE POLICY boq_positions_write ON boq_positions FOR ALL USING (app_system() OR owns_tender(tender_id)) WITH CHECK (app_system() OR owns_tender(tender_id));

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY invitations_read ON invitations FOR SELECT USING (app_system() OR org_id = app_org() OR owns_tender(tender_id));
CREATE POLICY invitations_owner ON invitations FOR INSERT WITH CHECK (app_system() OR owns_tender(tender_id));
CREATE POLICY invitations_update ON invitations FOR UPDATE USING (app_system() OR org_id = app_org() OR owns_tender(tender_id));
CREATE POLICY invitations_delete ON invitations FOR DELETE USING (app_system() OR owns_tender(tender_id));

ALTER TABLE bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids FORCE ROW LEVEL SECURITY;
CREATE POLICY bids_read ON bids FOR SELECT USING (
  app_system() OR org_id = app_org() OR (status = 'submitted' AND owns_tender(tender_id))
);
CREATE POLICY bids_insert ON bids FOR INSERT WITH CHECK (app_system() OR org_id = app_org());
CREATE POLICY bids_update ON bids FOR UPDATE USING (app_system() OR org_id = app_org()) WITH CHECK (app_system() OR org_id = app_org());

ALTER TABLE bid_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_items FORCE ROW LEVEL SECURITY;
CREATE POLICY bid_items_read ON bid_items FOR SELECT USING (app_system() OR bid_visible(bid_id));
CREATE POLICY bid_items_write ON bid_items FOR ALL
  USING (app_system() OR EXISTS (SELECT 1 FROM bids b WHERE b.id = bid_id AND b.org_id = app_org()))
  WITH CHECK (app_system() OR EXISTS (SELECT 1 FROM bids b WHERE b.id = bid_id AND b.org_id = app_org()));

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
CREATE POLICY events_read ON events FOR SELECT USING (
  app_system() OR owns_tender(tender_id) OR actor_org = app_org() OR (public AND can_see_tender(tender_id))
);
CREATE POLICY events_insert ON events FOR INSERT WITH CHECK (app_system() OR (actor_org = app_org() AND can_see_tender(tender_id)));
