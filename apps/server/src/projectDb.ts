import Database from "better-sqlite3";
import path from "node:path";

export type ProjectDb = Database.Database;

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  source_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outline_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  outline_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS theme_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  theme_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS slides (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  section_index INTEGER NOT NULL,
  slide_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  content_json TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS slide_image_versions (
  id TEXT PRIMARY KEY,
  slide_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  prompt_text TEXT NOT NULL,
  image_path TEXT NOT NULL,
  provider TEXT,
  request_json TEXT,
  response_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(slide_id) REFERENCES slides(id)
);

CREATE INDEX IF NOT EXISTS idx_slides_project ON slides(project_id);
CREATE INDEX IF NOT EXISTS idx_slide_images_slide ON slide_image_versions(slide_id);
`;

export function getProjectDbPath(projectRootPath: string): string {
  return path.join(projectRootPath, "aippt.sqlite");
}

export function openProjectDb(projectRootPath: string): ProjectDb {
  const dbPath = getProjectDbPath(projectRootPath);
  const db = new Database(dbPath);
  db.exec(SCHEMA_SQL);
  return db;
}

