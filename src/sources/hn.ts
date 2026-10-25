import { z } from "zod";
import { fetchJson, USER_AGENT } from "../http";
import { errorMessage } from "../log";
import { stripHtml, truncateDescription } from "../normalize";
import { JobSchema, type Job } from "../types";

const SOURCE = "hn";
const SEARCH_ENDPOINT =
  "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10";

const SearchSchema = z.object({
  hits: z.array(
    z.object({
      objectID: z.coerce.string(),
      title: z.string(),
    }),
  ),
});

const ThreadSchema = z.object({
  id: z.number(),
  children: z.array(
    z.object({
      id: z.number(),
      author: z.string(),
      created_at: z.string(),
      text: z.string().nullish(), // deleted comments have no text
    }),
  ),
});

const MAX_TITLE_CHARS = 120;

/** Pull the company name and role out of a post's first line. */
export function parseListingTitle(line: string): { company: string; title: string } {
  if (line.includes("|")) {
    // Canonical HN format: "Company | Role | Location".
    const [rawCompany = "", rawTitle = ""] = line
      .split("|")
      .map((part) => part.trim());
    return {
      company: rawCompany.replace(/\s*[((][^)]*[))]\s*$/, "").slice(0, MAX_TITLE_CHARS),
      title: rawTitle.slice(0, MAX_TITLE_CHARS),
    };
  }

  const parenthesised = /^(.+?)\s*[((]/.exec(line);
  if (parenthesised?.[1]) {
    // Common variant: "Company (Remote US) — Full-Stack Engineer — …".
    return { company: parenthesised[1].trim(), title: line.slice(0, MAX_TITLE_CHARS) };
  }

  return { company: line.slice(0, MAX_TITLE_CHARS), title: line.slice(0, MAX_TITLE_CHARS) };
}

export function normalizeHnComment(
  child: z.infer<typeof ThreadSchema>["children"][number],
): Job | null {
  const plain = stripHtml(child.text ?? "");
  if (!plain) return null;

  const headline =
    plain
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  const parsed = parseListingTitle(headline);

  return JobSchema.parse({
    id: `${SOURCE}:${child.id}`,
    source: SOURCE,
    title: parsed.title || headline,
    company: parsed.company || child.author,
    location: "",
    remote: /remote/i.test(headline) ? true : null,
    url: `https://news.ycombinator.com/item?id=${child.id}`,
    description: truncateDescription(plain),
    postedAt: child.created_at,
  });
}

function isHiringThread(story: { title: string }): boolean {
  // Also excludes "Who wants to be hired?" and the freelancer threads.
  return /who is hiring/i.test(story.title);
}

export async function fetchHn(): Promise<Job[]> {
  try {
    const search = await fetchJson(SEARCH_ENDPOINT, SearchSchema, {
      headers: { "User-Agent": USER_AGENT },
    });
    const thread = search.hits.find(isHiringThread);
    if (!thread) {
      throw new Error("no 'Who is hiring?' thread in the 10 latest hits");
    }

    const items = await fetchJson(`https://hn.algolia.com/api/v1/items/${thread.objectID}`, ThreadSchema, {
      headers: { "User-Agent": USER_AGENT },
    });

    const jobs: Job[] = [];
    let skipped = 0;
    for (const child of items.children) {
      try {
        const job = normalizeHnComment(child);
        if (job === null) throw new Error("comment has no text");
        jobs.push(job);
      } catch {
        skipped++; // deleted or unusable comments must not take the thread down
      }
    }

    console.log(
      `source=${SOURCE} thread=${items.id} in=${items.children.length} out=${jobs.length} skipped=${skipped}`,
    );
    return jobs;
  } catch (error) {
    console.error(`source=${SOURCE} error=${errorMessage(error)}`);
    return [];
  }
}
