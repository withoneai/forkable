// What ui_guide returns: the kit reference, the style rules and one complete
// example. It lives here, read on demand, so the always-loaded tool
// descriptions stay short. scripts/kit.mjs renders GUIDE_EXAMPLE and
// scripts/stylecheck.test.mjs checks it passes the style check.

export const GUIDE_EXAMPLE = `import { useState } from "react";
import { useAction, runAction, ask, timeAgo, Page, Section, StatGrid, Stat, Toolbar, Spacer, Tabs, Input, Table, EmptyState, ErrorState, Avatar, Button } from "@forkable/ui";
import { Inbox, Mail, Star, Search, RefreshCw } from "lucide-react";

const GET_THREADS = "conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ"; // gmail get-threads (read)
const CREATE_DRAFT = "conn_mod_def::GGZUe0SIuk8::nhwEKp2cQ6uARsH3513VeQ"; // gmail create-draft (write)

type Thread = { id: string; subject: string; date: string; unread: boolean; starred: boolean; from: { name: string; email: string } };

export default function InboxTriage() {
  const { data, loading, error, reload } = useAction<{ threads: Thread[] }>(GET_THREADS, { body: { query: "in:inbox", numberOfThreads: 25 } });
  const [tab, setTab] = useState("unread");
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const threads = data?.threads ?? [];
  const unread = threads.filter((t) => t.unread);
  const starred = threads.filter((t) => t.starred);
  const pool = tab === "unread" ? unread : tab === "starred" ? starred : threads;
  const shown = pool.filter((t) => (t.subject + " " + t.from.name).toLowerCase().includes(q.toLowerCase()));

  const draft = async (t: Thread) => {
    try {
      await runAction(CREATE_DRAFT, { body: { to: t.from.email, subject: "Re: " + t.subject, body: "Thanks, I will reply properly today." } });
      setNote("Draft saved for " + t.from.name + ".");
    } catch (e: any) {
      setNote(e.refused === "cancelled" ? "Nothing was saved." : e.message);
    }
  };

  return (
    <Page
      title="Inbox triage"
      description="Your latest threads. You confirm each draft before it is saved."
      actions={<Button variant="secondary" size="sm" onClick={reload}><RefreshCw />Refresh</Button>}
    >
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <>
          <StatGrid cols={3}>
            <Stat label="Threads" icon={<Inbox />} value={loading ? "-" : threads.length} hint="in the inbox" />
            <Stat label="Unread" icon={<Mail />} value={loading ? "-" : unread.length} delta={threads.length ? Math.round((unread.length / threads.length) * 100) + "%" : undefined} tone="negative" hint="of all threads" />
            <Stat label="Starred" icon={<Star />} value={loading ? "-" : starred.length} />
          </StatGrid>
          <Section title="Threads" actions={<Button size="sm" onClick={() => ask("Summarize my unread threads")}>Summarize unread</Button>}>
            <Toolbar>
              <Tabs value={tab} onChange={setTab} tabs={[{ id: "unread", label: "Unread", count: unread.length }, { id: "starred", label: "Starred", count: starred.length }, { id: "all", label: "All", count: threads.length }]} />
              <Spacer />
              <Input leading={<Search />} placeholder="Filter" aria-label="Filter threads" value={q} onChange={(e) => setQ(e.target.value)} className="w-48" />
            </Toolbar>
            <Table
              loading={loading}
              rows={shown}
              rowKey={(t) => t.id}
              columns={[
                { key: "from", header: "From", render: (t) => <span className="flex items-center gap-2"><Avatar name={t.from.name} size="sm" />{t.from.name}</span> },
                { key: "subject", header: "Subject", grow: true, render: (t) => <span className={t.unread ? "font-semibold" : ""}>{t.subject}</span> },
                { key: "date", header: "When", align: "right", render: (t) => <span className="text-muted-foreground">{timeAgo(t.date)}</span> },
                { key: "act", header: "", align: "right", render: (t) => <Button size="sm" variant="secondary" onClick={() => draft(t)}>Draft reply</Button> },
              ]}
              empty={<EmptyState title="Nothing in this view" description="Try All, or clear the filter." compact />}
            />
          </Section>
          {note && <p role="status" className="m-0 text-13 text-muted-foreground">{note}</p>}
        </>
      )}
    </Page>
  );
}`;

