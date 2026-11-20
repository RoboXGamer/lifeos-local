CREATE TABLE automations (
  _id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  definition TEXT NOT NULL,
  nextRunDate TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX idx_automations_workspace ON automations(workspaceId, enabled);
CREATE TABLE automationRuns (
  _id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  automationId TEXT NOT NULL,
  eventKey TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  nextAttempt INTEGER NOT NULL,
  input TEXT NOT NULL,
  result TEXT,
  error TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(automationId, eventKey)
);
CREATE INDEX idx_automation_runs_workspace ON automationRuns(workspaceId, createdAt);
CREATE INDEX idx_automation_runs_due ON automationRuns(status, nextAttempt);
