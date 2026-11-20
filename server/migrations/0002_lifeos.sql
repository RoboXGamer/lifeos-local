-- 0002_lifeos.sql — local port of the LifeOS domain model.
-- IDs are TEXT (nanoid) because the UI treats them as opaque strings and
-- creates `temp-*` ids for optimistic rows.

CREATE TABLE IF NOT EXISTS profiles (
  _id                 TEXT PRIMARY KEY,
  _creationTime       INTEGER NOT NULL,
  authUserId          TEXT    NOT NULL,
  username            TEXT,
  normalizedUsername  TEXT,
  email               TEXT,
  isAnonymous         INTEGER NOT NULL DEFAULT 1,
  role                TEXT    NOT NULL DEFAULT 'user',
  suspended           INTEGER NOT NULL DEFAULT 0,
  activeWorkspaceId   TEXT,
  usernameChangedAt   INTEGER,
  createdAt           INTEGER NOT NULL,
  updatedAt           INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_authUserId ON profiles (authUserId);

CREATE TABLE IF NOT EXISTS workspaces (
  _id           TEXT PRIMARY KEY,
  _creationTime INTEGER NOT NULL,
  ownerId       TEXT,
  name          TEXT    NOT NULL,
  archived      INTEGER NOT NULL DEFAULT 0,
  createdAt     INTEGER NOT NULL,
  updatedAt     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces (ownerId, archived);

CREATE TABLE IF NOT EXISTS areas (
  _id           TEXT PRIMARY KEY,
  _creationTime INTEGER NOT NULL,
  workspaceId   TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  icon          TEXT    NOT NULL,
  color         TEXT    NOT NULL,
  description   TEXT,
  archived      INTEGER NOT NULL DEFAULT 0,
  createdAt     INTEGER NOT NULL,
  updatedAt     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_areas_workspace ON areas (workspaceId, archived);

CREATE TABLE IF NOT EXISTS items (
  _id            TEXT PRIMARY KEY,
  _creationTime  INTEGER NOT NULL,
  workspaceId    TEXT    NOT NULL,
  title          TEXT    NOT NULL,
  areaId         TEXT,
  type           TEXT,
  status         TEXT,
  priority       INTEGER,
  dueDate        TEXT,
  amount         REAL,
  financialState TEXT,
  description    TEXT,
  parentId       TEXT,
  archived       INTEGER NOT NULL DEFAULT 0,
  createdAt      INTEGER NOT NULL,
  updatedAt      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_workspace ON items (workspaceId, archived);
CREATE INDEX IF NOT EXISTS idx_items_area ON items (areaId, archived);
CREATE INDEX IF NOT EXISTS idx_items_parent ON items (parentId);
CREATE INDEX IF NOT EXISTS idx_items_workspace_due ON items (workspaceId, dueDate);
CREATE INDEX IF NOT EXISTS idx_items_area_due ON items (areaId, dueDate);
CREATE INDEX IF NOT EXISTS idx_items_workspace_area ON items (workspaceId, areaId);

CREATE TABLE IF NOT EXISTS tags (
  _id            TEXT PRIMARY KEY,
  _creationTime  INTEGER NOT NULL,
  workspaceId    TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  normalizedName TEXT    NOT NULL,
  createdAt      INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_workspace_name ON tags (workspaceId, normalizedName);

CREATE TABLE IF NOT EXISTS itemTags (
  _id           TEXT PRIMARY KEY,
  _creationTime INTEGER NOT NULL,
  workspaceId   TEXT    NOT NULL,
  itemId        TEXT    NOT NULL,
  tagId         TEXT    NOT NULL,
  createdAt     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_itemTags_item ON itemTags (itemId);
CREATE INDEX IF NOT EXISTS idx_itemTags_tag ON itemTags (tagId);
CREATE INDEX IF NOT EXISTS idx_itemTags_workspace_tag ON itemTags (workspaceId, tagId);
