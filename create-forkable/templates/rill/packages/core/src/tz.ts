// Timezone math with no library: everything an IANA zone needs here is its
// offset from UTC at a given instant, which Intl already knows (and keeps
// correct across a DST change).

/** Minutes a timezone is ahead of UTC at `at` (handles DST at that instant). */
export function tzOffsetMinutes(tz: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .reduce((a, p) => ({ ...a, [p.type]: p.value }), {} as Record<string, string>);
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    return (asUtc - at.getTime()) / 60_000;
  } catch {
    return 0;
  }
}

// Microsoft Graph reports an event's time as a wall clock plus a zone name, and
// the name is often a Windows one ("Pacific Standard Time") that Intl does not
// know. The common ones map to IANA here; anything else that Intl accepts is
// already IANA.
const WINDOWS_TO_IANA: Record<string, string> = {
  "UTC": "UTC",
  "Coordinated Universal Time": "UTC",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "Romance Standard Time": "Europe/Paris",
  "E. Europe Standard Time": "Europe/Chisinau",
  "FLE Standard Time": "Europe/Kiev",
  "GTB Standard Time": "Europe/Bucharest",
  "Russian Standard Time": "Europe/Moscow",
  "Turkey Standard Time": "Europe/Istanbul",
  "Israel Standard Time": "Asia/Jerusalem",
  "Egypt Standard Time": "Africa/Cairo",
  "South Africa Standard Time": "Africa/Johannesburg",
  "Arab Standard Time": "Asia/Riyadh",
  "Arabian Standard Time": "Asia/Dubai",
  "India Standard Time": "Asia/Kolkata",
  "Pakistan Standard Time": "Asia/Karachi",
  "SE Asia Standard Time": "Asia/Bangkok",
  "Singapore Standard Time": "Asia/Singapore",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Korea Standard Time": "Asia/Seoul",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "E. Australia Standard Time": "Australia/Brisbane",
  "W. Australia Standard Time": "Australia/Perth",
  "New Zealand Standard Time": "Pacific/Auckland",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Alaskan Standard Time": "America/Anchorage",
  "Pacific Standard Time": "America/Los_Angeles",
  "US Mountain Standard Time": "America/Phoenix",
  "Mountain Standard Time": "America/Denver",
  "Central Standard Time": "America/Chicago",
  "Eastern Standard Time": "America/New_York",
  "Atlantic Standard Time": "America/Halifax",
  "Canada Central Standard Time": "America/Regina",
  "SA Pacific Standard Time": "America/Bogota",
  "E. South America Standard Time": "America/Sao_Paulo",
  "Argentina Standard Time": "America/Buenos_Aires",
  "Central Standard Time (Mexico)": "America/Mexico_City",
};

/** An IANA zone for a Graph zone name, or null when neither table nor Intl knows it. */
export function ianaZone(name: string | null | undefined): string | null {
  if (!name) return null;
  if (WINDOWS_TO_IANA[name]) return WINDOWS_TO_IANA[name]!;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return name;
  } catch {
    return null;
  }
}

/** A naive wall clock ("2026-10-29T10:00:00.0000000") in `zone`, as a UTC instant. An unknown zone reads as UTC. */
export function wallClockToUtc(dateTime: string, zone: string | null | undefined): Date {
  const naive = dateTime.replace(/(\.\d{3})\d*/, "$1").replace(/(Z|[+-]\d{2}:\d{2})$/, "");
  const asUtc = new Date(`${naive}Z`);
  if (/(Z|[+-]\d{2}:\d{2})$/.test(dateTime)) return new Date(dateTime);
  const iana = ianaZone(zone);
  if (!iana || iana === "UTC") return asUtc;
  return new Date(asUtc.getTime() - tzOffsetMinutes(iana, asUtc) * 60_000);
}
