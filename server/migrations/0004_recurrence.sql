CREATE TABLE recurrenceSchedules (
  _id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  sourceItemId TEXT NOT NULL,
  definition TEXT NOT NULL,
  nextDate TEXT,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'paused', 'ended')),
  lastError TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE (workspaceId, sourceItemId)
);
CREATE INDEX idx_recurrence_due ON recurrenceSchedules(state, nextDate);
CREATE TABLE recurrenceOccurrences (
  _id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  scheduleId TEXT NOT NULL,
  itemId TEXT NOT NULL,
  scheduledDate TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'skipped', 'missing')),
  completedAt INTEGER,
  createdAt INTEGER NOT NULL,
  UNIQUE (scheduleId, scheduledDate)
);
CREATE INDEX idx_recurrence_occurrences ON recurrenceOccurrences(scheduleId, createdAt);
CREATE UNIQUE INDEX idx_recurrence_one_pending ON recurrenceOccurrences(scheduleId) WHERE state='pending';
