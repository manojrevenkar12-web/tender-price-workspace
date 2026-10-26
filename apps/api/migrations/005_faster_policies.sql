-- Same rules as 002, cheaper to evaluate on large tenders. A policy that asks "is the parent row
-- visible?" with EXISTS over the parent table lets Postgres plan a semi-join and reuse the
-- parent's own policy, instead of calling a function once per child row (50,000 bid items
-- took 1.9 s that way; see reports/PERFORMANCE.md).

DROP POLICY bid_items_read ON bid_items;
CREATE POLICY bid_items_read ON bid_items FOR SELECT USING (app_system() OR EXISTS (SELECT 1 FROM bids b WHERE b.id = bid_id));

DROP POLICY boq_positions_read ON boq_positions;
CREATE POLICY boq_positions_read ON boq_positions FOR SELECT USING (app_system() OR EXISTS (SELECT 1 FROM tenders t WHERE t.id = tender_id));

DROP POLICY boq_versions_read ON boq_versions;
CREATE POLICY boq_versions_read ON boq_versions FOR SELECT USING (app_system() OR EXISTS (SELECT 1 FROM tenders t WHERE t.id = tender_id));

DROP POLICY position_benchmarks_owner ON position_benchmarks;
CREATE POLICY position_benchmarks_owner ON position_benchmarks FOR SELECT
  USING (app_system() OR EXISTS (SELECT 1 FROM tenders t WHERE t.id = tender_id AND t.org_id = app_org()));
