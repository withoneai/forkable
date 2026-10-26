# Design lessons from Resend Inboxes

Studied from resend.com/products/inboxes on 2026-10-22: screenshots at 1440px plus computed styles read from the page. Nothing in Orez has changed yet. Each item says what Resend does, what it measures at, and what it would mean for Orez.

**The short version.** Resend's inbox looks calm because each row carries less, not because it has more space. A row has a sender, at most one tinted chip, the subject, one line of preview, the time and one owner mark. That's it. Orez rows today have the sender, subject, preview, a goal chip with an icon, a draft pencil and a count, all competing on the right. The move is to take Resend's discipline and keep Orez's density.

## What they measure at (their inbox mock)

| Element | Resend | Orez today |
|---|---|---|
| Row height | 48px, 12px vertical padding, no dividers | 40px |
| Sender | 14px, 600 when unread, regular when read | 13px bold plus a blue unread dot |
| Subject | 14px 600, then an en dash and the preview in muted | 13px, a middle dot, then the preview |
| Time | 14px, muted `rgb(161,164,165)` | 11px, bold |
| Chip | 24px tall, 8px radius, 0 8px padding, 12px/500, **filled with no border** | outlined, with an icon, after the preview |
| Chip colors | two only: neutral (text at 72% on an 11% white fill) and blue (on a 23% blue fill) | muted outline |
| Primary button | Compose, solid white, 32px, 12px radius. The only filled control on screen | no Compose button in the inbox header |
| Header | breadcrumb `Inboxes / Support ⌄` centered, then the page title at 20px/600 | `VIPs 6` plus a description line at 13px |
| Text colors | three steps: 240 white, 161 grey, chip text at 72% | similar, plus more mid-greys |

## Seven things worth taking

1. **One chip per row, placed before the subject.** It says why the row is here (`Goal`, `VIP`, `Needs reply`, `Orez drafted`). It's filled, has no icon, and sits on the ladder at text-11, medium, `px-2`, `rounded-md`, `bg-foreground/10`. Color only when it means something: the one accent tone for "Orez acted". The goal name moves into the chip's tooltip and the thread header.
2. **One owner slot on the far right.** Resend puts the assignee's initial there, and an agent glyph when the agent owns it. In Orez that slot answers "whose move is it": the Orez mark when a draft is waiting, nothing when it's yours. It replaces the pencil and the count.
3. **Quieter time and unread.** Muted regular time. Unread shows as weight (sender and subject semibold, read rows regular). The blue dot can go or stay. I'd keep it, since Gmail users look for it.
4. **A bit more room.** Rows at 44px (Resend is 48, Orez 40) with no dividers, so the row is held together by spacing alone. Compact stays available through the existing UI scale.
5. **Compose as the single solid button**, top right of the list header (shortcut C). Everything else stays ghost.
6. **The agent panel, applied to Access.** Their Agent card is a plain-language **Instructions** box above an **Available actions** dropdown. For Orez that's the honest version of the same idea: your goals and rules in your own words, above the actions your grant allows. The ungranted ones (delete) show greyed out, with the `Gmail · delete   declined, 403` receipt one click away. This is where Resend's design and the Connect story line up best.
7. **The agent as a visible collaborator.** In their board mock, a labeled "Agent" cursor moves cards next to a teammate's "Erin" cursor. Orez could name itself the same way wherever it acted: "Orez drafted · 2m" on the row, and an Orez line in the thread timeline. It shows what the agent did without opening the Activity table.

## For the orez.sh launch page (not the app)

- **Hero:** a large serif headline (they use Domaine at 77px, tracked −1%) with a soft silver gradient on the text, one line of grey subhead, then the real product window under a thin glowing top edge. The rows fade out at the bottom so the window reads as live.
- **Section rhythm:** a small icon plus a label as the eyebrow (`Agent-ready`, `Shared inboxes`), a 56px headline, a two-line grey subhead, then one working demo per section. These are live: a typing Instructions box, a Claude Code prompt and a board with moving cursors. There are no feature grids of icons.
- **Use-case grid:** six cells separated by hairlines, not cards.
- **Closing:** a `$0 / mo` card with four green checks. For Orez that's "Free and open source" with `npx @withone/orez`.

## What not to copy

- **Their light density for a power-user list.** At 48px, a 1080p screen shows about 14 threads. Orez is a triage tool.
- **The board view.** Lanes as kanban columns (their Review / Scheduled / Next steps / Offer) is pretty but a team pattern. It could come later as a view toggle, not now.
- **Shared inbox and assignment.** Orez is one person and one mailbox.

## If you want it built

- **App pass:** items 1 to 5. That's the row, chip, owner slot and header, in `InboxList` and the row component, on the ladder, with before and after shots in light and dark at 1024/1280/1536.
- **Access pass:** item 6.
- **Agent presence:** item 7. It needs a small "acted by Orez" field on the thread from the server.
- **Launch page:** a separate job, once orez.sh is bought.

Screenshots of resend.com/products/inboxes (1440px, 2x): `/tmp/resend-study/shots/inbox-00.jpg` to `inbox-09.jpg` (local, not committed). Page copy: one-run page dd2a7bf7-7cb9-48c1-ace0-24fa1d84296f.
