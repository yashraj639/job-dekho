import { describe, expect, test } from "bun:test";
import type { Filters } from "../src/config";
import { prefilter } from "../src/prefilter";
import type { Job } from "../src/types";

const NOW = new Date("2026-10-25T00:00:00Z");

const BASE_FILTERS: Filters = {
  roleKeywords: ["intern", "internship", "junior", "entry level", "fresher", "graduate", "trainee"],
  stackKeywords: ["full stack", "fullstack", "next.js", "nextjs", "react", "typescript", "node"],
  rejectTitleKeywords: ["senior", "staff", "principal", "lead", "manager", "director", "head of"],
  rejectYearsOfExperience: 4,
  allowedLocations: ["India", "Bengaluru", "Remote", "Anywhere", "APAC"],
  maxAgeDays: 30,
  maxJobsToScore: 50,
  notifyThreshold: 7,
};

function filters(overrides: Partial<Filters> = {}): Filters {
  return { ...BASE_FILTERS, ...overrides };
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "remotive:1",
    source: "remotive",
    title: "Junior Full Stack Developer",
    company: "Example Co",
    location: "Worldwide",
    remote: true,
    url: "https://remotive.com/remote-jobs/software-dev/example-1",
    description: "React and TypeScript. Node on the backend.",
    postedAt: "2026-10-20T09:12:00",
    ...overrides,
  };
}

interface Case {
  name: string;
  job: Partial<Job>;
  keep: boolean;
  filters?: Partial<Filters>;
}

const CASES: Case[] = [
  // Baseline
  { name: "junior role with a matching stack", job: {}, keep: true },

  // Role level: at least one must match
  { name: "intern in the title", job: { title: "Intern - Backend" }, keep: true },
  { name: "trainee in the title", job: { title: "Trainee Engineer" }, keep: true },
  { name: "graduate in the title", job: { title: "Graduate Software Engineer" }, keep: true },
  {
    name: "entry level written with a hyphen",
    job: { title: "Entry-Level Developer" },
    keep: true,
  },
  {
    name: "entry level only in the description",
    job: { title: "Software Engineer", description: "This is an entry level role. React and TypeScript." },
    keep: true,
  },
  {
    name: "no role level signal at all",
    job: { title: "Software Engineer", description: "React and TypeScript." },
    keep: false,
  },
  {
    name: "\"internal\" is not mistaken for \"intern\"",
    job: {
      title: "Software Engineer",
      description: "You will own our internal tooling. React and TypeScript.",
    },
    keep: false,
  },

  // Stack: at least one must match
  {
    name: "no matching stack keyword",
    job: { title: "Junior Marketing Assistant", description: "Content writing only." },
    keep: false,
  },
  {
    name: "full stack written with a hyphen",
    job: { title: "Junior Developer", description: "We do full-stack development in house." },
    keep: true,
  },
  { name: "nextjs without the dot", job: { title: "Junior Developer", description: "nextjs" }, keep: true },

  // Seniority: rejected from the title
  { name: "senior in the title", job: { title: "Senior Full Stack Developer" }, keep: false },
  { name: "staff in the title", job: { title: "Staff Engineer" }, keep: false },
  { name: "principal in the title", job: { title: "Principal Engineer" }, keep: false },
  { name: "lead in the title", job: { title: "Tech Lead" }, keep: false },
  { name: "manager in the title", job: { title: "Engineering Manager" }, keep: false },
  { name: "director in the title", job: { title: "Director of Engineering" }, keep: false },
  { name: "head of in the title", job: { title: "Head of Engineering" }, keep: false },

  // Years of experience: reject at the configured threshold (4)
  { name: "2+ years is fine", job: { description: "React. 2+ years of experience." }, keep: true },
  { name: "3 years is fine", job: { description: "React. 3 years of experience." }, keep: true },
  { name: "4+ years is rejected", job: { description: "React. 4+ years of experience." }, keep: false },
  { name: "5+ years is rejected", job: { description: "React. 5+ years." }, keep: false },
  { name: "10+ years is rejected", job: { description: "React. 10+ years." }, keep: false },
  { name: "4-6 years is rejected", job: { description: "React. 4-6 years of experience." }, keep: false },
  { name: "6-8 years is rejected", job: { description: "React. 6–8 years." }, keep: false },

  // Location: remote wins, otherwise the location must be allowed
  { name: "remote overrides an overseas location", job: { location: "Berlin, Germany" }, keep: true },
  { name: "on-site in India is fine", job: { location: "Bengaluru, India", remote: false }, keep: true },
  { name: "remote but pinned to APAC", job: { location: "Remote (APAC)", remote: false }, keep: true },
  { name: "on-site in Berlin is rejected", job: { location: "Berlin, Germany", remote: false }, keep: false },
  { name: "unknown location, not remote", job: { location: "", remote: false }, keep: false },
  { name: "unknown remote flag, allowed location", job: { location: "India", remote: null }, keep: true },

  // Freshness
  { name: "posted yesterday", job: { postedAt: "2026-10-24T09:00:00Z" }, keep: true },
  { name: "posted exactly 30 days ago", job: { postedAt: "2026-09-25T00:00:00Z" }, keep: true },
  { name: "posted 31 days ago", job: { postedAt: "2026-09-24T00:00:00Z" }, keep: false },
  { name: "unknown date is kept", job: { postedAt: null }, keep: true },
  { name: "unparseable date is kept", job: { postedAt: "sometime last week" }, keep: true },
];

describe("prefilter rules", () => {
  for (const testCase of CASES) {
    test(testCase.name, () => {
      const kept = prefilter([makeJob(testCase.job)], filters(testCase.filters), NOW);
      expect(kept).toHaveLength(testCase.keep ? 1 : 0);
    });
  }
});

describe("prefilter cap and ranking", () => {
  test("keeps the jobs with the most keyword hits, capped", () => {
    const fewHits = makeJob({ id: "a", title: "Junior Developer", description: "React." });
    const manyHits = makeJob({ id: "b", title: "Junior Developer", description: "React, TypeScript, Node." });
    const alsoFew = makeJob({ id: "c", title: "Intern Developer", description: "React." });

    const kept = prefilter([fewHits, manyHits, alsoFew], filters({ maxJobsToScore: 2 }), NOW);

    expect(kept.map((job) => job.id)).toEqual(["b", "a"]);
  });

  test("everything survives when under the cap", () => {
    const jobs = [makeJob({ id: "a" }), makeJob({ id: "b" })];

    expect(prefilter(jobs, filters(), NOW).map((job) => job.id)).toEqual(["a", "b"]);
  });

  test("does not mutate the input array", () => {
    const jobs = [makeJob({ id: "a" }), makeJob({ id: "b" })];

    prefilter(jobs, filters({ maxJobsToScore: 1 }), NOW);

    expect(jobs.map((job) => job.id)).toEqual(["a", "b"]);
  });
});
