-- Durable item event identity and internal provenance; effects share the caller's transaction.
CREATE TABLE itemMutationEvents (
  _id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL, itemId TEXT NOT NULL,
  kind TEXT NOT NULL, origin TEXT NOT NULL, sourceId TEXT, createdAt INTEGER NOT NULL
);
CREATE INDEX idx_item_events_origin ON itemMutationEvents(workspaceId,origin,kind,itemId);

-- NULL baselines on older follow-ups deliberately mean ownership is unknown.
ALTER TABLE obligationFollowups ADD COLUMN managedSnapshot TEXT;
ALTER TABLE obligationFollowups ADD COLUMN reconciliation TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE obligationFollowups ADD COLUMN auditReason TEXT NOT NULL DEFAULT '';
ALTER TABLE obligationFollowups ADD COLUMN reconciledAt INTEGER;
CREATE TABLE obligationReviews (
  _id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL, engagementId TEXT NOT NULL,
  commitmentId TEXT NOT NULL, previous TEXT NOT NULL, current TEXT NOT NULL, createdAt INTEGER NOT NULL
);
CREATE INDEX idx_obligation_reviews ON obligationReviews(workspaceId,engagementId,createdAt);