export const GUIDE = `# Writing a UI for render_ui

One TSX module, default-exporting a component. It runs in a sandboxed frame with no network. Build with the kit below so every UI looks the same in light and dark; the server checks style on save and tells you what to fix.

## Imports
- "react": hooks.
- "@forkable/ui": the kit and data helpers below.
- "lucide-react": Mail, Calendar, Search, Check, X, Star, ArrowRight, ChevronRight, ChevronDown, Plus, Trash2, RefreshCw, ExternalLink, Users, User, Clock, Inbox, Send, Filter, BarChart3, TrendingUp, TrendingDown, DollarSign, CreditCard, FileText, Folder, Tag, AlertCircle, Info, Loader2, MoreHorizontal, Settings, Link, Globe, Phone, MessageSquare, Bell, Archive. Others render as a square.
- "clsx".

## Data
- useAction<T>(actionId, input, deps?) -> { data, loading, error, reload }. Runs on mount and when input or deps change.
- runAction<T>(actionId, input) -> Promise<data>. For writes and on-demand reads.
- input is { query?, body?, pathParams?, headers? } exactly as the action's docs say. data is the provider's JSON.
- Errors throw with .status, .message (show it as is) and .refused: "outside_grant", "not_declared", "not_connected", or "cancelled" when the person declined a write.
- Writes (send, create, update, delete, pay) open a Confirm dialog outside your UI and resolve only after Confirm. Tell the person in the UI that they confirm first. Never put a connection key anywhere.
- ask(text) sends the user's next chat message to you. openLink(url). timeAgo(iso). cn(...classes).

## Kit (@forkable/ui)
Layout
- Page({ title?, description?, actions?, icon?, children }): the outer frame. Padding and 16px between sections. Use it once, at the top.
- Header({ title, description?, actions?, icon? }): the title row on its own.
- Section({ title?, description?, actions?, children }): a titled group.
- Card({ title?, description?, actions?, children }): a bordered panel.
- Toolbar({ children }) + Spacer(): a row of tabs, filters and buttons; Spacer pushes the rest right.
Numbers
- StatGrid({ cols?: 2|3|4, children }) of Stat({ label, value, delta?, tone?: "positive"|"negative"|"neutral", hint?, icon? }).
Collections
- Table({ columns, rows, rowKey?, onRowClick?, loading?, empty? }). columns: { key, header, render?(row), align?: "left"|"right", grow?: true on one text column so it truncates }. loading shows skeleton rows; empty shows when rows is [].
- List({ empty?, children }) of Row({ leading?, title, meta?, trailing?, onClick?, selected?, strong? }). leading takes an Avatar, AppLogo or icon; strong bolds unread items.
- EmptyState({ icon?, title, description?, action?, compact? }).
Forms
- Field({ label, hint?, error?, required?, children }) wraps one control and wires its label, hint and error.
- Input({ leading?: icon, ...input props }), Textarea({ rows?, ... }), Select({ options: string[] | {value,label}[], ... }).
Navigation
- Tabs({ tabs: { id, label, count? }[], value, onChange }).
Small pieces
- Button({ variant?: "primary"|"secondary"|"ghost"|"danger", size?: "sm"|"md"|"icon", loading? }). Default ghost. One primary per view, for the main action.
- Badge({ variant?: "neutral"|"outline"|"accent"|"danger" }).
- Avatar({ name, src?, size?: "sm"|"md"|"lg" }): initials when there is no picture.
- AppLogo({ platform, size? }): a platform's logo (gmail, stripe...), its first letter when the image is blocked.
- Skeleton({ className }), ErrorState({ error, onRetry? }).

## Style rules
- Kit first. Write your own markup only for what the kit lacks, and then use the classes below.
- Color tokens only: bg-background, bg-card, bg-raised, text-foreground, text-muted-foreground, border-border, border-strong, text-accent (positive), text-danger, bg-primary + text-primary-foreground (lime fill with black text, the one main action). No hex, rgb or palette classes (bg-blue-500, text-white). Light and dark follow the chat on their own; never write dark: variants for colors.
- Type: text-11 (labels, meta), text-13 (body, rows), text-15 (lead text), text-lg (titles), text-28 (big numbers). text-xs and text-sm are fine. Nothing else.
- Spacing steps: 0.5, 1, 1.5, 2, 2.5, 3, 4, 6 (2 to 24px). gap-2 inside a row, gap-3 between cards, gap-4 between sections. A title and its meta sit closer than the next item.
- Radius: rounded-sm, rounded-md, rounded-lg. No [arbitrary] values, no inline style for color or spacing (a computed width is fine), no emoji (use icons).
- Use Table, Input, Select and Textarea, not raw <table>, <input>, <select>, <textarea>.
- Handle loading (Skeleton or Table loading), errors (ErrorState) and empty data (EmptyState) every time.
- Copy: short plain sentences, no exclamation marks.

## Example: inbox triage (get-threads read, create-draft write)
Declare both ids in render_ui's actions, with platform "gmail".

\`\`\`tsx
${GUIDE_EXAMPLE}
\`\`\`
`;
