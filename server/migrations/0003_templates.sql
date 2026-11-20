CREATE TABLE templates (
  _id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  definition TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX idx_templates_workspace ON templates(workspaceId);
CREATE TABLE templateInstances (
  _id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  templateId TEXT NOT NULL,
  templateVersion INTEGER NOT NULL,
  rootItemId TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
