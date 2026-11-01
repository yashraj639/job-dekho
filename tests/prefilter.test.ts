import { describe, expect, test } from "bun:test";
import type { Filters } from "../src/config";
import { prefilter, prefilterResume } from "../src/prefilter";
import type { Job } from "../src/types";
import { makeJob } from "./helpers";

const NOW = new Date("2026-10-25T00:00:00Z");

const BASE_FILTERS: Filters = {
  roleKeywords: ["intern", "internship", "junior", "entry level", "fresher", "graduate", "trainee", "engineer", "developer", "full time", "full-time"],
  stackKeywords: ["ai", "artificial intelligence", "machine learning", "full stack", "fullstack", "next.js", "nextjs", "react", "typescript", "node"],
  resumeKeywords: ["typescript", "react", "prisma", "langchain"],
  rejectTitleKeywords: ["senior", "staff", "principal", "lead", "manager", "director", "head of"],
  rejectYearsOfExperience: 4,
  allowedLocations: ["India", "Bengaluru", "Hyderabad", "Mumbai", "Remote", "Anywhere", "APAC"],
  maxAgeDays: 30,
};

function filters(overrides: Partial<Filters> = {}): Filters {
  return { ...BASE_FILTERS, ...overrides };
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
    name: "no role or employment signal at all",
    job: { title: "Product Analyst", description: "React and TypeScript." },
    keep: false,
  },
  {
    name: "\"internal\" is not mistaken for \"intern\"",
    job: {
      title: "Product Analyst",
      description: "You will own our internal tooling. React and TypeScript.",
    },
    keep: false,
  },

  // Stack: at least one must match
  { name: "AI engineering role", job: { title: "AI Engineer", description: "Build artificial intelligence tools." }, keep: true },
  { name: "full-time developer role", job: { title: "Full-Time Developer", description: "Build with React." }, keep: true },
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
  { name: "city-only Indian location is fine", job: { location: "Hyderabad", remote: false }, keep: true },
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

describe("prefilter ordering", () => {
  test("prioritizes company career boards before stronger aggregator matches", () => {
    const aggregator = makeJob({ id: "a", source: "remotive", title: "Junior Developer", description: "React, TypeScript, Node." });
    const companyPage = makeJob({ id: "b", source: "greenhouse", title: "Junior Developer", description: "React." });

    const kept = prefilter([aggregator, companyPage], filters(), NOW);

    expect(kept.map((job) => job.id)).toEqual(["b", "a"]);
  });

  test("returns every eligible listing", () => {
    const jobs = Array.from({ length: 20 }, (_, index) => makeJob({ id: `job:${index}` }));

    expect(prefilter(jobs, filters(), NOW)).toHaveLength(20);
  });

  test("does not mutate the input array", () => {
    const jobs = [makeJob({ id: "a" }), makeJob({ id: "b" })];

    prefilter(jobs, filters(), NOW);

    expect(jobs.map((job) => job.id)).toEqual(["a", "b"]);
  });
});

describe("resume matching", () => {
  test("keeps a role that matches a resume skill outside the general technology list", () => {
    const role = makeJob({
      title: "Backend Engineer",
      description: "Build APIs with Prisma and PostgreSQL.",
      location: "Bengaluru, India",
      remote: false,
    });

    expect(prefilterResume([role], filters(), NOW).map((job) => job.id)).toEqual([role.id]);
  });

  test("rejects roles with no resume skill overlap", () => {
    const role = makeJob({
      title: "Backend Engineer",
      description: "Build APIs with Ruby and Rails.",
      location: "Bengaluru, India",
      remote: false,
    });

    expect(prefilterResume([role], filters(), NOW)).toEqual([]);
  });
});
