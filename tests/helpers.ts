import type { Job } from "../src/types";

/** A valid Job with sane defaults; override only what a test cares about. */
export function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "remotive:1",
    source: "remotive",
    title: "Junior Full Stack Developer",
    company: "Productiv Team",
    location: "Worldwide",
    remote: true,
    url: "https://remotive.com/remote-jobs/software-dev/example-1",
    description: "React and TypeScript. Node on the backend.",
    postedAt: "2026-10-20T09:12:00",
    ...overrides,
  };
}
