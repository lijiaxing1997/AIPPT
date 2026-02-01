import { randomUUID } from "node:crypto";

import { nowIso } from "../utils/time.js";

export type JobStatus = "queued" | "running" | "completed" | "failed";

export type GenerateJobProgress = {
  step: "style" | "outline" | "content" | "images" | "slides";
  totalSlides: number;
  completedSlides: number;
  failedSlides: number;
};

export type Job = {
  id: string;
  type: "generate";
  projectId: string;
  status: JobStatus;
  startedAt: string;
  finishedAt: string | null;
  progress: GenerateJobProgress | null;
  error: string | null;
};

const jobs = new Map<string, Job>();

export function createGenerateJob(projectId: string): Job {
  const job: Job = {
    id: randomUUID(),
    type: "generate",
    projectId,
    status: "queued",
    startedAt: nowIso(),
    finishedAt: null,
    progress: null,
    error: null,
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(jobId: string): Job | null {
  return jobs.get(jobId) ?? null;
}

export function findRunningGenerateJob(projectId: string): Job | null {
  for (const job of jobs.values()) {
    if (job.type === "generate" && job.projectId === projectId && (job.status === "queued" || job.status === "running")) {
      return job;
    }
  }
  return null;
}

export function updateJob(jobId: string, patch: Partial<Job>): Job {
  const job = jobs.get(jobId);
  if (!job) throw new Error("任务不存在");
  const next = { ...job, ...patch } satisfies Job;
  jobs.set(jobId, next);
  return next;
}
