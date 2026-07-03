-- D1 schema for the AI employee. Run with: npm run db:init
-- Safe to re-run (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  title         TEXT,
  task          TEXT NOT NULL,
  -- queued | running | waiting_user | done | error
  status        TEXT NOT NULL DEFAULT 'queued',
  result        TEXT,
  error         TEXT,
  step_count    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Chat + agent conversation. role: user | assistant | system | tool
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     TEXT NOT NULL,
  role       TEXT NOT NULL,
  content    TEXT,
  tool_calls TEXT,          -- JSON of assistant tool_calls (if any)
  tool_name  TEXT,          -- for role=tool
  created_at INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

-- One row per agent step (a model turn + optional tool execution).
CREATE TABLE IF NOT EXISTS steps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL,
  idx         INTEGER NOT NULL,
  tool        TEXT,
  args        TEXT,         -- JSON args sent to the tool
  status      TEXT,         -- ok | error
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

-- Raw tool results (screenshots stored as data URLs / text / json).
CREATE TABLE IF NOT EXISTS tool_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL,
  step_idx    INTEGER,
  tool        TEXT,
  ok          INTEGER,      -- 1 / 0
  output      TEXT,         -- JSON or text
  error       TEXT,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

-- Append-only event log; the SSE endpoint tails this table.
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL,
  type        TEXT NOT NULL,   -- status | thought | tool_call | tool_result | chat | ask_user | final | error
  data        TEXT,            -- JSON payload
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_job     ON messages(job_id, id);
CREATE INDEX IF NOT EXISTS idx_steps_job        ON steps(job_id, idx);
CREATE INDEX IF NOT EXISTS idx_tool_results_job ON tool_results(job_id, id);
CREATE INDEX IF NOT EXISTS idx_events_job        ON events(job_id, id);
