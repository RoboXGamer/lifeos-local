CREATE TABLE projects (
  _id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  itemId TEXT NOT NULL,
  name TEXT NOT NULL,
  goal TEXT NOT NULL,
  audience TEXT NOT NULL,
  valueStatement TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  settings TEXT NOT NULL,
  lastScannedAt INTEGER,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(workspaceId, itemId)
);
CREATE INDEX idx_projects_workspace ON projects(workspaceId);
CREATE TABLE projectSources (
  _id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  projectId TEXT NOT NULL,
  kind TEXT NOT NULL,
  locator TEXT NOT NULL,
  label TEXT NOT NULL,
  content TEXT NOT NULL,
  contentHash TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  capturedAt INTEGER NOT NULL,
  missing INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_projectSources_project ON projectSources(workspaceId, projectId, capturedAt);
CREATE TABLE projectCheckpoints (
  _id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  projectId TEXT NOT NULL,
  itemId TEXT NOT NULL,
  did TEXT NOT NULL,
  failed TEXT NOT NULL,
  whyStopped TEXT NOT NULL,
  next TEXT NOT NULL,
  branch TEXT NOT NULL,
  "commit" TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE INDEX idx_projectCheckpoints_project ON projectCheckpoints(workspaceId, projectId, createdAt);
CREATE TABLE projectPlanTasks (
  projectId TEXT NOT NULL,
  reportKey TEXT NOT NULL,
  stepIndex INTEGER NOT NULL,
  itemId TEXT NOT NULL,
  PRIMARY KEY(projectId, reportKey, stepIndex)
);
