// The shapes the Gmail routes return and the Gmail components render.
// Shared by server and browser, so a component and its route never drift.

export interface Person {
  name: string;
  email: string;
}

export interface MailThread {
  id: string;
  subject: string;
  snippet: string;
  from: Person;
  date: string;
  unread: boolean;
  starred: boolean;
  inInbox: boolean;
  count: number;
}

export interface MailMessage {
  id: string;
  from: Person;
  to: string[];
  date: string;
  body: string;
  fromMe: boolean;
}

export interface MailThreadDetail extends MailThread {
  messages: MailMessage[];
}

export interface DraftInput {
  to: string[];
  subject: string;
  body: string;
  threadId?: string;
}
