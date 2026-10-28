// Acme Inc sample repository (acme/acme-app), made up for this page. Shaped
// like GitHub's "List Pull Requests" answer through One: a bare array, each
// pull request trimmed with author, htmlUrl, createdAt, mergedAt and labels.

const DAY = 86_400_000;

type Seed = { n: number; title: string; who: string; daysAgo: number; merged: boolean; labels?: string[] };

const SEEDS: Seed[] = [
  { n: 412, title: "SAML SSO, part one: setup and test mode behind a flag", who: "noor-acme", daysAgo: 3, merged: true, labels: ["feature"] },
  { n: 409, title: "Exports run in the background and email a link", who: "theo-acme", daysAgo: 5, merged: true, labels: ["feature"] },
  { n: 407, title: "Fix time zone drift in scheduled reports", who: "theo-acme", daysAgo: 6, merged: true, labels: ["bug"] },
  { n: 401, title: "Audit log for admins", who: "noor-acme", daysAgo: 11, merged: true, labels: ["feature"] },
  { n: 398, title: "Usage-based billing behind a flag", who: "marcus-acme", daysAgo: 14, merged: true, labels: ["billing"] },
  { n: 393, title: "Cut dashboard load time from 2.1s to 0.6s", who: "theo-acme", daysAgo: 19, merged: true, labels: ["performance"] },
  { n: 388, title: "Slack alerts for failed syncs", who: "noor-acme", daysAgo: 24, merged: true, labels: ["feature"] },
  { n: 385, title: "Bump dependencies", who: "theo-acme", daysAgo: 26, merged: true, labels: ["chore"] },
  { n: 380, title: "Try a new onboarding checklist", who: "marcus-acme", daysAgo: 28, merged: false },
  { n: 371, title: "Self-serve plan upgrades", who: "noor-acme", daysAgo: 41, merged: true, labels: ["billing"] },
];

export function getPullRequests(body: { owner?: string; repo?: string; state?: string; perPage?: number } = {}) {
  const now = Date.now();
  const owner = body.owner ?? "acme";
  const repo = body.repo ?? "acme-app";
  return SEEDS.filter(() => body.state === "closed" || body.state === "all")
    .slice(0, Math.min(100, body.perPage ?? 30))
    .map((s) => {
      const closed = new Date(now - s.daysAgo * DAY).toISOString();
      return {
        id: 2_000_000 + s.n,
        number: s.n,
        title: s.title,
        state: "closed",
        body: null,
        draft: false,
        htmlUrl: `https://github.com/${owner}/${repo}/pull/${s.n}`,
        createdAt: new Date(now - (s.daysAgo + 2) * DAY).toISOString(),
        updatedAt: closed,
        closedAt: closed,
        mergedAt: s.merged ? closed : null,
        author: { login: s.who, id: s.n, htmlUrl: `https://github.com/${s.who}`, avatarUrl: "" },
        assignee: null,
        assignees: [],
        labels: (s.labels ?? []).map((name, i) => ({ id: i, name, description: null, color: "cced73" })),
        milestone: null,
        requestedReviewers: [],
        requestedTeams: [],
      };
    });
}
