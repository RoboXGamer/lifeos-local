CREATE TABLE attentionFeedback (
  _id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  suggestionId TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('dismiss', 'snooze')),
  note TEXT NOT NULL DEFAULT '',
  untilDate TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE (workspaceId, suggestionId)
);
CREATE INDEX idx_attention_feedback_workspace ON attentionFeedback(workspaceId);
CREATE TABLE itemEstimates (
  _id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  itemId TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
  updatedAt INTEGER NOT NULL,
  UNIQUE (workspaceId, itemId)
);
