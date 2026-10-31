#!/usr/bin/env python3
"""Generates the Acme Inc sample world in fixtures/sample/ (SPEC 11, CONTRACT 12).

Hand-authored content, shaped exactly like each action's documented response
(the Response Fields sections loaded with the One CLI on 2026-10-29). Not
recordings. Dates are relative markers resolved by loadSampleWorld (see
world.md, "Fixture conventions"). Run from anywhere:

    python3 fixtures/sample/tools/generate.py

Then commit the JSON it writes. world.md is written by hand.
"""
import json, os, re, uuid, hashlib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# ------------------------------------------------------------------ markers
# Core's markers (packages/core/src/sample/world.ts resolveDates), resolved in America/Los_Angeles:
# $rel (ISO), $relMs, $relMsString, $relUnix, $relSlackTs, $relDate, $relLocal (+ $tz). Specs: "-2d 14:00", "-6h", "-90m".
def add_minutes(spec, n):
    """'-2d 14:00' + 30 -> '-2d 14:30' (same day); '-6h' + 30 -> '-330m'."""
    parts = spec.split()
    if len(parts) == 2:
        hh, mm = [int(x) for x in parts[1].split(":")[:2]]
        t = hh * 60 + mm + n
        day = int(parts[0][:-1]) + t // 1440
        t %= 1440
        return "%+dd %02d:%02d" % (day, t // 60, t % 60) if day else "0d %02d:%02d" % (t // 60, t % 60)
    m = re.match(r"^([+-]?\d+)([dhwm])$", spec)
    mins = int(m.group(1)) * {"m": 1, "h": 60, "d": 1440, "w": 10080}[m.group(2)] + n
    return "%+dm" % mins
def rel(s, fmt=None, plus=None):
    if plus: s = add_minutes(s, plus)
    key = {None: "$rel", "iso": "$rel", "ms": "$relMs", "ms-string": "$relMsString", "unix": "$relUnix", "slackts": "$relSlackTs",
           "date": "$relDate", "rfc2822": "$relRfc2822", "graph": "$relLocal", "naive": "$relLocal"}[fmt]
    o = {key: s}
    if fmt in ("graph", "naive"): o["$tz"] = "UTC"
    return o
def rel_ms(s): return rel(s, "ms")                # epoch ms number
def rel_ms_str(s): return rel(s, "ms-string")     # epoch ms as a string (Gmail internalDate)
def rel_unix(s): return rel(s, "unix")            # epoch seconds number
def rel_slack(s): return rel(s, "slackts")        # "1730000000.000000"
def rel_rfc(s): return rel(s, "rfc2822")          # Gmail Date header: "Wed, 29 Oct 2026 14:00:00 -0700"
def rel_date(s): return rel(s, "date")            # "2026-10-29" (Los Angeles date)
def rel_graph(s, plus=None): return rel(s, "graph", plus)   # "2026-10-29T21:00:00.0000000" (UTC wall time, no zone)
def tok_slack(s): return "$relSlackTs(%s)" % s    # inside a map key or string; core resolves these inline

def secs_of(spec):
    """Approximate offset in seconds from now, for ordering only (noon taken as now)."""
    parts = spec.strip().split()
    m = re.match(r"^([+-]?\d+)([dhwm])$", parts[0])
    n, u = int(m.group(1)), m.group(2)
    base = n * {"d": 86400, "h": 3600, "w": 604800, "m": 60}[u]
    if len(parts) > 1:
        hh, mm = parts[1].split(":")[:2]
        base += int(hh) * 3600 + int(mm) * 60 - 12 * 3600
    return base

def days_of(spec):
    """Rough age in days of a relative spec (negative = past)."""
    m = re.match(r"^([+-]?\d+)([dhwm])", spec.strip())
    n, u = int(m.group(1)), m.group(2)
    return {"d": n, "h": n / 24, "w": n * 7, "m": n / 1440}[u]

def nodash(v):
    """AGENTS.md: no em or en dashes anywhere, copied third-party text included."""
    if isinstance(v, str):
        return re.sub(r"\s*\u2014\s*", ", ", v).replace("\u2013", "-")
    if isinstance(v, list):
        return [nodash(x) for x in v]
    if isinstance(v, dict):
        return {nodash(k): nodash(x) for k, x in v.items()}
    return v

def write(rel_path, obj):
    obj = nodash(obj)
    p = os.path.join(ROOT, rel_path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")

def uid(*parts):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "acme-sample:" + ":".join(parts)))

def hexid(*parts, n=16):
    return hashlib.sha1(":".join(parts).encode()).hexdigest()[:n]

# ------------------------------------------------------------------ cast
P = {
    "dana": ("Dana Oyelaran", "dana@acme.com"),
    "dana_eu": ("Dana Oyelaran", "dana@acme.eu"),
    "mia": ("Mia Park", "mia@acme.com"),
    "theo": ("Theo Lund", "theo@acme.com"),
    "sam": ("Sam Okafor", "sam@acme.com"),
    "lena": ("Lena Vogt", "lena@acme.eu"),
    "priya": ("Priya Shah", "priya@globex.com"),
    "marco": ("Marco Bellini", "marco@globex.com"),
    "ravi": ("Ravi Menon", "ravi@initech.io"),
    "anika": ("Anika Rao", "anika@initech.io"),
    "hannah": ("Hannah Cole", "hannah.cole@umbrella.co"),
    "felix": ("Felix Wagner", "felix.wagner@umbrella.co"),
    "owen": ("Owen Price", "owen@northwind.vc"),
    "jules": ("Jules Martin", "jules@hooli.dev"),
    "tom": ("Tom Reyes", "tom@hooli.dev"),
    "grace": ("Grace Liu", "grace.liu@initrode.com"),
    "nadia": ("Nadia Rahman", "nadia@initrode.com"),
    # look-alikes for the entity match check (SPEC 8.2)
    "priya_s": ("Priya S.", "priya.shah@gmail.com"),          # same person, Jev 0.93, merged
    "ravi_m": ("Ravi M.", "ravi.menon@protonmail.com"),        # maybe, Jev 0.72, stays pending
    "mia_hooli": ("Mia Park", "mia.park@hooli.dev"),           # different person, Jev 0.08, rejected
}
SELF = {"dana", "dana_eu"}
VIPS = {"priya", "priya_s", "owen"}          # sample settings.vipEntityIds resolve to Priya Shah and Owen Price
LOW_KINDS = {"newsletter", "receipt", "notification", "cold_pitch"}

def name(k): return P[k][0]
def email(k): return P[k][1]
def addr(k): return "%s <%s>" % P[k]

# ------------------------------------------------------------------ judgments (Jev item-v1, SPEC 9.1)
JUDG = {}
def judge(ref, occurred, people, kind="person_email", needs=0.1, ball="nobody", ballc=0.7, imp=1, wrote_last=False, lane=None):
    """ref = '<platform>:<externalId>'. Items older than 90 days get no Jev judgment (rules)."""
    if days_of(occurred) < -90:
        return
    if lane is None:
        if any(p in VIPS for p in people) and kind not in LOW_KINDS:
            lane = "vip"
        elif needs >= 0.6 or (ball == "me" and ballc >= 0.6):
            lane = "needs_you"
        elif ball == "them" and wrote_last:
            lane = "waiting"
        elif kind in LOW_KINDS or imp == 0:
            lane = "low"
        else:
            lane = "fyi"
    JUDG[ref] = {"kind": kind, "needs_you": needs, "ball": ball, "ball_p": ballc, "importance": imp, "lane": lane}

COUNTS = {}

def shaped(action_id, doc):
    return "%s Response Fields (One CLI 2.10.0 actions load, 2026-10-29), %s" % (action_id, doc)

# ================================================================== HubSpot
HS = {
    "account": "conn_mod_def::GJ3jRLECRkM::lBDjqllWStu_7SjZb1LvSg",
    "contacts": "conn_mod_def::GJ3kSC2Sp7I::L6cYnwOfTUatg0cXeWjCBA",
    "companies": "conn_mod_def::GJ3kQvNreBM::Zpab8Ig5TSivqCj1UhG37w",
    "deals": "conn_mod_def::GJ3kYWYoo38::XLCOkotzRHyXigkeSyVCKg",
    "notes": "conn_mod_def::GJ3k1yj_vd8::B3vvaICzRKeqGbG66JUHDQ",
}
PORTAL = 48213907
OWNER = {"sam": "71001", "dana": "71002"}

def hs_record(rid, created, modified, props, rec_type, mod_key):
    props = dict(props)
    props[mod_key] = rel(modified)
    props.setdefault("createdate" if rec_type != "notes" else "hs_createdate", rel(created))
    out = {
        "archived": False,
        "createdAt": rel(created),
        "id": rid,
        "properties": props,
        "updatedAt": rel(modified),
    }
    if rec_type != "contacts":
        out["url"] = "https://app.hubspot.com/contacts/%d/record/%s/%s" % (PORTAL, {"companies": "0-2", "deals": "0-3", "notes": "0-46"}[rec_type], rid)
    return out

def hs_pages(rec_type, records, action, page_size=None, mod_key="hs_lastmodifieddate"):
    pages = []
    chunks = [records] if not page_size else [records[i:i + page_size] for i in range(0, len(records), page_size)]
    for i, ch in enumerate(chunks):
        resp = {"total": len(records), "results": ch}
        if i + 1 < len(chunks):
            after = "hs-%s-after-%d" % (rec_type, (i + 1) * len(ch))
            nxt = {"after": after}
            if rec_type == "contacts":
                nxt["link"] = "https://api.hubapi.com/crm/v3/objects/contacts/search?after=" + after
            resp["paging"] = {"next": nxt}
        pages.append({"match": {"cursor": None if i == 0 else "hs-%s-after-%d" % (rec_type, i * len(chunks[0]))}, "response": resp})
    return {
        "$shapedFrom": shaped(action, "docs/research/one-actions.md section 1"),
        "actionId": action, "pages": pages,
    }

hs_contacts = [
    ("201", "priya", "Globex", "VP Partnerships", "customer", "OPEN_DEAL", "sam", "-220d 10:00", "-2d 16:20", "Chicago", "United States", "+1 312 555 0142"),
    ("202", "marco", "Globex", "Legal Counsel", "customer", "", "sam", "-60d 09:00", "-3d 11:00", "Chicago", "United States", ""),
    ("203", "hannah", "Umbrella", "Procurement Lead", "opportunity", "IN_PROGRESS", "dana", "-75d 08:30", "-3d 09:10", "Berlin", "Germany", "+49 30 5550 1188"),
    ("204", "felix", "Umbrella", "CFO", "opportunity", "", "dana", "-75d 08:40", "-6d 14:00", "Berlin", "Germany", ""),
    ("205", "ravi", "Initech", "CTO", "salesqualifiedlead", "IN_PROGRESS", "dana", "-120d 13:00", "-3d 17:30", "Austin", "United States", ""),
    ("206", "owen", "Northwind Ventures", "Partner", "other", "", "dana", "-400d 12:00", "-2d 09:00", "San Francisco", "United States", ""),
    ("207", "jules", "Hooli", "Founder", "lead", "NEW", "sam", "-1d 08:30", "-1d 08:30", "Austin", "United States", ""),
    ("208", "grace", "Initrode", "Head of Operations", "lead", "ATTEMPTED_TO_CONTACT", "sam", "-14d 10:00", "-7d 15:00", "Denver", "United States", ""),
]
recs = []
for rid, k, comp, title, life, lead, owner, created, modified, city, country, phone in hs_contacts:
    first, last = name(k).split(" ", 1)
    props = {"email": email(k), "firstname": first, "lastname": last, "company": comp, "jobtitle": title,
             "lifecyclestage": life, "hubspot_owner_id": OWNER[owner], "city": city, "country": country}
    if lead: props["hs_lead_status"] = lead
    if phone: props["phone"] = phone
    r = hs_record(rid, created, modified, props, "contacts", "lastmodifieddate")
    recs.append(r)
    judge("hubspot:" + rid, created, [k], kind="customer", imp=2 if k in ("priya", "hannah") else 1)
# HubSpot search sorts ascending by modified; the order here is by id (the transport does not sort).
write("hubspot/contacts.pages.json", hs_pages("contacts", recs, HS["contacts"], page_size=5, mod_key="lastmodifieddate"))
COUNTS["hubspot.contacts"] = len(recs)

hs_companies = [
    ("301", "Globex", "globex.com", "COMPUTER_SOFTWARE", "Global logistics software. Acme customer since 2024.", "Chicago", "United States", "1200", "customer", "-400d 10:00", "-2d 16:25"),
    ("302", "Umbrella", "umbrella.co", "PHARMACEUTICALS", "Expanding Acme to its EU entities.", "Berlin", "Germany", "5400", "opportunity", "-90d 09:00", "-3d 09:15"),
    ("303", "Initech", "initech.io", "INFORMATION_TECHNOLOGY_AND_SERVICES", "Data platform. Running a paid pilot.", "Austin", "United States", "300", "salesqualifiedlead", "-130d 12:00", "-3d 17:35"),
    ("304", "Northwind Ventures", "northwind.vc", "VENTURE_CAPITAL_PRIVATE_EQUITY", "Lead investor in Acme's Series A.", "San Francisco", "United States", "25", "other", "-500d 12:00", "-20d 10:00"),
    ("305", "Hooli", "hooli.dev", "COMPUTER_SOFTWARE", "Early stage developer tools startup.", "Austin", "United States", "12", "lead", "-1d 08:31", "-1d 08:31"),
    ("306", "Initrode", "initrode.com", "LOGISTICS_AND_SUPPLY_CHAIN", "Regional freight company, evaluating the starter plan.", "Denver", "United States", "850", "lead", "-14d 10:05", "-7d 15:05"),
]
recs = []
for rid, nm, dom, ind, desc, city, country, emp, life, created, modified in hs_companies:
    recs.append(hs_record(rid, created, modified, {"name": nm, "domain": dom, "industry": ind, "description": desc, "city": city,
                                                   "country": country, "numberofemployees": emp, "lifecyclestage": life,
                                                   "hubspot_owner_id": OWNER["dana"]}, "companies", "hs_lastmodifieddate"))
    judge("hubspot:" + rid, created, [], kind="customer", imp=1)
write("hubspot/companies.pages.json", hs_pages("companies", recs, HS["companies"]))
COUNTS["hubspot.companies"] = len(recs)

hs_deals = [
    ("401", "Globex renewal 2027", "84000", "USD", "contractsent", "+16d 00:00", "Annual renewal at the 2027 rate. Priya is the champion; legal redline is final.", "sam", "-45d 10:00", "-6h"),
    ("402", "Umbrella EU expansion", "120000", "EUR", "decisionmakerboughtin", "+40d 00:00", "Roll Acme out to Umbrella's three EU entities. Procurement questionnaire in progress.", "dana", "-70d 09:00", "-3d 09:20"),
    ("403", "Initrode starter plan", "18000", "USD", "qualifiedtobuy", "+30d 00:00", "Starter plan for the Denver operations team.", "sam", "-14d 10:10", "-7d 15:10"),
    ("404", "Hooli design partner", "12000", "USD", "appointmentscheduled", "+60d 00:00", "Inbound from the founder. Intro call was cancelled.", "sam", "-1d 08:40", "-1d 08:40"),
]
recs = []
for rid, nm, amt, cur, stage, close, desc, owner, created, modified in hs_deals:
    recs.append(hs_record(rid, created, modified, {"dealname": nm, "amount": amt, "deal_currency_code": cur, "dealstage": stage,
                                                   "closedate": rel(close), "pipeline": "default", "description": desc,
                                                   "hubspot_owner_id": OWNER[owner]}, "deals", "hs_lastmodifieddate"))
judge("hubspot:401", "-45d", ["priya"], kind="customer", imp=3)
judge("hubspot:402", "-70d", ["hannah"], kind="customer", imp=3)
judge("hubspot:403", "-14d", ["grace"], kind="customer", imp=2)
judge("hubspot:404", "-1d", ["jules"], kind="customer", imp=1)
write("hubspot/deals.pages.json", hs_pages("deals", recs, HS["deals"]))
COUNTS["hubspot.deals"] = len(recs)

hs_notes = [
    ("501", "<p>Call with Priya. Globex wants the 2027 rate locked and asked about a <strong>multi-year discount</strong>. Legal (Marco) owns the MSA redline.</p>", "-3d 15:00", "-3d 15:05", ["priya", "marco"], 2),
    ("502", "<p>Hannah sent Umbrella's procurement questionnaire. 42 questions, security section is the long one. Lena can answer the EU data residency part.</p>", "-4d 10:00", "-4d 10:02", ["hannah", "lena"], 2),
    ("503", "<p>Grace at Initrode wants a quote for 40 seats on the starter plan. Follow up after their ops review.</p>", "-7d 15:00", "-7d 15:00", ["grace"], 1),
    ("504", "<p>Globex legal confirmed the liability cap. Marco will send the final redline this week.</p>", "-6d 11:00", "-6d 11:00", ["marco", "priya"], 2),
    ("505", "<p>Owen asked for Q3 numbers before the board date. Theo is drafting the deck.</p>", "-9d 09:30", "-9d 09:30", ["owen"], 2),
]
recs = []
for rid, body, ts, modified, ppl, imp in hs_notes:
    recs.append(hs_record(rid, ts, modified, {"hs_note_body": body, "hs_timestamp": rel(ts), "hubspot_owner_id": OWNER["dana"]}, "notes", "hs_lastmodifieddate"))
    judge("hubspot:" + rid, ts, ppl, kind="customer", imp=imp)
write("hubspot/notes.pages.json", hs_pages("notes", recs, HS["notes"]))
COUNTS["hubspot.notes"] = len(recs)

write("hubspot/account.json", {
    "$shapedFrom": shaped(HS["account"], "Get HubSpot Account Details"),
    "actionId": HS["account"],
    "response": {"additionalCurrencies": ["EUR"], "utcOffset": "-07:00", "companyCurrency": "USD", "portalId": PORTAL,
                 "accountType": "STANDARD", "uiDomain": "app.hubspot.com", "timeZone": "America/Los_Angeles",
                 "dataHostingLocation": "NA", "utcOffsetMilliseconds": -25200000},
})

# ================================================================== Attio
AT = {
    "records": "conn_mod_def::GJ0CbN-LPiU::A6h6M9QkS0Cs2Lt9CdPH7Q",   # List an Object's Records (POST /objects/{object}/records/query)
    "notes": "conn_mod_def::GJ0CZucANAI::qH4Oc4NvS1GWLSVnKugSCA",     # List Notes (GET)
}
def at_id(kind, key): return uid("attio", kind, key)
AT_WS = uid("attio", "workspace")
AT_OBJ = {o: uid("attio", "object", o) for o in ("people", "companies", "deals")}
AT_DANA = uid("attio", "member", "dana")

def av(attribute_type, **fields):
    """One Attio attribute value, as the native API answers it (active, with its actor)."""
    return dict(fields, active_from=rel("-150d 09:00"), active_until=None,
                created_by_actor={"type": "workspace-member", "id": AT_DANA}, attribute_type=attribute_type)
def at_text(v): return [av("text", value=v)] if v else []
def at_option(title): return av("select", option={"id": {"workspace_id": AT_WS, "option_id": uid("attio", "option", title)}, "title": title, "is_archived": False})
def at_ref(obj, rid): return av("record-reference", target_object=obj, target_record_id=rid)
def at_record(obj, rid, created, values):
    return {"id": {"workspace_id": AT_WS, "object_id": AT_OBJ[obj], "record_id": rid}, "created_at": rel(created),
            "web_url": "https://app.attio.com/acme/%s/%s" % ({"people": "person", "companies": "company", "deals": "deal"}[obj], rid),
            "values": values}

def attio_page(obj, records):
    return {
        "$shapedFrom": shaped(AT["records"], "List an Object's Records, object=%s" % obj),
        "actionId": AT["records"],
        "pages": [{"match": {"cursor": None, "request": {"pathParams": {"object": obj}}}, "response": {"data": records}}],
    }

at_companies = [
    ("globex", "Globex", "globex.com", "Global logistics software.", "1K-5K", ["B2B", "SaaS", "Logistics"], ("Chicago", "IL", "US"), ["priya", "marco"]),
    ("initech", "Initech", "initech.io", "Data platform for mid-market finance teams.", "251-1K", ["B2B", "Data"], ("Austin", "TX", "US"), ["ravi", "anika"]),
    ("hooli", "Hooli", "hooli.dev", "Developer tools for API teams.", "11-50", ["B2B", "Developer tools"], ("Austin", "TX", "US"), ["jules", "tom"]),
    ("northwind", "Northwind Ventures", "northwind.vc", "Seed and Series A fund.", "11-50", ["Investor"], ("San Francisco", "CA", "US"), ["owen"]),
    ("umbrella", "Umbrella", "umbrella.co", "Pharmaceutical group with EU entities.", "5K-10K", ["Enterprise", "Pharma"], ("Berlin", None, "DE"), []),
]
def loc(city, region, cc):
    return [av("location", line_1=None, line_2=None, line_3=None, line_4=None, locality=city, region=region,
               postcode=None, country_code=cc, latitude=None, longitude=None)]

recs = []
for key, nm, dom, desc, rng, cats, (city, region, cc), team in at_companies:
    cid = at_id("companies", key)
    values = {"name": at_text(nm), "domains": [av("domain", domain=dom, root_domain=dom)], "description": at_text(desc),
              "employee_range": [at_option(rng)], "categories": [at_option(c) for c in cats], "primary_location": loc(city, region, cc),
              "team": [at_ref("people", at_id("people", t)) for t in team]}
    recs.append(at_record("companies", cid, "-150d 09:00", values))
write("attio/companies.pages.json", attio_page("companies", recs))
COUNTS["attio.companies"] = len(recs)

at_people = [
    ("priya", "VP Partnerships", "Champion on the Globex renewal.", "globex", "-30d 10:00", "+1 312 555 0142"),
    ("ravi", "CTO", "Technical owner of the Initech pilot.", "initech", "-40d 11:00", None),
    ("anika", "Head of Data", "Runs the pilot's data import on the Initech side.", "initech", "-40d 11:05", None),
    ("jules", "Founder", "Inbound cold pitch. Wants a design partnership.", "hooli", "-1d 08:35", None),
    ("tom", "CTO", "Cofounder at Hooli.", "hooli", "-1d 08:36", None),
    ("owen", "Partner", "Board member. Wants the Q3 update before the board date.", "northwind", "-60d 12:00", None),
    ("marco", "Legal Counsel", "Owns the Globex MSA redline.", "globex", "-30d 10:05", None),
]
recs = []
for k, title, desc, comp, created, phone in at_people:
    pid = at_id("people", k)
    full = name(k)
    first, _, last = full.partition(" ")
    em = email(k)
    values = {"name": [av("personal-name", first_name=first, last_name=last or None, full_name=full)],
              "email_addresses": [av("email-address", original_email_address=em, email_address=em, email_domain=em.split("@")[1],
                                     email_root_domain=em.split("@")[1], email_local_specifier=em.split("@")[0])],
              "job_title": at_text(title), "description": at_text(desc), "company": [at_ref("companies", at_id("companies", comp))],
              "phone_numbers": [av("phone-number", original_phone_number=phone, phone_number=phone.replace(" ", ""), country_code="US")] if phone else []}
    recs.append(at_record("people", pid, created, values))
    judge("attio:" + pid, created, [k], kind="customer", imp=2 if k in ("priya", "ravi") else 1)
write("attio/people.pages.json", attio_page("people", recs))
COUNTS["attio.people"] = len(recs)
for key, *_ in at_companies:
    judge("attio:" + at_id("companies", key), "-150d", [], kind="customer")

at_deals = [
    ("initech", "Initech pilot", "Discovery", 36000, "USD", "initech", ["ravi", "anika"], "-40d 11:10"),
    ("globex", "Globex renewal 2027", "Contract sent", 84000, "USD", "globex", ["priya", "marco"], "-30d 10:10"),
    ("hooli", "Hooli design partner", "Lead", 15000, "USD", "hooli", ["jules"], "-1d 08:40"),
]
recs = []
for key, nm, stage, amount, cur, comp, ppl, created in at_deals:
    did = at_id("deals", key)
    values = {"name": at_text(nm),
              "stage": [av("status", status={"id": {"workspace_id": AT_WS, "status_id": uid("attio", "status", stage)}, "title": stage, "is_archived": False})],
              "value": [av("currency", currency_value=amount, currency_code=cur)],
              "owner": [av("actor-reference", referenced_actor_type="workspace-member", referenced_actor_id=AT_DANA)],
              "associated_company": [at_ref("companies", at_id("companies", comp))],
              "associated_people": [at_ref("people", at_id("people", p)) for p in ppl]}
    recs.append(at_record("deals", did, created, values))
    judge("attio:" + did, created, ppl, kind="customer", imp=3 if key != "hooli" else 1)
write("attio/deals.pages.json", attio_page("deals", recs))
COUNTS["attio.deals"] = len(recs)

at_notes = [
    ("n1", "people", at_id("people", "priya"), "Priya: multi-year ask",
     "Priya wants a multi-year discount quoted before she takes the renewal to her CFO. Two years at 8% off is the ceiling Sam approved.", "-2d 17:00", ["priya"]),
    ("n2", "people", at_id("people", "ravi"), "Initech pilot scope",
     "Ravi confirmed the pilot covers two data sources and one team. Success means the nightly CSV import runs under 10 minutes.", "-8d 12:00", ["ravi"]),
    ("n3", "companies", at_id("companies", "hooli"), "Hooli triage",
     "Inbound from Jules. Too early for us; keep warm, no call this quarter.", "-1d 10:00", ["jules"]),
]
data = []
for nid, pobj, prid, title, text, created, ppl in at_notes:
    note_id = uid("attio", "note", nid)
    data.append({"id": {"workspace_id": uid("attio", "workspace"), "note_id": note_id}, "parent_object": pobj, "parent_record_id": prid,
                 "title": title, "meeting_id": None, "content_plaintext": text, "content_markdown": text,
                 "tags": [{"type": "workspace-member", "workspace_member_id": uid("attio", "member", "dana")}],
                 "created_by_actor": {"id": uid("attio", "member", "dana"), "type": "workspace-member"},
                 "created_at": rel(created)})
    judge("attio:" + note_id, created, ppl, kind="customer", imp=2 if nid != "n3" else 0)
write("attio/notes.pages.json", {
    "$shapedFrom": shaped(AT["notes"], "docs/research/one-actions.md section 2"),
    "actionId": AT["notes"],
    "pages": [{"match": {"cursor": None}, "response": {"data": data}}],
})
COUNTS["attio.notes"] = len(data)

# ================================================================== Gmail
GM = {"list": "conn_mod_def::GJ3ok-Q0D40::oLWNlcx4QDORaL_18z-MsQ",     # List a User's Gmail Threads (GET)
      "thread": "conn_mod_def::GJ3ok0Eq0R8::AAzgZVLqTg2iBuITKpJLZg",   # Get a User's Thread (GET, format=full)
      "profile": "conn_mod_def::GJ3oa8bJZNA::ZS9kXmE_Rzi4utfESor_ng"}
threads = []
THREAD_META = []

import base64
def b64url(text): return base64.urlsafe_b64encode(text.encode("utf-8")).decode("ascii").rstrip("=")

def gm_message(tid, i, frm, to, when, subject, body, labels, cc=None, attachments=None):
    """A Gmail users.messages resource (format=full): headers and a base64url MIME tree."""
    mid = hexid("gm", tid, str(i))
    receiver = ", ".join(addr(t) if t in P else t for t in to)
    headers = [{"name": "From", "value": addr(frm) if frm in P else frm}, {"name": "To", "value": receiver},
               {"name": "Subject", "value": subject}, {"name": "Date", "value": rel_rfc(when)},
               {"name": "Message-ID", "value": "<%s@mail.acme.example>" % mid}]
    if cc: headers.append({"name": "Cc", "value": ", ".join(addr(t) if t in P else t for t in cc)})
    text = nodash(body)
    html = "<div dir=\"ltr\">%s</div>" % "<br>".join(text.split("\n"))
    alt = {"partId": "0" if attachments else "", "mimeType": "multipart/alternative", "filename": "", "headers": [], "body": {"size": 0},
           "parts": [{"partId": "0.0" if attachments else "0", "mimeType": "text/plain", "filename": "", "headers": [], "body": {"size": len(text.encode()), "data": b64url(text)}},
                     {"partId": "0.1" if attachments else "1", "mimeType": "text/html", "filename": "", "headers": [], "body": {"size": len(html.encode()), "data": b64url(html)}}]}
    if attachments:
        parts = [alt] + [{"partId": str(j + 1), "mimeType": a["mimeType"], "filename": a["filename"], "headers": [],
                          "body": {"size": a["size"], "attachmentId": "ANGjdJ" + hexid("att", mid, str(j), n=24)}} for j, a in enumerate(attachments)]
        payload = {"partId": "", "mimeType": "multipart/mixed", "filename": "", "headers": headers, "body": {"size": 0}, "parts": parts}
    else:
        payload = dict(alt, headers=headers, partId="")
    return {"id": mid, "threadId": tid, "labelIds": labels, "snippet": body.replace("\n", " ")[:120],
            "historyId": str(5120000 + len(threads) * 10 + i), "internalDate": rel_ms_str(when), "sizeEstimate": 2048 + len(body),
            "payload": payload}

def thread(key, subject, msgs, kind="person_email", needs=0.1, ball="nobody", ballc=0.7, imp=1, lane=None, unread_last=False):
    """msgs: list of (from, [to], when, body[, attachments])"""
    tid = hexid("gm-thread", key)
    out = []
    for i, m in enumerate(msgs):
        frm, to, when, body = m[0], m[1], m[2], m[3]
        att = m[4] if len(m) > 4 else None
        labels = ["SENT"] if frm == "dana" else ["INBOX", "CATEGORY_PERSONAL"]
        if kind in ("newsletter",): labels = ["INBOX", "CATEGORY_PROMOTIONS"]
        if kind in ("receipt", "notification"): labels = ["INBOX", "CATEGORY_UPDATES"]
        if unread_last and i == len(msgs) - 1 and frm != "dana": labels = ["UNREAD"] + labels
        out.append(gm_message(tid, i, frm, to, when, subject if i == 0 else "Re: " + subject.removeprefix("Re: "), body, labels, attachments=att))
    t = {"id": tid, "snippet": out[-1]["snippet"], "historyId": out[-1]["historyId"], "messages": out}
    threads.append((days_of(msgs[-1][2]), msgs[-1][2], t))
    people = set()
    for m in msgs:
        people.add(m[0])
        people.update(x for x in m[1] if x in P)
    people -= SELF
    judge("gmail:" + tid, msgs[0][2], list(people), kind=kind, needs=needs, ball=ball, ballc=ballc, imp=imp,
          wrote_last=(msgs[-1][0] == "dana"), lane=lane)
    THREAD_META.append((key, tid))
    return tid

T_RENEWAL = thread("renewal", "Globex renewal terms", [
    ("dana", ["priya"], "-4d 09:12", "Hi Priya,\n\nAttached are the 2027 renewal terms we discussed. Same scope, 84,000 a year, rate locked for the term.\n\nDana"),
    ("priya", ["dana"], "-3d 16:40", "Thanks Dana. Legal is reviewing the MSA now. Could you include the SSO rollout date in the order form?"),
    ("dana", ["priya"], "-3d 17:05", "Done. SSO is scheduled for the week after signature. Updated order form attached."),
    ("priya", ["dana"], "-1d 10:22", "Great. Marco will send the final redline. One more thing: can you quote a two year term as well?"),
    ("priya", ["dana"], "-6h", "Happy to lock the annual rate if we can get the MSA signed by Friday. Let me know on the multi-year quote."),
], kind="customer", needs=0.82, ball="me", ballc=0.84, imp=3, unread_last=True)
thread("security", "Globex security questionnaire", [
    ("priya", ["dana"], "-5d 11:30", "Dana, our security team sent the attached questionnaire. Mostly standard, plus two questions on SSO.", [{"filename": "Globex-security-2026.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "size": 48211}]),
    ("dana", ["priya"], "-4d 15:10", "Answered and attached. Mia confirmed the SSO answers."),
], kind="customer", ball="them", ballc=0.7, imp=2)
thread("marco_intro", "Intro: Marco from Globex legal", [
    ("priya", ["dana", "marco"], "-9d 13:00", "Dana, meet Marco, our counsel. He will run the MSA redline from our side. Marco, Dana leads the renewal at Acme."),
], kind="customer", imp=2)
thread("welcome", "Welcome to Acme Inc, Priya", [
    ("dana", ["priya"], "-42d 09:00", "Great to meet you at the conference. Let's find 20 minutes next week to walk through the renewal."),
    ("priya", ["dana"], "-41d 14:30", "Thanks Dana, Tuesday works."),
], kind="customer", imp=1)
thread("pilot_import", "Pilot data import", [
    ("ravi", ["dana"], "-3d 08:15", "Dana, the nightly import failed again on our 80 MB export. Anika attached the log. Can your team look before Friday's check-in?", [{"filename": "import-log.txt", "mimeType": "text/plain", "size": 12004}]),
    ("dana", ["ravi", "mia"], "-3d 09:40", "Thanks Ravi. Looping in Mia, who owns imports. We will get back to you today."),
    ("ravi", ["dana"], "-2d 18:05", "Any update? Our CFO is asking whether the pilot is on track. Can you confirm the fix date?"),
], kind="customer", needs=0.88, ball="me", ballc=0.86, imp=3)
thread("kickoff_agenda", "Initech pilot kickoff agenda", [
    ("dana", ["ravi", "anika"], "-9d 16:00", "Agenda for tomorrow: scope, success criteria, data access, check-in cadence."),
    ("ravi", ["dana"], "-9d 17:20", "Looks good. Anika will join for the data part."),
], kind="customer", imp=1)
thread("q3_update", "Q3 update and board date", [
    ("owen", ["dana"], "-4d 07:30", "Dana, can you send the Q3 numbers before we lock the board date? The partners meet Monday."),
    ("dana", ["owen", "theo"], "-3d 12:00", "Theo is finishing the deck. Numbers by Thursday. Board date proposals attached."),
    ("owen", ["dana"], "-2d 08:45", "Thursday works. Let's hold November 18 for the board."),
], kind="investor", imp=3)
thread("portfolio_cfo", "Northwind portfolio CFO intro", [
    ("owen", ["dana"], "-20d 10:00", "Intro to a CFO in our portfolio who is shopping for exactly what Acme sells. Want me to connect you?"),
], kind="investor", imp=2)
thread("cold_pitch", "Quick idea for Acme's sales team", [
    ("jules", ["dana", "mia_hooli"], "-1d 08:20", "Hi Dana, I'm the founder of Hooli (cc my cofounder Mia). We help sales teams turn call notes into CRM updates. Worth 15 minutes?"),
], kind="cold_pitch", imp=0)
thread("pipeline_numbers", "Pipeline review numbers for Thursday", [
    ("sam", ["dana"], "-1d 16:00", "Pipeline is at 1.9M. Globex and Umbrella are 60% of the quarter. Sheet attached.", [{"filename": "pipeline-q4.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "size": 30455}]),
    ("dana", ["sam"], "-1d 17:30", "Thanks. Add the Initrode starter deal at 18k."),
], kind="team_chat", imp=2)
thread("migration", "HubSpot to Attio migration checklist", [
    ("sam", ["dana"], "-6d 11:00", "Checklist for moving the pipeline from HubSpot to Attio. Contacts and companies first, deals once Globex closes."),
], kind="team_chat", imp=1)
thread("sso_priority", "Need sales input on SSO priority", [
    ("mia", ["dana"], "-2d 10:00", "Dana, Globex and Initech both asked for SSO. We can ship one this sprint. Which customer goes first?"),
    ("mia", ["dana"], "-1d 09:30", "Bumping this. I need an answer by tomorrow to plan the sprint."),
], kind="team_chat", needs=0.9, ball="me", ballc=0.9, imp=3)
thread("pricing_copy", "Pricing page copy review", [
    ("theo", ["dana"], "-3d 14:00", "New pricing page copy is in the doc. Mostly FYI, comments welcome until Friday."),
], kind="internal_doc", needs=0.3, imp=1)
thread("board_deck", "Board deck draft", [
    ("theo", ["dana"], "-1d 13:00", "Draft deck attached. Can you review the sales slides and send edits by Thursday?", [{"filename": "Acme-Q3-board.pdf", "mimeType": "application/pdf", "size": 2201554}]),
    ("theo", ["dana"], "-4h", "Owen asked to see it Thursday morning, so edits by Wednesday night would help."),
], kind="team_chat", needs=0.86, ball="me", ballc=0.82, imp=3)
thread("csv_sample", "CSV export sample for the pilot", [
    ("anika", ["dana", "mia"], "-4d 12:00", "Sharing a sanitized sample of our export so Mia can reproduce the import issue."),
], kind="customer", imp=2)
thread("starter_plan", "Starter plan questions", [
    ("grace", ["dana"], "-8d 09:00", "Does the starter plan include the API? We have 40 people in operations."),
    ("dana", ["grace"], "-7d 14:00", "It does. I can send a quote for 40 seats once your ops review is done. When is it?"),
], kind="customer", ball="them", ballc=0.8, imp=2)
thread("news1", "Revenue Weekly: forecasting in a slow quarter", [
    ("Revenue Weekly <news@revenueweekly.example>", ["dana"], "-1d 06:00", "This week: forecasting in a slow quarter, plus five templates for pipeline reviews."),
], kind="newsletter", imp=0)
thread("news2", "The Field Notes digest", [
    ("Field Notes <digest@fieldnotes.example>", ["dana"], "-3d 06:00", "Ten stories from sales leaders this week."),
], kind="newsletter", imp=0)
thread("news3", "Webinar: running EU procurement", [
    ("Procurement Today <events@procurementtoday.example>", ["dana"], "-8d 06:30", "Join us Thursday to learn how EU procurement teams evaluate software."),
], kind="newsletter", imp=0)
thread("receipt1", "Your receipt from Cloudhost", [
    ("Cloudhost Billing <receipts@cloudhost.example>", ["dana"], "-2d 03:00", "Receipt for October. Total 249.00 USD. Thank you for your business."),
], kind="receipt", imp=0)
thread("receipt2", "Trip confirmation: SFO to ORD", [
    ("Skyway Travel <trips@skyway.example>", ["dana"], "-12d 19:00", "Your trip to Chicago is confirmed. Departs November 12, 8:05 AM."),
], kind="receipt", imp=0)
thread("security_review", "Initech security review follow-up", [
    ("ravi", ["dana"], "-60d 10:00", "Following up on the security review. All good on our side."),
    ("dana", ["ravi"], "-60d 12:00", "Thanks Ravi, sharing the SOC report link separately."),
], kind="customer", imp=1)
thread("coffee", "Coffee next week?", [
    ("owen", ["dana"], "-100d 09:00", "In the city next week, coffee?"),
    ("dana", ["owen"], "-100d 10:00", "Yes, Wednesday at 9."),
], kind="investor", imp=1)
thread("it_notice", "Your password expires in 5 days", [
    ("Acme IT <it@acme.com>", ["dana"], "-2d 07:00", "Your Acme password expires in 5 days. Change it from the account portal."),
], kind="notification", imp=0)

threads.sort(key=lambda x: x[0], reverse=True)    # newest activity first, as Gmail lists them
tlist = [t for _, _, t in threads]
assert len(tlist) == 24, len(tlist)
gm_pages = []
for i, chunk in enumerate([tlist[:12], tlist[12:]]):
    resp = {"threads": [{"id": t["id"], "snippet": t["snippet"], "historyId": t["historyId"]} for t in chunk], "resultSizeEstimate": 24}
    if i == 0: resp["nextPageToken"] = "gm-page-2"
    gm_pages.append({"match": {"cursor": None if i == 0 else "gm-page-2"}, "response": resp})
write("gmail/threads.pages.json", {"$shapedFrom": shaped(GM["list"], "List a User's Gmail Threads"),
                                   "actionId": GM["list"], "pages": gm_pages})
write("gmail/threads.details.json", {"$shapedFrom": shaped(GM["thread"], "Get a User's Thread, format=full"),
                                     "actionId": GM["thread"], "byId": {t["id"]: {"id": t["id"], "historyId": t["historyId"], "messages": t["messages"]} for t in tlist}})
COUNTS["gmail.threads"] = 24
write("gmail/account.json", {"$shapedFrom": shaped(GM["profile"], "Get a User's Gmail Profile"), "actionId": GM["profile"],
                             "response": {"emailAddress": "dana@acme.com", "messagesTotal": 18342, "threadsTotal": 6120, "historyId": "5121480"}})

# ------------------------------------------------------------------ Gmail, a second account (multi-account Connect)
# Dana also granted her personal Gmail. Its pages answer only the connection
# "sample:gmail:personal" (match.connection); account.json names the account.
GM_PERSONAL = "sample:gmail:personal"
DANA_HOME = "Dana Oyelaran <dana@acme.dev>"
personal = []
def personal_thread(key, subject, frm, when, body, kind):
    tid = hexid("gm-personal", key)
    labels = ["INBOX", "CATEGORY_UPDATES"] if kind in ("receipt", "notification") else ["INBOX", "CATEGORY_PERSONAL"]
    m = gm_message(tid, 0, frm, [DANA_HOME], when, subject, body, labels)
    personal.append((days_of(when), {"id": tid, "snippet": m["snippet"], "historyId": m["historyId"], "messages": [m]}))
    judge("gmail:" + tid, when, [], kind=kind, needs=0.1, imp=0 if kind in LOW_KINDS else 1)
personal_thread("lisbon", "Your Lisbon trip is confirmed", "Skyway Travel <trips@skyway.example>", "-5d 18:00",
                "Your flight to Lisbon is confirmed. Departs December 18, 7:40 AM. Seat 14C.", "receipt")
personal_thread("bookclub", "Book club, the November pick", "Mara Quinn <mara.quinn@acme.dev>", "-3d 20:00",
                "We picked the lighthouse novel for November. Meeting at mine on the 21st, 7 PM.", "person_email")
personal_thread("climbing", "Your climbing gym membership renews Nov 15", "Boulder Hall <hello@boulderhall.example>", "-1d 08:00",
                "Your monthly membership renews on November 15. Nothing to do if you want to keep climbing.", "notification")
personal.sort(key=lambda x: x[0], reverse=True)
ptl = [t for _, t in personal]
write("gmail-personal/threads.pages.json", {"$shapedFrom": shaped(GM["list"], "List a User's Gmail Threads"), "actionId": GM["list"],
    "pages": [{"match": {"cursor": None, "connection": GM_PERSONAL},
               "response": {"threads": [{"id": t["id"], "snippet": t["snippet"], "historyId": t["historyId"]} for t in ptl], "resultSizeEstimate": len(ptl)}}]})
write("gmail-personal/threads.details.json", {"$shapedFrom": shaped(GM["thread"], "Get a User's Thread, format=full"),
                                              "actionId": GM["thread"], "byId": {t["id"]: t for t in ptl}})
write("gmail-personal/account.json", {"$shapedFrom": shaped(GM["profile"], "Get a User's Gmail Profile"), "actionId": GM["profile"],
                                      "connection": GM_PERSONAL, "platform": "gmail", "label": "dana@acme.dev",
                                      "response": {"emailAddress": "dana@acme.dev", "messagesTotal": 2210, "threadsTotal": 940, "historyId": "771204"}})

# ================================================================== Outlook Mail
OL = {"messages": "conn_mod_def::GMIYwcOQ0W0::zXQUrHvhTy-rXQG3h50Paw", "me": "conn_mod_def::GMIYxNZ51eU::xY4rcCXiTTyrarjC9ac97w"}
FOLDER_INBOX = "AQMkADAcmeEuInboxAAAA=="
FOLDER_SENT = "AQMkADAcmeEuSentItemsAA=="
ol_msgs = []
def recip(k): return {"emailAddress": {"name": P[k][0], "address": P[k][1]} if k in P else {"name": k.split("@")[0], "address": k}}
def ol_conv(key, subject, msgs, kind="customer", imp=1, judged=None):
    """msgs: (from, [to], [cc], when, html). judged: index of the message carrying the needs_you judgment."""
    conv = "AAQkADAcmeEu" + hexid("ol-conv", key, n=20) + "="
    for i, (frm, to, cc, when, html) in enumerate(msgs):
        mid = "AAMkADAcmeEu" + hexid("ol-msg", key, str(i), n=24) + "="
        mine = frm == "dana_eu"
        text = re.sub(r"<[^>]+>", " ", html).strip()
        m = {
            "@odata.etag": 'W/"CQAAABYAAAB%s"' % hexid("etag", mid, n=10),
            "id": mid, "categories": [], "changeKey": "CQAAABYAAAB" + hexid("ck", mid, n=10),
            "createdDateTime": rel(when), "lastModifiedDateTime": rel(when),
            "body": {"contentType": "html", "content": html}, "bodyPreview": text[:255],
            "ccRecipients": [recip(c) for c in cc], "conversationId": conv,
            "from": recip(frm), "hasAttachments": False, "isDraft": False, "isRead": mine or days_of(when) < -1,
            "parentFolderId": FOLDER_SENT if mine else FOLDER_INBOX,
            "receivedDateTime": rel(when), "sentDateTime": rel(when),
            "subject": subject if i == 0 else "RE: " + subject, "toRecipients": [recip(t) for t in to],
            "webLink": "https://outlook.office.com/owa/?ItemID=%s&exvsurl=1&viewmodel=ReadMessageItem" % mid.replace("=", "%3D"),
        }
        ol_msgs.append((days_of(when), m))
        people = {frm, *to, *cc} - SELF
        jd = judged if judged else {}
        if i in jd:
            judge("outlook-mail:" + mid, when, list(people), **jd[i])
        else:
            judge("outlook-mail:" + mid, when, list(people), kind=kind, imp=imp, ball="them" if mine else "nobody",
                  wrote_last=mine and i == len(msgs) - 1)
    return conv

ol_conv("redline", "Globex legal redline, final", [
    ("marco", ["dana_eu"], ["priya"], "-2d 08:10", "<p>Dana,</p><p>Attached is the final MSA redline with the liability cap we agreed. Priya's team is ready to sign once you confirm.</p><p>Marco</p>"),
    ("dana_eu", ["marco"], ["priya"], "-2d 10:30", "<p>Thanks Marco. Reviewing with our counsel today, expect a signed copy this week.</p>"),
], imp=3)
ol_conv("questionnaire", "Procurement questionnaire", [
    ("hannah", ["dana_eu"], ["lena"], "-6d 09:00", "<p>Hello Dana, please find Umbrella's supplier questionnaire attached. We need it back within two weeks.</p>"),
    ("dana_eu", ["hannah"], ["lena"], "-5d 11:00", "<p>Thanks Hannah. Lena will answer the data residency section, I will take the rest.</p>"),
    ("hannah", ["dana_eu"], [], "-1d 07:45", "<p>Dana, can you send the completed questionnaire by Friday? Our committee meets Monday and needs your answers on data residency and SSO.</p>"),
], imp=3, judged={2: dict(kind="customer", needs=0.84, ball="me", ballc=0.8, imp=3)})
ol_conv("eu_pricing", "Umbrella EU expansion pricing", [
    ("felix", ["dana_eu"], ["lena"], "-4d 13:00", "<p>Dana, before procurement signs off we need pricing per entity. Three entities, about 400 seats total.</p>"),
    ("dana_eu", ["felix"], ["lena"], "-3d 16:00", "<p>Felix, pricing per entity is attached. Happy to walk through it on a call.</p>"),
], imp=2)
ol_conv("ledger_gonogo", "Ledger 2.0 go/no-go prep", [
    ("lena", ["dana_eu"], [], "-1d 12:00", "<p>Dana, for the go/no-go: EU customers need tax IDs on invoices before launch (LED-161). Flagging so sales can set expectations.</p>"),
], kind="team_chat", imp=2)
ol_conv("vat", "Invoice entity for Acme Europe", [
    ("felix", ["dana_eu"], [], "-9d 10:00", "<p>Which Acme entity will invoice Umbrella's German subsidiary?</p>"),
    ("dana_eu", ["felix"], ["lena"], "-8d 09:00", "<p>Acme Europe B.V. will invoice all EU entities. Lena has the VAT details.</p>"),
], imp=1)
ol_conv("allhands", "Acme Europe all-hands", [
    ("people@acme.eu", ["dana_eu"], [], "-5d 06:00", "<p>Reminder: the Acme Europe all-hands is next week in Amsterdam.</p>"),
], kind="notification", imp=0)
ol_conv("dpa", "Globex data processing agreement", [
    ("marco", ["dana_eu"], [], "-12d 09:30", "<p>Dana, Globex needs our standard DPA signed alongside the MSA. Attached.</p>"),
    ("dana_eu", ["marco"], [], "-11d 14:00", "<p>Signed DPA attached.</p>"),
], imp=2)
ol_conv("m365", "Your Microsoft 365 renewal notice", [
    ("billing@acme.eu", ["dana_eu"], [], "-15d 05:00", "<p>Your subscription renews on November 30.</p>"),
], kind="receipt", imp=0)

ol_msgs.sort(key=lambda x: x[0])              # $orderby=lastModifiedDateTime asc
ol_list = [m for _, m in ol_msgs]
assert len(ol_list) == 14
NEXT = "https://graph.microsoft.com/v1.0/me/messages?$top=50&$skip=8&$filter=lastModifiedDateTime+ge+2025-10-29T00:00:00Z+and+isDraft+eq+false&$orderby=lastModifiedDateTime+asc"
write("outlook-mail/messages.pages.json", {
    "$shapedFrom": shaped(OL["messages"], "docs/research/one-actions.md section 4"),
    "actionId": OL["messages"],
    "pages": [
        {"match": {"cursor": None}, "response": {"@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users('dana%40acme.eu')/messages", "@odata.nextLink": NEXT, "value": ol_list[:8]}},
        {"match": {"cursor": NEXT}, "response": {"@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users('dana%40acme.eu')/messages", "value": ol_list[8:]}},
    ],
})
COUNTS["outlook-mail.messages"] = 14
write("outlook-mail/account.json", {"$shapedFrom": shaped(OL["me"], "Get the Signed-in User Profile"), "actionId": OL["me"],
                                    "response": {"@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users/$entity",
                                                 "id": "7f3c2a10-5e1b-4d0a-9c77-acme0eu0dana", "displayName": "Dana Oyelaran",
                                                 "userPrincipalName": "dana@acme.eu", "mail": "dana@acme.eu"}})

# ================================================================== Google Calendar
GC = {"list": "conn_mod_def::GJ6Rk8ghCfI::FsO0bmOYSHOsPSIvrcOZxQ", "events": "conn_mod_def::GJ6RlnIYK20::YzuWSmaVQgurletRDNJavA"}
CAL_PRIMARY = "dana@acme.com"
CAL_SALES = "c_acme.sales.team@group.calendar.google.com"
def gc_event(key, cal, summary, start, minutes, attendees, organizer="dana", desc=None, location=None, meet=False,
             status="confirmed", recurring=False, all_day_days=None, responses=None, judge_kw=None):
    eid = hexid("gcal", key, n=26)
    if all_day_days:
        start_o = {"date": rel_date(start)}
        end_o = {"date": rel_date(all_day_days)}
    else:
        start_o = {"dateTime": rel(start), "timeZone": "America/Los_Angeles"}
        end_o = {"dateTime": rel(start, None, minutes), "timeZone": "America/Los_Angeles"}
    responses = responses or {}
    ev = {
        "kind": "calendar#event", "etag": '"%s"' % hexid("etag", eid, n=16), "id": eid, "status": status,
        "htmlLink": "https://www.google.com/calendar/event?eid=" + hexid("eid", eid, n=32),
        "created": rel("-30d 09:00" if days_of(start) > -30 else start), "updated": rel("-6d 12:00" if days_of(start) > -6 else start),
        "summary": summary,
        "creator": {"email": email(organizer), "displayName": name(organizer), "self": organizer == "dana"},
        "organizer": {"email": email(organizer), "displayName": name(organizer), "self": organizer == "dana"},
        "start": start_o, "end": end_o, "iCalUID": eid + "@google.com", "sequence": 0,
        "attendees": [{"email": email(a), "displayName": name(a), "responseStatus": responses.get(a, "accepted"),
                       **({"self": True} if a == "dana" else {}), **({"organizer": True} if a == organizer else {})} for a in attendees],
        "eventType": "default",
    }
    if desc: ev["description"] = desc
    if location: ev["location"] = location
    if meet:
        code = "%s-%s-%s" % (hexid("m1", key, n=3), hexid("m2", key, n=4), hexid("m3", key, n=3))
        ev["hangoutLink"] = "https://meet.google.com/" + code
        ev["conferenceData"] = {"entryPoints": [{"entryPointType": "video", "uri": "https://meet.google.com/" + code, "label": "meet.google.com/" + code}],
                                "conferenceSolution": {"name": "Google Meet", "key": {"type": "hangoutsMeet"}}, "conferenceId": code}
    if recurring:
        ev["recurringEventId"] = hexid("gcal-series", key, n=26)
        ev["originalStartTime"] = start_o
    if status == "cancelled":
        ev = {"kind": "calendar#event", "etag": ev["etag"], "id": eid, "status": "cancelled", "updated": rel("-1d 09:00"),
              "start": start_o, "end": end_o, "summary": summary, "organizer": ev["organizer"], "attendees": ev["attendees"],
              "htmlLink": ev["htmlLink"], "created": ev["created"], "iCalUID": ev["iCalUID"]}
    if status != "cancelled":
        judge("google-calendar:" + eid, start if days_of(start) < 0 else "-1d", [a for a in attendees if a not in SELF],
              **(judge_kw or dict(kind="calendar", imp=1)))
    return cal, ev

GC_EVENTS = [
    gc_event("contract_review", CAL_PRIMARY, "Globex x Acme contract review", "-2d 14:00", 30, ["dana", "priya", "sam"],
             desc="<p>Walk through the final MSA redline and the renewal order form.</p>", meet=True, judge_kw=dict(kind="calendar", imp=3)),
    gc_event("initech_kickoff", CAL_PRIMARY, "Initech pilot kickoff", "-8d 10:00", 60, ["dana", "ravi", "anika", "mia"],
             desc="<p>Scope, success criteria, data access, check-in cadence.</p>", meet=True, judge_kw=dict(kind="calendar", imp=2)),
    gc_event("board_prep", CAL_PRIMARY, "Northwind board prep", "+2d 09:00", 45, ["dana", "owen", "theo"],
             desc="<p>Review the Q3 deck before the board date.</p>", meet=True, judge_kw=dict(kind="calendar", imp=3)),
    gc_event("pipeline_review", CAL_PRIMARY, "Pipeline review", "+1d 11:00", 30, ["dana", "sam"], organizer="sam", recurring=True, meet=True),
    gc_event("one_on_one_theo", CAL_PRIMARY, "Dana / Theo 1:1", "-1d 15:00", 30, ["dana", "theo"], recurring=True),
    gc_event("initech_checkin", CAL_PRIMARY, "Initech pilot weekly check-in", "+3d 10:00", 30, ["dana", "ravi", "mia"], organizer="ravi",
             meet=True, recurring=True, responses={"dana": "needsAction"}, judge_kw=dict(kind="calendar", imp=2, needs=0.72, ball="me", ballc=0.7)),
    gc_event("signature_call", CAL_PRIMARY, "Globex renewal signature call", "+5d 09:00", 30, ["dana", "priya"], organizer="priya",
             meet=True, responses={"dana": "tentative"}, judge_kw=dict(kind="calendar", imp=3)),
    gc_event("lunch_owen", CAL_PRIMARY, "Lunch w/ Owen", "-15d 12:30", 60, ["dana", "owen"], location="Tartine, 600 Guerrero St, San Francisco"),
    gc_event("hooli_intro", CAL_PRIMARY, "Hooli intro call", "+4d 16:00", 30, ["dana", "jules"], organizer="jules", status="cancelled"),
    gc_event("eng_sales_sync", CAL_PRIMARY, "Eng / sales sync", "0d 16:00", 30, ["dana", "mia", "theo"], organizer="mia", meet=True, recurring=True),
    gc_event("offsite", CAL_PRIMARY, "Q4 planning offsite", "+7d", 0, ["dana", "theo", "mia", "sam"], all_day_days="+8d",
             location="Acme HQ, San Francisco"),
    gc_event("dentist", CAL_PRIMARY, "Dentist", "-5d 08:00", 60, ["dana"], judge_kw=dict(kind="other", imp=0)),
    gc_event("standup", CAL_SALES, "Sales team standup", "-1d 09:00", 15, ["dana", "sam"], organizer="sam", recurring=True, meet=True),
    gc_event("forecast", CAL_SALES, "Q4 forecast call", "+2d 13:00", 45, ["dana", "sam", "theo"], organizer="sam", meet=True,
             judge_kw=dict(kind="calendar", imp=2)),
    gc_event("globex_qbr", CAL_SALES, "Globex QBR", "-30d 10:00", 60, ["dana", "priya", "sam"], meet=True),
    gc_event("initech_security", CAL_SALES, "Initech security review", "-60d 11:00", 45, ["dana", "ravi", "anika"]),
]
assert len(GC_EVENTS) == 16
CAL_ITEMS = [
    {"kind": "calendar#calendarListEntry", "etag": '"1761700000000000"', "id": CAL_PRIMARY, "summary": "dana@acme.com",
     "timeZone": "America/Los_Angeles", "colorId": "14", "backgroundColor": "#9fe1e7", "foregroundColor": "#000000",
     "selected": True, "primary": True, "accessRole": "owner",
     "defaultReminders": [{"method": "popup", "minutes": 10}],
     "conferenceProperties": {"allowedConferenceSolutionTypes": ["hangoutsMeet"]}},
    {"kind": "calendar#calendarListEntry", "etag": '"1761700000000001"', "id": CAL_SALES, "summary": "Acme Sales",
     "description": "Team calendar for the sales team", "timeZone": "America/Los_Angeles", "colorId": "9",
     "backgroundColor": "#7bd148", "foregroundColor": "#000000", "selected": True, "accessRole": "writer",
     "defaultReminders": [], "conferenceProperties": {"allowedConferenceSolutionTypes": ["hangoutsMeet"]}},
]
write("google-calendar/calendars.pages.json", {
    "$shapedFrom": shaped(GC["list"], "docs/research/one-actions.md section 5"),
    "actionId": GC["list"],
    "pages": [{"match": {"cursor": None}, "response": {"kind": "calendar#calendarList", "etag": '"p33acmecal0001"',
                                                         "items": CAL_ITEMS, "nextSyncToken": "gcal-callist-sync-1"}}],
})
def gc_resp(cal, items, page_token=None, sync=None):
    r = {"kind": "calendar#events", "etag": '"p32acme%s"' % hexid(cal, n=8), "summary": "dana@acme.com" if cal == CAL_PRIMARY else "Acme Sales",
         "updated": rel("-1d 09:00"), "timeZone": "America/Los_Angeles", "accessRole": "owner" if cal == CAL_PRIMARY else "writer",
         "defaultReminders": [{"method": "popup", "minutes": 10}] if cal == CAL_PRIMARY else [], "items": items}
    if page_token: r["nextPageToken"] = page_token
    if sync: r["nextSyncToken"] = sync
    return r
prim = [e for c, e in GC_EVENTS if c == CAL_PRIMARY]
sales = [e for c, e in GC_EVENTS if c == CAL_SALES]
write("google-calendar/events.pages.json", {
    "$shapedFrom": shaped(GC["events"], "docs/research/one-actions.md section 5"),
    "actionId": GC["events"],
    "pages": [
        {"match": {"partition": CAL_PRIMARY, "cursor": None, "delta": None}, "response": gc_resp(CAL_PRIMARY, prim[:8], page_token="gcal-primary-page-2")},
        {"match": {"partition": CAL_PRIMARY, "cursor": "gcal-primary-page-2", "delta": None}, "response": gc_resp(CAL_PRIMARY, prim[8:], sync="gcal-primary-sync-1")},
        {"match": {"partition": CAL_SALES, "cursor": None, "delta": None}, "response": gc_resp(CAL_SALES, sales, sync="gcal-sales-sync-1")},
        {"match": {"partition": CAL_PRIMARY, "cursor": None, "delta": "gcal-primary-sync-1"}, "response": gc_resp(CAL_PRIMARY, [], sync="gcal-primary-sync-2")},
        {"match": {"partition": CAL_SALES, "cursor": None, "delta": "gcal-sales-sync-1"}, "response": gc_resp(CAL_SALES, [], sync="gcal-sales-sync-2")},
        {"match": {"partition": CAL_PRIMARY, "cursor": None, "delta": "gcal-expired-sync"}, "status": 410,
         "response": {"error": {"code": 410, "message": "Sync token is no longer valid, a full sync is required.",
                                "errors": [{"domain": "global", "reason": "fullSyncRequired", "message": "Sync token is no longer valid, a full sync is required."}]}}},
    ],
})
COUNTS["google-calendar.events"] = 16

# ================================================================== Outlook Calendar
OC = {"calendars": "conn_mod_def::GMIY1FxtnJw::naghBU_mSTKsg0Lv46gF1w", "delta": "conn_mod_def::GMIY39C_Zus::f0YqbOZ_Tzi_jt6FfhYKHA"}
OCAL_ID = "AAMkADAcmeEuCalendarDefault0000AAA="
def oc_event(key, subject, start, minutes, attendees, organizer="dana_eu", body="", teams=False, response="organizer", judge_kw=None):
    eid = "AAMkADAcmeEuEvent" + hexid("ocal", key, n=20) + "="
    is_org = organizer == "dana_eu"
    ev = {
        "@odata.etag": 'W/"DwAAABYAAAB%s"' % hexid("e", eid, n=8),
        "id": eid, "categories": [], "changeKey": "DwAAABYAAAB" + hexid("ck", eid, n=8),
        "createdDateTime": rel("-20d 09:00"), "lastModifiedDateTime": rel("-3d 09:00" if days_of(start) > -3 else start),
        "allowNewTimeProposals": True,
        "attendees": [{"emailAddress": {"name": name(a), "address": email(a)}, "type": "required",
                       "status": {"response": "accepted" if a != organizer else "none", "time": rel("-10d 09:00")}} for a in attendees if a != organizer],
        "body": {"contentType": "html", "content": "<html><body><p>%s</p></body></html>" % body},
        "bodyPreview": body[:255], "end": {"dateTime": rel_graph(start, minutes), "timeZone": "UTC"},
        "hasAttachments": False, "hideAttendees": False, "iCalUId": "040000008200E00074C5B7101A82E008" + hexid("ical", key, n=24).upper(),
        "importance": "normal", "isAllDay": False, "isCancelled": False, "isDraft": False, "isOnlineMeeting": teams,
        "isOrganizer": is_org, "isReminderOn": True,
        "location": {"displayName": "Microsoft Teams Meeting" if teams else "Amsterdam office", "locationType": "default", "uniqueIdType": "unknown"},
        "organizer": {"emailAddress": {"name": name(organizer), "address": email(organizer)}},
        "originalStartTimeZone": "W. Europe Standard Time", "originalEndTimeZone": "W. Europe Standard Time",
        "responseRequested": True, "responseStatus": {"response": response, "time": "0001-01-01T00:00:00Z"},
        "sensitivity": "normal", "showAs": "busy", "start": {"dateTime": rel_graph(start), "timeZone": "UTC"},
        "subject": subject, "type": "singleInstance",
        "webLink": "https://outlook.office365.com/owa/?itemid=%s&exvsurl=1&path=/calendar/item" % eid.replace("=", "%3D"),
    }
    if teams:
        ev["onlineMeetingProvider"] = "teamsForBusiness"
        ev["onlineMeeting"] = {"joinUrl": "https://teams.microsoft.com/l/meetup-join/19%3ameeting_" + hexid("tm", key, n=24) + "%40thread.v2/0"}
    judge("outlook-calendar:" + eid, start if days_of(start) < 0 else "-1d", [a for a in attendees + [organizer] if a not in SELF],
          **(judge_kw or dict(kind="calendar", imp=1)))
    return ev

OC_EVENTS = [
    oc_event("umbrella_call", "Umbrella procurement call", "-3d 08:00", 45, ["dana_eu", "hannah", "lena"], organizer="hannah",
             body="Walk through the supplier questionnaire and timeline.", teams=True, response="accepted", judge_kw=dict(kind="calendar", imp=3)),
    oc_event("gonogo", "Ledger 2.0 go/no-go", "+1d 07:00", 60, ["dana_eu", "lena", "mia"], organizer="lena",
             body="Decide on the Ledger 2.0 launch. Open items: LED-158, LED-161.", teams=True, response="accepted", judge_kw=dict(kind="calendar", imp=3)),
    oc_event("allhands", "Acme Europe all-hands", "+6d 08:00", 90, ["dana_eu", "lena"], organizer="lena", body="Quarterly all-hands, Amsterdam.", response="tentativelyAccepted"),
    oc_event("umbrella_pricing", "Umbrella pricing review", "-1d 06:30", 30, ["dana_eu", "lena", "felix"], body="Per-entity pricing for Umbrella's three EU entities.",
             teams=True, judge_kw=dict(kind="calendar", imp=2)),
    oc_event("dpa_review", "Globex DPA review", "-4d 07:00", 30, ["dana_eu", "marco"], organizer="marco", body="Review the Globex DPA.", teams=True, response="accepted"),
    oc_event("eu_pipeline", "EU pipeline sync", "+2d 07:30", 30, ["dana_eu", "lena"], body="Weekly EU pipeline sync.", teams=True),
]
REMOVED_ID = OC_EVENTS[-1]["id"]
GRAPH = "https://graph.microsoft.com/v1.0/me/calendars/%s/events/microsoft.graph.delta()" % OCAL_ID
write("outlook-calendar/calendars.pages.json", {
    "$shapedFrom": shaped(OC["calendars"], "docs/research/one-actions.md section 6"),
    "actionId": OC["calendars"],
    "pages": [{"match": {"cursor": None}, "response": {"value": [{
        "id": OCAL_ID, "allowedOnlineMeetingProviders": ["teamsForBusiness"], "canEdit": True, "canShare": True,
        "canViewPrivateItems": True, "changeKey": "NEXywgsVrkeNsFsyVyRrtAAAAcme==", "color": "auto",
        "defaultOnlineMeetingProvider": "teamsForBusiness", "hexColor": "#4f6bed", "isDefaultCalendar": True,
        "isRemovable": False, "isTallyingResponses": True, "name": "Calendar",
        "owner": {"name": "Dana Oyelaran", "address": "dana@acme.eu"}}]}}],
})
write("outlook-calendar/events.pages.json", {
    "$shapedFrom": shaped(OC["delta"], "docs/research/one-actions.md section 6; @removed entries per Graph delta semantics (I)"),
    "actionId": OC["delta"],
    "pages": [
        {"match": {"partition": OCAL_ID, "cursor": None, "delta": None}, "response": {
            "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#Collection(event)",
            "@odata.nextLink": GRAPH + "?$skiptoken=ocal-skip-2", "value": OC_EVENTS[:4]}},
        {"match": {"partition": OCAL_ID, "cursor": GRAPH + "?$skiptoken=ocal-skip-2", "delta": None}, "response": {
            "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#Collection(event)",
            "@odata.deltaLink": GRAPH + "?$deltatoken=ocal-delta-1", "value": OC_EVENTS[4:]}},
        {"match": {"partition": OCAL_ID, "cursor": None, "delta": GRAPH + "?$deltatoken=ocal-delta-1"}, "response": {
            "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#Collection(event)",
            "@odata.deltaLink": GRAPH + "?$deltatoken=ocal-delta-2",
            "value": [{"@odata.type": "#microsoft.graph.event", "id": REMOVED_ID, "@removed": {"reason": "deleted"}}]}},
        {"match": {"partition": OCAL_ID, "cursor": None, "delta": GRAPH + "?$deltatoken=ocal-delta-2"}, "response": {
            "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#Collection(event)",
            "@odata.deltaLink": GRAPH + "?$deltatoken=ocal-delta-2", "value": []}},
    ],
})
COUNTS["outlook-calendar.events"] = 6

# ================================================================== Notion
NO = {"search": "conn_mod_def::GJ5En67fz04::-CJAS419SVWm7L2l6brp6A", "md": "conn_mod_def::GJ5EntqNvy0::-VzfhSExTEGGnlXLUMqFcA"}
NOTION_USERS = {"dana": uid("notion", "user", "dana"), "theo": uid("notion", "user", "theo"), "mia": uid("notion", "user", "mia")}
ACCOUNTS_DS = uid("notion", "ds", "accounts")
def rt(text):
    return [{"type": "text", "text": {"content": text, "link": None},
             "annotations": {"bold": False, "italic": False, "strikethrough": False, "underline": False, "code": False, "color": "default"},
             "plain_text": text, "href": None}]
def n_people(k):
    return {"object": "user", "id": NOTION_USERS.get(k, uid("notion", "user", k)), "name": name(k), "avatar_url": None,
            "type": "person", "person": {"email": email(k)}}
notion_pages, notion_md = [], {}
def n_page(key, title, created, edited, editor, md, account=None, parent_page=None):
    pid = uid("notion", "page", key)
    props = {}
    if account:
        props["Name"] = {"id": "title", "type": "title", "title": rt(title)}
        props["Champion"] = {"id": "c%3Ah%3D", "type": "email", "email": email(account["champion"])}
        props["Owner"] = {"id": "o%5Bw", "type": "people", "people": [n_people("dana")]}
        props["Stage"] = {"id": "s%7Bt", "type": "status", "status": {"id": "st_" + account["stage"].lower().replace(" ", "_"), "name": account["stage"], "color": "green"}}
        props["ARR"] = {"id": "a%40r", "type": "number", "number": account["arr"]}
        parent = {"type": "data_source_id", "data_source_id": ACCOUNTS_DS, "database_id": uid("notion", "db", "accounts")}
    else:
        props["title"] = {"id": "title", "type": "title", "title": rt(title)}
        parent = {"type": "page_id", "page_id": uid("notion", "page", parent_page)} if parent_page else {"type": "workspace", "workspace": True}
    page = {"object": "page", "id": pid, "created_time": rel(created), "last_edited_time": rel(edited), "in_trash": False,
            "is_locked": False, "url": "https://www.notion.so/acme/%s-%s" % (re.sub(r"[^A-Za-z0-9]+", "-", title).strip("-"), pid.replace("-", "")),
            "public_url": None, "parent": parent, "properties": props, "icon": None, "cover": None,
            "created_by": {"object": "user", "id": NOTION_USERS["dana"]}, "last_edited_by": {"object": "user", "id": NOTION_USERS[editor]}}
    notion_pages.append((days_of(edited), page))
    notion_md[pid] = {"object": "page_markdown", "id": pid, "markdown": md, "truncated": False, "unknown_block_ids": []}
    ppl = [account["champion"]] if account else []
    judge("notion:" + pid, edited, ppl, kind="internal_doc", imp=2)
    return pid

n_page("globex_plan", "Globex account plan", "-90d 10:00", "-2d 18:00", "dana",
       "# Globex account plan\n\n## Status\nRenewal for 2027 at 84,000 a year, contract sent. Champion: Priya Shah (VP Partnerships). Legal: Marco Bellini.\n\n## Risks\n- Multi-year discount ask could slip signature past November 14.\n- SSO rollout (ACME-311) must land the week after signature.\n\n## Next steps\n1. Send the two year quote.\n2. Countersign the MSA once the redline is final.\n",
       account={"champion": "priya", "stage": "Contract sent", "arr": 84000})
n_page("initech_plan", "Initech account plan", "-40d 11:00", "-3d 12:00", "dana",
       "# Initech account plan\n\n## Pilot\nPaid pilot, 36,000. Technical owner Ravi Menon (CTO), data owner Anika Rao.\n\n## Success criteria\nNightly CSV import under 10 minutes on their 80 MB export. Blocked on ACME-298.\n",
       account={"champion": "ravi", "stage": "Pilot", "arr": 36000})
n_page("umbrella_brief", "Umbrella EU expansion brief", "-70d 09:00", "-4d 16:00", "dana",
       "# Umbrella EU expansion\n\nThree EU entities, about 400 seats, EUR 120,000. Procurement lead Hannah Cole, CFO Felix Wagner. Lena Vogt runs the EU side.\n\n## Open\n- Supplier questionnaire due Friday.\n- Tax IDs on invoices (LED-161) before launch.\n",
       account={"champion": "hannah", "stage": "Negotiation", "arr": 120000})
n_page("pilot_playbook", "Pilot playbook", "-120d 10:00", "-10d 10:00", "theo",
       "# Pilot playbook\n\n## Before kickoff\n- Agree success criteria in writing.\n- Get a sample export in week one.\n\n## During\nWeekly check-in with the customer's technical owner. Escalate import failures within a day.\n")
n_page("q3_investor_update", "Q3 investor update", "-12d 09:00", "-1d 20:00", "theo",
       "# Q3 investor update\n\n## Highlights\n- ARR up 31% quarter over quarter.\n- Globex renewal in contract, Umbrella EU expansion in negotiation.\n\n## Asks\nIntros to CFOs in logistics and pharma. Owen Price offered two.\n")
n_page("ledger_launch", "Ledger 2.0 launch plan", "-50d 10:00", "-2d 11:00", "mia",
       "# Ledger 2.0 launch plan\n\n## Scope\nUsage-based billing (LED-142), invoice PDF redesign (LED-158), tax IDs on invoices (LED-161).\n\n## Go/no-go\nLena runs the EU go/no-go. Launch only when EU invoices carry tax IDs.\n")
n_page("sales_playbook", "Sales playbook 2026", "-200d 10:00", "-25d 10:00", "dana",
       "# Sales playbook 2026\n\n## Stages\nDiscovery, pilot, contract sent, closed. Every deal over 50,000 gets an account plan in the Accounts database.\n")
n_page("discount_policy", "Pricing and discount policy", "-180d 10:00", "-15d 10:00", "dana",
       "# Pricing and discount policy\n\n## Multi-year\nTwo year terms can take up to 8% off. Three year terms need Theo's approval.\n\n## EU\nPrices in EUR for EU entities, invoiced by Acme Europe B.V.\n", parent_page="sales_playbook")
notion_pages.sort(key=lambda x: x[0], reverse=True)   # sort last_edited_time descending
npl = [p for _, p in notion_pages]
assert len(npl) == 8
write("notion/pages.pages.json", {
    "$shapedFrom": shaped(NO["search"], "docs/research/one-actions.md section 7"),
    "actionId": NO["search"],
    "pages": [
        {"match": {"cursor": None}, "response": {"object": "list", "type": "page_or_data_source", "page_or_data_source": {},
                                                                  "next_cursor": npl[5]["id"], "has_more": True, "results": npl[:5]}},
        {"match": {"cursor": npl[5]["id"]}, "response": {"object": "list", "type": "page_or_data_source", "page_or_data_source": {},
                                                                          "next_cursor": None, "has_more": False, "results": npl[5:]}},
    ],
})
write("notion/pages.details.json", {"$shapedFrom": shaped(NO["md"], "Retrieve a Page as Markdown"), "actionId": NO["md"],
                                    "idFrom": "path:pageId", "byId": notion_md})
COUNTS["notion.pages"] = 8

# ================================================================== Linear
LI = {"issues": "conn_mod_def::GJ4vJTdCQPY::f4IhKVnuTv6Us2d-GwWvCw", "projects": "conn_mod_def::GJ4vMBSrKJo::YJPEPOfJQ76eTtZUfpjyUg",
      "documents": "conn_mod_def::GJ4vFe4bH3Q::NcSFstL6Q9WSd4TqlvvyHg", "comments": "conn_mod_def::GJ4vCs496v0::aGBcU2zYSISOg7tZZzSSfQ"}
def lu(k): return {"name": name(k), "email": email(k)} if k else None
TEAMS_L = {"ACME": {"key": "ACME", "name": "Platform"}, "LED": {"key": "LED", "name": "Ledger"}}
STATES = {"backlog": ("Backlog", "backlog"), "todo": ("Todo", "unstarted"), "progress": ("In Progress", "started"),
          "review": ("In Review", "started"), "done": ("Done", "completed"), "canceled": ("Canceled", "canceled")}
issues = []
def issue(ident, title, desc, state, assignee, creator, created, updated, project=None, labels=(), priority=2, customer=None, ext_creator=None, due=None):
    team = ident.split("-")[0]
    iid = uid("linear", "issue", ident)
    sname, stype = STATES[state]
    node = {"id": iid, "identifier": ident, "title": title, "description": desc, "url": "https://linear.app/acme/issue/%s/%s" % (ident.lower(), re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")),
            "priority": priority, "createdAt": rel(created), "updatedAt": rel(updated), "archivedAt": None,
            "completedAt": rel(updated) if state == "done" else None, "canceledAt": rel(updated) if state == "canceled" else None,
            "dueDate": rel_date(due) if due else None,
            "state": {"name": sname, "type": stype}, "assignee": lu(assignee), "creator": lu(creator),
            "externalUserCreator": lu(ext_creator), "team": TEAMS_L[team], "project": {"name": project} if project else None,
            "labels": {"nodes": [{"name": l} for l in labels]},
            "needs": {"nodes": [{"customer": {"name": c[0], "domains": [c[1]]}} for c in ([customer] if customer else [])]}}
    issues.append(node)
    ppl = [p for p in (assignee, creator, ext_creator) if p and p not in SELF]
    judge("linear:" + iid, created, ppl, kind="task", imp={0: 1, 1: 3, 2: 2, 3: 1, 4: 1}[priority],
          ball="me" if assignee == "dana" else "nobody", ballc=0.5)
    return iid
issue("ACME-311", "SSO for Globex rollout", "Globex needs SAML SSO live the week after the renewal is signed. Requested by Priya in the shared channel.",
      "progress", "mia", "dana", "-12d 10:00", "-1d 15:00", project="Enterprise readiness", labels=("customer", "sso"), priority=1,
      customer=("Globex", "globex.com"), ext_creator="priya", due="+20d")
issue("ACME-298", "CSV import fails over 50 MB", "Initech's nightly export (80 MB) times out in the import worker. Repro with the sample Anika shared.",
      "review", "mia", "theo", "-5d 09:00", "-3h", project="Enterprise readiness", labels=("bug", "customer"), priority=1, customer=("Initech", "initech.io"))
issue("ACME-305", "Audit log export", "Admins can export the audit log as CSV.", "todo", "mia", "theo", "-20d 10:00", "-6d 10:00", project="Enterprise readiness", labels=("feature",))
issue("ACME-312", "Refresh SAML metadata automatically", "Pull IdP metadata nightly so certificate rotations do not break SSO.", "backlog", None, "mia", "-10d 10:00", "-10d 10:00", project="Enterprise readiness", labels=("sso",), priority=3)
issue("ACME-290", "Rate limit on bulk API", "Bulk endpoints need a per-tenant limit.", "done", "mia", "theo", "-40d 10:00", "-14d 10:00", labels=("api",), priority=2)
issue("ACME-315", "Pilot data sandbox for Initech", "Separate sandbox so Initech can test imports without touching production.", "progress", "mia", "dana", "-4d 11:00", "-1d 11:00", project="Enterprise readiness", labels=("customer",), customer=("Initech", "initech.io"))
issue("ACME-280", "Flaky e2e on checkout", "Checkout e2e fails one run in ten.", "done", "theo", "mia", "-30d 10:00", "-25d 10:00", labels=("bug",), priority=3)
issue("ACME-301", "Slack alerts for failed imports", "Post to #eng when an import fails twice.", "todo", "mia", "mia", "-7d 10:00", "-7d 10:00", labels=("feature",), priority=3)
issue("LED-142", "Ship usage-based billing", "Meter events, aggregate per billing period, invoice on the usage line.", "progress", "theo", "theo", "-35d 10:00", "-2d 10:00", project="Ledger 2.0", labels=("billing",), priority=1)
issue("LED-158", "Invoice PDF redesign", "New invoice layout with usage breakdown.", "review", "mia", "theo", "-20d 10:00", "-1d 17:00", project="Ledger 2.0", labels=("billing", "design"), priority=2)
issue("LED-160", "Proration edge cases", "Mid-cycle seat changes prorate wrong when the plan also changes.", "todo", "theo", "theo", "-9d 10:00", "-5d 10:00", project="Ledger 2.0", labels=("billing", "bug"), priority=2)
issue("LED-161", "Tax IDs on invoices", "EU customers need their VAT ID on every invoice. Blocks the Umbrella EU rollout.", "todo", "theo", "dana", "-8d 10:00", "-1d 12:00", project="Ledger 2.0", labels=("billing", "eu"), priority=1, customer=("Umbrella", "umbrella.co"))
issue("LED-150", "Dunning emails", "Automated reminders for failed payments.", "canceled", None, "theo", "-60d 10:00", "-45d 10:00", project="Ledger 2.0", labels=("billing",), priority=4)
issue("LED-163", "Usage dashboard for admins", "Show metered usage to customer admins.", "backlog", None, "theo", "-6d 10:00", "-6d 10:00", project="Ledger 2.0", labels=("billing",), priority=3)
assert len(issues) == 14
issues.sort(key=lambda n: days_of(n["updatedAt"]["$rel"]))   # orderBy updatedAt (ascending)
def lin_resp(field, nodes, end, has_next):
    return {"data": {field: {"nodes": nodes, "pageInfo": {"endCursor": end, "hasNextPage": has_next}}}}
write("linear/issues.pages.json", {
    "$shapedFrom": shaped(LI["issues"], "docs/research/one-actions.md section 8; node fields are the profile's GraphQL selection (I)"),
    "actionId": LI["issues"],
    "pages": [
        {"match": {"cursor": None}, "response": lin_resp("issues", issues[:8], "lin-issues-cursor-8", True)},
        {"match": {"cursor": "lin-issues-cursor-8"}, "response": lin_resp("issues", issues[8:], "lin-issues-cursor-14", False)},
    ],
})
COUNTS["linear.issues"] = 14

projects = []
for key, nm, desc, content, state, lead, members, created, updated in [
    ("ledger2", "Ledger 2.0", "Usage-based billing and the new invoice.", "## Goal\nBill on usage by end of quarter.\n\n## Milestones\n- Metering live\n- New invoice PDF\n- EU tax IDs", "started", "theo", ["mia", "lena"], "-50d 10:00", "-1d 17:00"),
    ("enterprise", "Enterprise readiness", "SSO, audit log and import reliability for enterprise customers.", "## Why\nGlobex, Initech and Umbrella all need it.\n\n## Scope\nSAML SSO, audit log export, imports over 50 MB.", "started", "mia", ["theo", "dana"], "-45d 10:00", "-1d 15:00"),
]:
    pid = uid("linear", "project", key)
    projects.append({"id": pid, "name": nm, "description": desc, "content": content, "url": "https://linear.app/acme/project/%s-%s" % (key, pid[:12]),
                     "state": state, "targetDate": None, "startDate": None, "createdAt": rel(created), "updatedAt": rel(updated), "archivedAt": None,
                     "lead": lu(lead), "members": {"nodes": [lu(m) for m in members]}})
    judge("linear:" + pid, created, [lead] + members, kind="internal_doc", imp=2)
write("linear/projects.pages.json", {
    "$shapedFrom": shaped(LI["projects"], "docs/research/one-actions.md section 8"),
    "actionId": LI["projects"],
    "pages": [{"match": {"cursor": None}, "response": lin_resp("projects", projects, "lin-projects-cursor-2", False)}],
})
COUNTS["linear.projects"] = 2

docs = []
for key, title, content, creator, updater, project, created, updated in [
    ("prd", "Ledger 2.0 PRD", "# Ledger 2.0 PRD\n\n## Problem\nCustomers on usage plans get invoices that do not show usage.\n\n## Requirements\n1. Meter every billable event.\n2. Show usage per line on the invoice.\n3. Carry the customer's tax ID for EU entities.", "theo", "theo", "Ledger 2.0", "-48d 10:00", "-6d 10:00"),
    ("import_runbook", "Initech pilot import runbook", "# Initech import runbook\n\n## Nightly import\nRuns at 02:00 UTC. Files over 50 MB time out today (ACME-298).\n\n## When it fails\nCheck the worker log, rerun with the chunked importer, tell Ravi in the pilot channel.", "mia", "mia", "Enterprise readiness", "-6d 10:00", "-2d 10:00"),
    ("sso_plan", "SSO rollout plan", "# SSO rollout plan\n\n## Globex first\nGlobex signs, then SSO goes live within a week (ACME-311).\n\n## Then\nInitech after the pilot, Umbrella with the EU launch.", "mia", "dana", "Enterprise readiness", "-11d 10:00", "-1d 16:00"),
]:
    did = uid("linear", "document", key)
    docs.append({"id": did, "title": title, "content": content, "url": "https://linear.app/acme/document/%s-%s" % (key, did[:12]), "slugId": did[:12],
                 "createdAt": rel(created), "updatedAt": rel(updated), "archivedAt": None, "creator": lu(creator), "updatedBy": lu(updater),
                 "project": {"name": project}})
    judge("linear:" + did, created, [p for p in (creator, updater) if p not in SELF], kind="internal_doc", imp=2)
write("linear/documents.pages.json", {
    "$shapedFrom": shaped(LI["documents"], "docs/research/one-actions.md section 8"),
    "actionId": LI["documents"],
    "pages": [{"match": {"cursor": None}, "response": lin_resp("documents", docs, "lin-docs-cursor-3", False)}],
})
COUNTS["linear.documents"] = 3

comments = []
for key, ident, ititle, user, body, when in [
    ("c1", "ACME-298", "CSV import fails over 50 MB", "mia", "Reproduced with Anika's 80 MB sample. The worker hits the 60 s timeout on parse.", "-2d 11:00"),
    ("c2", "ACME-298", "CSV import fails over 50 MB", "theo", "Chunked importer in review. Should land before Friday's check-in.", "-3h"),
    ("c3", "ACME-311", "SSO for Globex rollout", "mia", "SAML config tested against Globex's IdP metadata.", "-1d 15:00"),
    ("c4", "ACME-311", "SSO for Globex rollout", "dana", "Globex wants this live the week after signature. Priority stays high.", "-3d 10:00"),
    ("c5", "LED-142", "Ship usage-based billing", "theo", "Metering is live in staging.", "-2d 10:00"),
    ("c6", "ACME-315", "Pilot data sandbox for Initech", "mia", "Sandbox provisioned, sharing credentials with Anika through the pilot channel.", "-1d 11:00"),
]:
    cid = uid("linear", "comment", key)
    comments.append({"id": cid, "body": body, "url": "https://linear.app/acme/issue/%s#comment-%s" % (ident.lower(), cid[:8]),
                     "createdAt": rel(when), "updatedAt": rel(when), "archivedAt": None, "user": lu(user), "issue": {"identifier": ident, "title": ititle}})
    judge("linear:" + cid, when, [user] if user not in SELF else [], kind="task", imp=1)
write("linear/comments.pages.json", {
    "$shapedFrom": shaped(LI["comments"], "docs/research/one-actions.md section 8"),
    "actionId": LI["comments"],
    "pages": [{"match": {"cursor": None}, "response": lin_resp("comments", comments, "lin-comments-cursor-6", False)}],
})
COUNTS["linear.comments"] = 6

# ================================================================== Slack
SL = {"users": "conn_mod_def::GJ7IBQjys4M::0ZFuc5nOQAuLPd7qBVmGZA", "convs": "conn_mod_def::GJ7IBJH4uK8::Q4MUFQEYRxucJ3uvw2Ibdw",
      "history": "conn_mod_def::GJ7H9XYEBzI::FkfMtDsaTzKxb92jFEqxHg", "replies": "conn_mod_def::GJ7H99BNZZY::YUA8ceLYSMmIEPSjoukdNg",
      "auth": "conn_mod_def::GJ7H8UJsJpw::WIAkGZl2QGG-xp0x9a-c9w"}
TEAM = "T01ACME"
SU = {"dana": "U01DANA", "mia": "U02MIA", "theo": "U03THEO", "sam": "U04SAM", "priya": "U05PRIYA", "lena": "U06LENA"}
members = []
for k, uidv in SU.items():
    first, last = name(k).split(" ", 1)
    ext = k == "priya"
    titles = {"dana": "Head of Sales", "mia": "Engineering Lead", "theo": "Product Manager", "sam": "Sales Ops", "priya": "VP Partnerships, Globex", "lena": "EU Account Manager"}
    members.append({"id": uidv, "team_id": "T02GLOBEX" if ext else TEAM, "name": first.lower(), "deleted": False, "color": "9f69e7",
                    "real_name": name(k), "tz": "Europe/Amsterdam" if k == "lena" else ("America/Chicago" if ext else "America/Los_Angeles"),
                    "tz_label": "Central European Summer Time" if k == "lena" else ("Central Daylight Time" if ext else "Pacific Daylight Time"),
                    "tz_offset": 7200 if k == "lena" else (-18000 if ext else -25200),
                    "profile": {"avatar_hash": hexid("av", k, n=12), "real_name": name(k), "display_name": first.lower(),
                                "real_name_normalized": name(k), "display_name_normalized": first.lower(), "first_name": first, "last_name": last,
                                "title": titles[k], "phone": "", "email": email(k), "team": "T02GLOBEX" if ext else TEAM,
                                "image_48": "https://avatars.slack-edge.example/%s_48.png" % uidv},
                    "is_admin": k == "dana", "is_owner": False, "is_primary_owner": False, "is_restricted": ext, "is_ultra_restricted": False,
                    "is_bot": False, "updated": rel_unix("-30d 10:00"), "is_app_user": False, "has_2fa": True})
write("slack/users.pages.json", {
    "$shapedFrom": shaped(SL["users"], "docs/research/one-actions.md section 9"),
    "actionId": SL["users"],
    "pages": [{"match": {"cursor": None}, "response": {"ok": True, "members": members, "cache_ts": rel_unix("-1h"), "response_metadata": {"next_cursor": ""}}}],
})
COUNTS["slack.users"] = 6

CH = {
    "deals": {"id": "C01DEALS", "name": "deals", "private": True, "purpose": "Deal updates and asks for the sales team"},
    "eng": {"id": "C02ENG", "name": "eng", "private": False, "purpose": "Engineering, including customer escalations"},
    "globex": {"id": "C03GLOBEX", "name": "acme-globex", "private": False, "purpose": "Shared channel with Globex", "ext": True},
}
DM_THEO = "D01THEO"
convs = []
for key, c in CH.items():
    convs.append({"id": c["id"], "name": c["name"], "is_channel": not c["private"], "is_group": c["private"], "is_im": False,
                  "created": rel_unix("-300d 10:00"), "creator": "U01DANA", "is_archived": False, "is_general": False, "unlinked": 0,
                  "name_normalized": c["name"], "is_shared": bool(c.get("ext")), "is_ext_shared": bool(c.get("ext")), "is_org_shared": False,
                  "pending_shared": [], "is_pending_ext_shared": False, "is_private": c["private"], "is_mpim": False,
                  "updated": rel_ms({"deals": "-6h", "eng": "-3h", "globex": "-1d 10:00"}[key]),
                  "topic": {"value": "", "creator": "", "last_set": 0}, "purpose": {"value": c["purpose"], "creator": "U01DANA", "last_set": rel_unix("-300d 10:00")},
                  "previous_names": []})
convs.append({"id": DM_THEO, "created": rel_unix("-280d 10:00"), "is_im": True, "is_org_shared": False, "user": "U03THEO",
              "is_user_deleted": False, "priority": 0, "updated": rel_ms("-1d 14:00")})
write("slack/conversations.pages.json", {
    "$shapedFrom": shaped(SL["convs"], "docs/research/one-actions.md section 9; `updated` (ms) per Slack's conversation object (I)"),
    "actionId": SL["convs"],
    "pages": [{"match": {"cursor": None}, "response": {"ok": True, "channels": convs, "response_metadata": {"next_cursor": ""}}}],
})

slack_msgs = {c["id"]: [] for c in CH.values()}
slack_msgs[DM_THEO] = []
slack_replies = []
SLACK_SPECS = []
def smsg(ch, who, when, text, kind="team_chat", needs=0.1, ball="nobody", ballc=0.7, imp=1, bot=None, replies=None, people=None, lane=None):
    SLACK_SPECS.append(when)
    SLACK_SPECS.extend(r[1] for r in (replies or []))
    m = {"type": "message", "text": text, "ts": rel_slack(when)}
    if bot:
        m.update({"subtype": "bot_message", "bot_id": "B01HUBSPOT", "username": bot})
    else:
        m["user"] = SU[who]
        m["client_msg_id"] = uid("slack", ch, when)
        m["team"] = "T02GLOBEX" if who == "priya" else TEAM
        m["blocks"] = [{"type": "rich_text", "block_id": hexid("blk", ch, when, n=5),
                        "elements": [{"type": "rich_text_section", "elements": [{"type": "text", "text": text}]}]}]
    if replies:
        m["thread_ts"] = rel_slack(when)
        m["reply_count"] = len(replies)
        m["reply_users_count"] = len({r[0] for r in replies})
        m["latest_reply"] = rel_slack(replies[-1][1])
        m["reply_users"] = sorted({SU[r[0]] for r in replies})
        thread = [dict(m)]
        for rw, rwhen, rtext in replies:
            thread.append({"type": "message", "user": SU[rw], "text": rtext, "thread_ts": rel_slack(when), "parent_user_id": SU[who] if who else None, "ts": rel_slack(rwhen)})
        slack_replies.append({"match": {"request": {"query": {"channel": ch, "ts": rel_slack(when)}}},
                              "response": {"ok": True, "messages": thread, "has_more": False, "response_metadata": {"next_cursor": ""}}})
    slack_msgs[ch].append((when, m))
    ppl = set(people or [])
    if who and who not in SELF: ppl.add(who)
    if replies: ppl.update(r[0] for r in replies if r[0] not in SELF)
    judge("slack:" + tok_slack(when), when, list(ppl), kind="notification" if bot else kind, needs=needs, ball=ball, ballc=ballc,
          imp=0 if bot else imp, lane=lane, wrote_last=(who == "dana"))

D = CH["deals"]["id"]
smsg(D, "dana", "-6h", "Globex is basically closed, waiting on signature. Priya's our champion.", imp=3, people=["priya"],
     replies=[("sam", "-5h", "Nice. Do we book it this quarter if they sign Friday?"), ("dana", "-290m", "Yes, if the MSA is countersigned by Friday.")])
smsg(D, None, "-370m", "Deal stage changed: Globex renewal 2027 moved to Contract sent.", bot="HubSpot")
smsg(D, "sam", "-1d 16:05", "Pipeline sheet is updated for Thursday. Globex and Umbrella are 60% of the quarter.", imp=2)
smsg(D, "dana", "-1d 16:30", "Adding Initrode starter at 18k. Grace is waiting on their ops review.", imp=1)
smsg(D, "sam", "-2d 09:10", "Umbrella questionnaire is with Lena for the data residency part.", imp=2, people=["hannah"])
smsg(D, None, "-2d 09:15", "Deal stage changed: Umbrella EU expansion moved to Decision maker bought in.", bot="HubSpot")
smsg(D, "dana", "-2d 11:00", "Hooli pinged me cold. Parking it, too early for us.", imp=0, people=["jules"])
smsg(D, "sam", "-3d 10:00", "Reminder: forecast call moved to Thursday 1pm.", imp=1)
smsg(D, "dana", "-3d 15:30", "Priya asked for a two year quote on Globex. Sam, can you run the numbers at 8% off?", imp=2, people=["priya"])
smsg(D, "sam", "-3d 16:10", "On it. Two year at 8% off comes to 154,560 total.", imp=2)
smsg(D, "theo", "-4d 11:00", "Board deck needs the Globex and Umbrella status by Wednesday.", imp=2)
smsg(D, "dana", "-4d 11:20", "Will update both after the Umbrella call.", imp=1)
smsg(D, "sam", "-5d 09:00", "Initech pilot moved to weekly check-ins, Thursdays at 10.", imp=1, people=["ravi"])
smsg(D, "dana", "-6d 14:00", "Kickoff notes from Initech are in Granola if anyone needs them.", imp=1)
smsg(D, "sam", "-7d 10:00", "Attio migration starts with contacts this week.", imp=1)
smsg(D, "dana", "-8d 09:00", "Welcome Lena to the channel. She covers EU accounts.", imp=0)
smsg(D, "lena", "-8d 09:05", "Thanks Dana. Happy to take Umbrella from the EU side.", imp=1)
smsg(D, "sam", "-9d 12:00", "Q4 targets are in the sales playbook.", imp=1)
E = CH["eng"]["id"]
smsg(E, "mia", "-3h", "@Dana can you confirm the Initech import size? Ravi says 80 MB, the log says 120.", needs=0.55, ball="me", ballc=0.55, imp=3, people=["ravi"])
smsg(E, "mia", "-1d 09:00", "Initech import keeps timing out on large files. Thread for the fix.", imp=3, people=["ravi", "anika"],
     replies=[("theo", "-1d 09:20", "Chunked importer should fix it. I'll review today."),
              ("mia", "-1d 10:05", "PR is up for ACME-298."),
              ("dana", "-1d 11:00", "Thanks both. I'll tell Ravi we expect a fix this week.")])
smsg(E, "theo", "-1d 14:05", "LED-158 invoice PDF is ready for review.", imp=1)
smsg(E, "mia", "-2d 10:00", "SSO for Globex is configured against their IdP metadata.", imp=2, people=["priya"])
smsg(E, "theo", "-2d 16:00", "Metering is live in staging for LED-142.", imp=1)
smsg(E, "mia", "-3d 11:00", "Sandbox for Initech is provisioned.", imp=1)
smsg(E, "theo", "-4d 15:00", "Proration bug filed as LED-160.", imp=1)
smsg(E, "mia", "-5d 10:00", "Audit log export is next after SSO.", imp=1)
smsg(E, "theo", "-6d 12:00", "Retro notes are in Notion.", imp=0)
smsg(E, "mia", "-7d 09:00", "Rate limit on bulk API shipped.", imp=1)
smsg(E, "theo", "-8d 10:00", "Ledger 2.0 go/no-go is with Lena next week.", imp=1)
smsg(E, "mia", "-9d 15:00", "Flaky checkout e2e fixed.", imp=0)
smsg(E, "theo", "-10d 10:00", "Planning for next sprint starts Monday.", imp=0)
smsg(E, "mia", "-11d 11:00", "Welcome to the new eng channel layout.", imp=0)
G = CH["globex"]["id"]
smsg(G, "priya", "-1d 10:00", "Morning! Legal is done on our side. Marco will send the final redline today.", kind="customer", imp=3)
smsg(G, "dana", "-1d 10:15", "Great news, thank you Priya. We'll countersign as soon as it lands.", kind="customer", imp=2, people=["priya"])
smsg(G, "priya", "-3d 12:00", "Quick one: is SSO still planned for the week after signature?", kind="customer", imp=2)
smsg(G, "mia", "-3d 12:30", "Yes. Config is tested against your IdP.", kind="customer", imp=2, people=["priya"])
smsg(G, "priya", "-5d 09:05", "Our security team sent a questionnaire by email, mostly standard.", kind="customer", imp=1)
smsg(G, "dana", "-5d 09:25", "Got it, answering this week.", kind="customer", imp=1, people=["priya"])
smsg(G, "priya", "-12d 10:00", "Filed the SSO request through your Linear asks. Thanks for the quick turnaround.", kind="customer", imp=1)
smsg(G, "dana", "-12d 10:30", "Thanks Priya, Mia is on it.", kind="customer", imp=1, people=["priya"])
smsg(G, "priya", "-20d 09:00", "Welcome to the shared channel, everyone.", kind="customer", imp=0)
smsg(G, "sam", "-20d 09:30", "Glad to have you here, Priya.", kind="customer", imp=0, people=["priya"])
smsg(DM_THEO, "dana", "-1d 14:00", "Can you send me the latest deck before Owen's call?", ball="them", ballc=0.8, imp=2, people=["theo", "owen"], lane="waiting")
smsg(DM_THEO, "theo", "-1d 13:50", "Deck v3 is in your inbox.", imp=1)
smsg(DM_THEO, "dana", "-2d 18:00", "Owen wants the board on November 18.", imp=2, people=["owen"])
smsg(DM_THEO, "theo", "-2d 18:10", "Works for me.", imp=0)
smsg(DM_THEO, "theo", "-3d 09:00", "Q3 numbers draft is in Notion.", imp=1)
smsg(DM_THEO, "dana", "-3d 09:30", "Thanks, reading now.", imp=0)

total = sum(len(v) for v in slack_msgs.values())
assert total == 48, total
assert len(SLACK_SPECS) == len(set(SLACK_SPECS)), 'duplicate slack ts'
def slack_history_pages():
    pages = []
    for ch, msgs in slack_msgs.items():
        msgs = sorted(msgs, key=lambda x: secs_of(x[0]), reverse=True)
        ms = [m for _, m in msgs]   # newest first, as conversations.history returns them
        chunks = [ms[i:i + 15] for i in range(0, len(ms), 15)]
        for i, c in enumerate(chunks):
            more = i + 1 < len(chunks)
            pages.append({"match": {"partition": ch, "cursor": None if i == 0 else "slk-%s-%d" % (ch, i)},
                          "response": {"ok": True, "messages": c, "has_more": more, "pin_count": 0,
                                       "response_metadata": {"next_cursor": "slk-%s-%d" % (ch, i + 1) if more else ""}}})
    return pages
write("slack/messages.pages.json", {
    "$shapedFrom": shaped(SL["history"], "docs/research/one-actions.md section 9"),
    "actionId": SL["history"], "pages": slack_history_pages(),
})
write("slack/replies.pages.json", {"$shapedFrom": shaped(SL["replies"], "Retrieve a Conversation Thread's Replies; a thread with no replies gets the empty shape"),
                                   "actionId": SL["replies"], "pages": slack_replies})
write("slack/account.json", {"$shapedFrom": shaped(SL["auth"], "Test Authentication (auth.test), user token"), "actionId": SL["auth"],
                             "response": {"ok": True, "url": "https://acme-inc.slack.com/", "team": "Acme Inc", "user": "dana",
                                          "team_id": TEAM, "user_id": "U01DANA"}})
COUNTS["slack.messages"] = 48

# ================================================================== Teams
TM = {"chats": "conn_mod_def::GJ7M0XFmgfA::ccNbrhTlTROYTSZtYigXCg", "msgs": "conn_mod_def::GJ7M1v_ty1I::z6ijZ292SHKR9tz7c9nEOQ",
      "joined": "conn_mod_def::GJ7NUzqmPxU::KPH8i5-qTwG3rhZHepN3Fg", "channels": "conn_mod_def::GJ7NFwMDWsI::zD6Vj-Z-SoKYto-H5m6G7A",
      "chandelta": "conn_mod_def::GJ7NFaW12yo::D62bOYGhSkK1cOoDf-KCWA"}
TENANT = "6f1c0a2e-acme-4eu0-9a11-000000000001"
AAD = {"dana_eu": "7f3c2a10-5e1b-4d0a-9c77-acme0eu0dana", "lena": "8a4d3b21-6f2c-4e1b-8d88-acme0eu0lena", "mia": "9b5e4c32-7a3d-4f2c-9e99-acme0guestmia"}
def member(k):
    return {"@odata.type": "#microsoft.graph.aadUserConversationMember", "id": "MCMjMSMj" + hexid("mem", k, n=12), "roles": ["owner"],
            "displayName": name(k), "visibleHistoryStartDateTime": "0001-01-01T00:00:00Z", "userId": AAD[k], "email": email(k), "tenantId": TENANT}
CHAT_UMB = "19:umbrella-pricing-" + hexid("chat", "umb", n=16) + "@thread.v2"
CHAT_ENG = "19:eng-sync-" + hexid("chat", "eng", n=16) + "@thread.v2"
chats = [
    {"id": CHAT_UMB, "topic": "Umbrella pricing", "createdDateTime": rel("-20d 09:00"), "lastUpdatedDateTime": rel("-2h"), "chatType": "group",
     "webUrl": "https://teams.microsoft.com/l/chat/%s/0?tenantId=%s" % (CHAT_UMB, TENANT), "tenantId": TENANT, "isHiddenForAllMembers": False,
     "members": [member("dana_eu"), member("lena")]},
    {"id": CHAT_ENG, "topic": "Eng sync", "createdDateTime": rel("-60d 09:00"), "lastUpdatedDateTime": rel("-1d 08:00"), "chatType": "group",
     "webUrl": "https://teams.microsoft.com/l/chat/%s/0?tenantId=%s" % (CHAT_ENG, TENANT), "tenantId": TENANT, "isHiddenForAllMembers": False,
     "members": [member("dana_eu"), member("mia"), member("lena")]},
]
write("teams/chats.pages.json", {
    "$shapedFrom": shaped(TM["chats"], "docs/research/one-actions.md section 10; members via $expand=members (I)"),
    "actionId": TM["chats"],
    "pages": [{"match": {"cursor": None}, "response": {"@odata.context": "https://graph.microsoft.com/v1.0/$metadata#chats(members())", "@odata.count": 2, "value": chats}}],
})
tmsg_n = [1761000000000]
teams_msgs = {CHAT_UMB: [], CHAT_ENG: []}
def tmsg(chat, who, when, html, needs=0.1, ball="nobody", ballc=0.7, imp=1, mentions=(), people=None, kind="team_chat"):
    tmsg_n[0] += 7331
    mid = str(tmsg_n[0])
    m = {"id": mid, "replyToId": None, "etag": mid, "messageType": "message", "createdDateTime": rel(when), "lastModifiedDateTime": rel(when),
         "lastEditedDateTime": None, "deletedDateTime": None, "subject": None, "summary": None, "chatId": chat, "importance": "normal",
         "locale": "en-us", "webUrl": "https://teams.microsoft.com/l/message/%s/%s?context=%%7B%%22contextType%%22%%3A%%22chat%%22%%7D" % (chat, mid), "channelIdentity": None, "policyViolation": None, "eventDetail": None,
         "from": {"application": None, "device": None, "user": {"@odata.type": "#microsoft.graph.teamworkUserIdentity", "id": AAD[who],
                                                                  "displayName": name(who), "userIdentityType": "aadUser", "tenantId": TENANT}},
         "body": {"contentType": "html", "content": html}, "attachments": [],
         "mentions": [{"id": i, "mentionText": name(mk), "mentioned": {"application": None, "device": None, "conversation": None,
                       "user": {"@odata.type": "#microsoft.graph.teamworkUserIdentity", "id": AAD[mk], "displayName": name(mk), "userIdentityType": "aadUser", "tenantId": TENANT}}}
                      for i, mk in enumerate(mentions)],
         "reactions": [], "messageHistory": []}
    teams_msgs[chat].append((secs_of(when), m))
    ppl = set(people or [])
    if who not in SELF: ppl.add(who)
    judge("teams:" + mid, when, list(ppl), kind=kind, needs=needs, ball=ball, ballc=ballc, imp=imp, wrote_last=(who == "dana_eu"))
    return mid
tmsg(CHAT_UMB, "lena", "-2h", "<p>Dana, Felix is asking for 12% off across all three entities. I need your OK before I reply today.</p>", needs=0.9, ball="me", ballc=0.88, imp=3, people=["felix"])
tmsg(CHAT_UMB, "lena", "-3h", "<p>Hannah confirmed the committee meets Monday.</p>", imp=2, people=["hannah"])
tmsg(CHAT_UMB, "dana_eu", "-1d 07:30", "<p>Let's hold at 8% unless they sign a two year term.</p>", imp=2)
tmsg(CHAT_UMB, "lena", "-1d 07:20", "<p>Felix wants per-entity pricing before the procurement call.</p>", imp=2, people=["felix"])
tmsg(CHAT_UMB, "dana_eu", "-2d 09:00", "<p>I sent the per-entity sheet to Felix.</p>", imp=1)
tmsg(CHAT_UMB, "lena", "-3d 10:00", "<p>Umbrella's data residency answers are drafted, sending to you for review.</p>", imp=2)
tmsg(CHAT_UMB, "dana_eu", "-3d 10:30", "<p>Thanks Lena, reviewing tonight.</p>", imp=1)
tmsg(CHAT_UMB, "lena", "-5d 08:00", "<p>Hannah sent the questionnaire, 42 questions.</p>", imp=1, people=["hannah"])
tmsg(CHAT_UMB, "dana_eu", "-5d 08:30", "<p>I'll take security and SSO, you take residency.</p>", imp=1)
tmsg(CHAT_UMB, "lena", "-6d 09:00", "<p>Started a chat for Umbrella pricing.</p>", imp=0)
tmsg(CHAT_ENG, "mia", "-1d 08:00", "<p>Ranking of open issues for the go/no-go: LED-158 is in review, LED-161 still todo.</p>", imp=2)
tmsg(CHAT_ENG, "lena", "-1d 07:50", "<p>For EU we cannot launch without tax IDs on invoices.</p>", imp=2, mentions=("mia",))
tmsg(CHAT_ENG, "dana_eu", "-2d 08:00", "<p>Umbrella needs LED-161 before their rollout too.</p>", imp=2)
tmsg(CHAT_ENG, "mia", "-2d 08:20", "<p>Noted. Theo is planning it for next sprint.</p>", imp=1)
tmsg(CHAT_ENG, "lena", "-4d 09:00", "<p>Go/no-go is booked for Thursday morning.</p>", imp=1)
tmsg(CHAT_ENG, "mia", "-5d 09:00", "<p>Invoice PDF redesign is close.</p>", imp=1)
tmsg(CHAT_ENG, "dana_eu", "-6d 10:00", "<p>Thanks both.</p>", imp=0)
tmsg(CHAT_ENG, "mia", "-7d 10:00", "<p>Created this chat for the Ledger 2.0 EU launch.</p>", imp=0)
tpages = []
for chat, msgs in teams_msgs.items():
    ms = [m for _, m in sorted(msgs, key=lambda x: x[0], reverse=True)]   # $orderby=lastModifiedDateTime desc
    chunks = [ms[:6], ms[6:]] if len(ms) > 6 else [ms]
    for i, c in enumerate(chunks):
        resp = {"@odata.context": "https://graph.microsoft.com/v1.0/$metadata#chats('%s')/messages" % chat, "@odata.count": len(c), "value": c}
        if i + 1 < len(chunks):
            resp["@odata.nextLink"] = "https://graph.microsoft.com/v1.0/chats/%s/messages?$top=50&$skiptoken=tm-%s-2" % (chat, hexid(chat, n=6))
        tpages.append({"match": {"partition": chat, "cursor": None if i == 0 else tpages[-1]["response"]["@odata.nextLink"]}, "response": resp})
assert sum(len(v) for v in teams_msgs.values()) == 18
write("teams/chat-messages.pages.json", {
    "$shapedFrom": shaped(TM["msgs"], "docs/research/one-actions.md section 10"),
    "actionId": TM["msgs"], "pages": tpages,
})
COUNTS["teams.chat-messages"] = 18

TEAM_ID = "5c3a9e10-acme-4eu0-b0b0-000000000042"
CHAN = "19:general-" + hexid("chan", "general", n=16) + "@thread.tacv2"
write("teams/joined-teams.pages.json", {
    "$shapedFrom": shaped(TM["joined"], "docs/research/one-actions.md section 10"),
    "actionId": TM["joined"],
    "pages": [{"match": {"cursor": None}, "response": {"value": [{
        "id": TEAM_ID, "createdDateTime": rel("-400d 09:00"), "description": "Acme Europe", "displayName": "Acme Europe",
        "isArchived": False, "tenantId": TENANT, "visibility": "private",
        "webUrl": "https://teams.microsoft.com/l/team/19%%3Ageneral%%40thread.tacv2/conversations?groupId=%s&tenantId=%s" % (TEAM_ID, TENANT)}]}}],
})
write("teams/channels.pages.json", {
    "$shapedFrom": shaped(TM["channels"], "docs/research/one-actions.md section 10"),
    "actionId": TM["channels"],
    "pages": [{"match": {"cursor": None, "partition": TEAM_ID}, "response": {"value": [{
        "id": CHAN, "createdDateTime": rel("-400d 09:00"), "description": "Acme Europe general", "displayName": "General",
        "isArchived": False, "isFavoriteByDefault": True, "membershipType": "standard", "tenantId": TENANT,
        "webUrl": "https://teams.microsoft.com/l/channel/%s/General?groupId=%s&tenantId=%s" % (CHAN.replace(":", "%3A").replace("@", "%40"), TEAM_ID, TENANT)}]}}],
})
chan_msgs = []
for i, (who, when, html) in enumerate([("lena", "-2d 09:00", "<p>EU pipeline review moved to Tuesday.</p>"),
                                       ("dana_eu", "-3d 10:00", "<p>Umbrella procurement call went well, questionnaire due Friday.</p>"),
                                       ("lena", "-6d 08:00", "<p>Welcome to the Acme Europe team space.</p>")]):
    mid = str(1760900000000 + i * 1111)
    chan_msgs.append({"id": mid, "replyToId": None, "etag": mid, "messageType": "message", "createdDateTime": rel(when), "lastModifiedDateTime": rel(when),
                      "lastEditedDateTime": None, "deletedDateTime": None, "subject": None, "summary": None, "chatId": None, "importance": "normal",
                      "locale": "en-us", "webUrl": "https://teams.microsoft.com/l/message/%s/%s" % (CHAN, mid),
                      "channelIdentity": {"teamId": TEAM_ID, "channelId": CHAN}, "policyViolation": None, "eventDetail": None,
                      "from": {"application": None, "device": None, "user": {"id": AAD[who], "displayName": name(who), "userIdentityType": "aadUser", "tenantId": TENANT}},
                      "body": {"contentType": "html", "content": html}, "attachments": [], "mentions": [], "reactions": [], "messageHistory": [],
                      "hostedContents": [], "replies": []})
    judge("teams:" + mid, when, [] if who in SELF else [who], kind="team_chat", imp=1)
CDELTA = "https://graph.microsoft.com/v1.0/teams/%s/channels/%s/messages/microsoft.graph.delta()" % (TEAM_ID, CHAN)
write("teams/channel-messages.pages.json", {
    "$shapedFrom": shaped(TM["chandelta"], "docs/research/one-actions.md section 10"),
    "actionId": TM["chandelta"],
    "pages": [
        {"match": {"partition": TEAM_ID + "/" + CHAN, "cursor": None, "delta": None}, "response": {"value": chan_msgs, "@odata.deltaLink": CDELTA + "?$deltatoken=tch-delta-1"}},
        {"match": {"partition": TEAM_ID + "/" + CHAN, "cursor": None, "delta": CDELTA + "?$deltatoken=tch-delta-1"}, "response": {"value": [], "@odata.deltaLink": CDELTA + "?$deltatoken=tch-delta-1"}},
    ],
})
COUNTS["teams.channel-messages"] = 3

# ================================================================== Granola
GR = {"list": "conn_mod_def::GKbJ53hO4Ng::02BNDFnhQ-CVKjaPxMIMrg", "get": "conn_mod_def::GKbJ523eLeg::Qnq0sQ9eSQGAepuzo55Jsw"}
def gid(key): return "not_" + hashlib.sha1(("gr" + key).encode()).hexdigest()[:14].replace("0", "Q").replace("1", "z")
OWNER_G = {"id": "usr_acmeDana0000001", "object": "user", "name": "Dana Oyelaran", "email": "dana@acme.com"}
gr_list, gr_detail = [], {}
def gnote(key, title, start, minutes, attendees, folder, summary_md, organiser="dana", event_key=None, transcript=None, imp=2, needs=0.1, ball="nobody", ballc=0.7):
    nid = gid(key)
    end_spec = rel(start, None, minutes)
    updated = rel(start, None, minutes + 20)
    gr_list.append((days_of(start), {"id": nid, "object": "note", "title": title, "owner": OWNER_G, "created_at": rel(start), "updated_at": updated}))
    summary_text = re.sub(r"[#*\-]+ ?", "", summary_md).strip()
    detail = {"id": nid, "object": "note", "title": title, "owner": {"name": "Dana Oyelaran", "email": "dana@acme.com"},
              "created_at": rel(start), "updated_at": updated,
              "calendar_event": {"event_title": title, "invitees": [{"email": email(a)} for a in attendees], "organiser": email(organiser),
                                 "calendar_event_id": hexid("gcal", event_key, n=26) if event_key else None,
                                 "scheduled_start_time": rel(start), "scheduled_end_time": end_spec},
              "attendees": [{"name": name(a), "email": email(a)} for a in attendees],
              "folder_membership": [{"id": "fol_" + hashlib.sha1(folder.encode()).hexdigest()[:14], "object": "folder", "name": folder}],
              "summary_text": summary_text, "summary_markdown": summary_md}
    if transcript:
        detail["transcript"] = [{"speaker": name(s), "text": t, "start_time": rel(start, None, i * 2) if i else rel(start),
                                 "end_time": rel(start, None, i * 2 + 1)} for i, (s, t) in enumerate(transcript)]
    gr_detail[nid] = detail
    judge("granola:" + nid, start, [a for a in attendees if a not in SELF], kind="calendar", imp=imp, needs=needs, ball=ball, ballc=ballc)
    return nid

gnote("contract_review", "Globex contract review", "-2d 14:00", 30, ["dana", "priya_s", "sam"], "Customers",
      "## Globex contract review\n\n### Decisions\n- Legal has no further redlines; Marco sends the final MSA.\n- Rate for 2027 stays at 84,000.\n\n### Asks\n- Priya wants a **multi-year discount** quoted before she signs.\n\n### Next steps\n- Sam sends the two year quote.\n- Dana countersigns once the redline lands.",
      event_key="contract_review", imp=3,
      transcript=[("priya_s", "We are happy with the terms. Can you quote two years before we sign?"), ("dana", "Yes, Sam will send it tomorrow.")])
gnote("initech_kickoff", "Initech pilot kickoff", "-8d 10:00", 60, ["dana", "ravi", "anika", "mia"], "Customers",
      "## Initech pilot kickoff\n\n### Scope\nTwo data sources, one team, eight weeks.\n\n### Success criteria\nNightly CSV import under 10 minutes on the 80 MB export.\n\n### Owners\n- Ravi: technical owner\n- Anika: data access\n- Mia: Acme engineering",
      event_key="initech_kickoff", imp=2)
gnote("umbrella_call", "Umbrella procurement call", "-3d 08:00", 45, ["dana_eu", "hannah", "lena"], "Customers",
      "## Umbrella procurement call\n\n### Notes\nCommittee meets Monday. Questionnaire due Friday. Hannah flagged data residency and SSO as the deciding sections.\n\n### Next steps\n- Lena drafts residency answers.\n- Dana answers security and SSO.",
      organiser="hannah", imp=3)
gnote("pipeline_review", "Pipeline review", "-7d 11:00", 30, ["dana", "sam"], "Internal",
      "## Pipeline review\n\nPipeline at 1.9M. Globex and Umbrella are 60% of the quarter. Initrode starter added at 18k.", organiser="sam", imp=1)
gnote("one_on_one", "Dana / Theo 1:1", "-1d 15:00", 30, ["dana", "theo"], "Internal",
      "## Dana / Theo 1:1\n\n- Board deck: sales slides due Wednesday night.\n- Pricing page copy: comments by Friday.", imp=1)
gnote("security_review", "Initech security review", "-60d 11:00", 45, ["dana", "ravi_m", "anika"], "Customers",
      "## Initech security review\n\nRavi walked through their vendor checklist. No blockers. SOC report shared after the call.", imp=1)
gr_list.sort(key=lambda x: x[0])     # created ascending
gl = [n for _, n in gr_list]
write("granola/notes.pages.json", {
    "$shapedFrom": shaped(GR["list"], "docs/research/one-actions.md section 11"),
    "actionId": GR["list"],
    "pages": [
        {"match": {"cursor": None}, "response": {"notes": gl[:4], "hasMore": True, "cursor": "eyJncmFub2xhIjoicGFnZTIifQ=="}},
        {"match": {"cursor": "eyJncmFub2xhIjoicGFnZTIifQ=="}, "response": {"notes": gl[4:], "hasMore": False, "cursor": None}},
    ],
})
write("granola/notes.details.json", {"$shapedFrom": shaped(GR["get"], "Get Note"), "actionId": GR["get"], "byId": gr_detail})
COUNTS["granola.notes"] = 6

# ================================================================== Zendesk (New profile sample, sample:: actions only)
ZD_ACTIONS = [
    # (fixture id, real catalog id it mirrors, title, method, path, read)
    ("sample::zendesk::incremental-tickets-cursor", "conn_mod_def::GJ8Yg-wzuPs::ona0Gzt-S_6lBP1I8V8y7g", "Incremental Ticket Export (Cursor-based)", "GET", "/api/v2/incremental/tickets/cursor", True),
    ("sample::zendesk::incremental-tickets-time", "conn_mod_def::GJ8Yg-NVdgo::eilHTHLdTV2SKwKT8ARILQ", "Incremental Ticket Export (Time-Based)", "GET", "/api/v2/incremental/tickets", True),
    ("sample::zendesk::list-tickets", "conn_mod_def::GJ8YsEOuyzs::i5cu44u4T7qWhAQJ_mTu1A", "List Tickets", "GET", "/api/v2/tickets", True),
    ("sample::zendesk::list-recent-tickets", "conn_mod_def::GJ8YsAbgwZU::v8t-TFnTR2e_ZcUlSsv1AA", "List Recent Tickets", "GET", "/api/v2/tickets/recent", True),
    ("sample::zendesk::incremental-users", "conn_mod_def::GJ8YhInbdoI::eFkpkJgMSwmXwTj9Sx7ktA", "Incremental User Export (Time-Based)", "GET", "/api/v2/incremental/users", True),
    ("sample::zendesk::update-ticket", "conn_mod_def::GJ8YsdGrlPg::9_SIvAvVRP-KfnX2oA6qCA", "Update a Ticket", "PUT", "/api/v2/tickets/{{ticketId}}", False),
    ("sample::zendesk::update-many-tickets", "conn_mod_def::GJ8YsdFUeJc::hNqGJNhuRJqQvvkMpUWndg", "Update Many Tickets", "PUT", "/api/v2/tickets/update_many", False),
    ("sample::zendesk::delete-ticket", "conn_mod_def::GJ8Yrw4PQuI::byy7QYe_T7-XMQZg2X7DuQ", "Delete a Ticket", "DELETE", "/api/v2/tickets/{{ticketId}}", False),
    ("sample::zendesk::bulk-delete-tickets", "conn_mod_def::GJ8YrqJCSV8::09pAokjpQNSkj5MbQX49mA", "Bulk Delete Tickets", "DELETE", "/api/v2/tickets/destroy_many", False),
    ("sample::zendesk::update-organization", "conn_mod_def::GJ8Ylnmr_iE::attZfS8cTVKJ9wl6bmkorw", "Update an Organization", "PUT", "/api/v2/organizations/{{organizationId}}", False),
]
write("catalog/actions/zendesk.json", {
    "$shapedFrom": "@withone/connect PlatformAction (listActions), titles, methods and paths copied from the real Zendesk catalog entries named in `mirrors`",
    "platform": "zendesk",
    "actions": [{"_id": a, "title": t, "method": m, "path": p, "tags": ["zendesk"] + ([] if r else ["write"]), "mirrors": real}
                for a, real, t, m, p, r in ZD_ACTIONS],
})

def load_doc(name_):
    f = os.path.join("/tmp/srchpk/zd", name_ + ".json")
    if not os.path.exists(f):
        return None
    s = open(f).read()
    return json.loads(s[s.find("{"):])["loaded"][0]["knowledge"]

def qschema(props, required=()):
    return {"type": "object", "properties": props, "required": list(required)}

ZD_IO = {
    "incremental-tickets-cursor": {"input": {"query": qschema({"start_time": {"type": "integer", "description": "Unix seconds, required on the first request"},
                                                                "cursor": {"type": "string"}, "support_type_scope": {"type": "string", "enum": ["all", "agent", "ai_agent"]}})},
                                   "output": {"type": "object", "properties": {"tickets": {"type": "array"}, "after_cursor": {"type": "string"}, "end_of_stream": {"type": "boolean"}}}},
    "incremental-tickets-time": {"input": {"query": qschema({"start_time": {"type": "integer"}}, ["start_time"])},
                                 "output": {"type": "object", "properties": {"tickets": {"type": "array"}, "next_page": {"type": "string"}, "end_time": {"type": "integer"}, "count": {"type": "integer"}, "end_of_stream": {"type": "boolean"}}}},
    "list-tickets": {"input": {"query": qschema({"page[size]": {"type": "integer", "maximum": 100}, "page[after]": {"type": "string"}, "sort": {"type": "string"}})},
                     "output": {"type": "object", "properties": {"tickets": {"type": "array"}, "meta": {"type": "object"}, "links": {"type": "object"}}}},
    "list-recent-tickets": {"input": {"query": qschema({})}, "output": {"type": "object", "properties": {"tickets": {"type": "array"}}}},
    "incremental-users": {"input": {"query": qschema({"start_time": {"type": "integer"}}, ["start_time"])},
                          "output": {"type": "object", "properties": {"users": {"type": "array"}, "next_page": {"type": "string"}, "end_of_stream": {"type": "boolean"}}}},
}
DOC_FILES = {"incremental-tickets-cursor": "cursor", "incremental-tickets-time": "time", "list-tickets": "list", "list-recent-tickets": "recent", "incremental-users": "users"}
for a, real, t, m, p, r in ZD_ACTIONS:
    if not r:
        continue
    short = a.split("::")[-1]
    path = os.path.join(ROOT, "catalog/knowledge", a.replace("::", "__") + ".json")
    knowledge = load_doc(DOC_FILES[short])
    if knowledge is None and os.path.exists(path):
        continue   # keep the committed copy when the CLI cache is gone
    write("catalog/knowledge/%s.json" % a.replace("::", "__"), {
        "$shapedFrom": "@withone/connect ActionKnowledge (getActionKnowledge); knowledge is the real Markdown of %s loaded with the One CLI on 2026-10-29; ioSchema is a fixture shape (I)" % real,
        "actionId": a, "title": t, "method": m, "path": p, "tags": ["zendesk"], "platform": "zendesk",
        "knowledge": knowledge, "ioSchema": ZD_IO[short]})

ZD_USERS = {
    9001: ("Priya Shah", "priya@globex.com", "Globex"), 9002: ("Ravi Menon", "ravi@initech.io", "Initech"),
    9003: ("Anika Rao", "anika@initech.io", "Initech"), 9004: ("Hannah Cole", "hannah.cole@umbrella.co", "Umbrella"),
    9005: ("Grace Liu", "grace.liu@initrode.com", "Initrode"), 9006: ("Mia Park", "mia@acme.com", "Acme Inc"),
}
ZD_TICKETS = [
    (1001, "SSO login loops back to the sign-in page", "After enabling SAML our test user is sent back to the login page.", "open", "high", 9001, 9006, "-6d 10:00", "-1d 15:00", ["sso", "globex"]),
    (1002, "Nightly CSV import timed out", "The 02:00 import failed with a timeout on our 80 MB file.", "pending", "urgent", 9002, 9006, "-3d 08:00", "-3h", ["import", "pilot"]),
    (1003, "Need a sample export format", "Can you share the expected CSV header order?", "solved", "normal", 9003, 9006, "-9d 09:00", "-8d 12:00", ["import"]),
    (1004, "VAT ID missing on invoice", "Our German entity needs its VAT ID on the invoice.", "open", "high", 9004, None, "-5d 09:00", "-1d 12:00", ["billing", "eu"]),
    (1005, "Starter plan API limits", "What are the API limits on the starter plan?", "solved", "low", 9005, None, "-8d 10:00", "-7d 14:00", ["pricing"]),
    (1006, "Audit log export request", "Our auditors need a CSV of admin actions.", "new", "normal", 9001, None, "-2d 11:00", "-2d 11:00", ["feature-request"]),
    (1007, "Import sandbox credentials", "Please send the sandbox credentials to Anika.", "solved", "normal", 9002, 9006, "-4d 12:00", "-1d 11:00", ["pilot"]),
    (1008, "Invoice PDF shows wrong currency", "EUR invoices show a USD symbol.", "hold", "normal", 9004, 9006, "-12d 09:00", "-4d 10:00", ["billing"]),
    (1009, "Two factor reset", "One of our admins lost their phone.", "closed", "normal", 9001, 9006, "-30d 09:00", "-28d 09:00", ["account"]),
    (1010, "Webhook retries", "Do failed webhooks retry, and how often?", "solved", "low", 9003, None, "-15d 10:00", "-14d 10:00", ["api"]),
    (1011, "Data residency question", "Is EU customer data stored in the EU?", "pending", "high", 9004, None, "-6d 09:00", "-2d 09:00", ["eu", "security"]),
    (1012, "Bulk API rate limit hit", "We hit 429s on the bulk endpoint during migration.", "solved", "normal", 9005, 9006, "-20d 10:00", "-14d 10:00", ["api"]),
]
tix = []
for tid_, subj, desc, st, prio, req, asg, created, updated, tags in ZD_TICKETS:
    tix.append({"id": tid_, "url": "https://acme.zendesk.com/api/v2/tickets/%d.json" % tid_, "subject": subj, "description": desc,
                "status": st, "priority": prio, "requester_id": req, "assignee_id": asg, "group_id": 360001, "brand_id": 360002,
                "created_at": rel(created), "updated_at": rel(updated), "tags": tags, "custom_fields": [],
                "via": {"channel": "email", "source": {}}, "allow_attachments": True, "allow_channelback": False, "is_public": True,
                "generated_timestamp": rel_unix(updated)})
tix.sort(key=lambda t: days_of(t["updated_at"]["$rel"]))
write("zendesk/tickets.pages.json", {
    "$shapedFrom": shaped(ZD_ACTIONS[0][1], "Incremental Ticket Export (Cursor-based); fixture action id %s" % ZD_ACTIONS[0][0]),
    "actionId": ZD_ACTIONS[0][0],
    "pages": [
        {"match": {"cursor": None}, "response": {"after_cursor": "zd-after-8", "after_url": "https://acme.zendesk.com/api/v2/incremental/tickets/cursor?cursor=zd-after-8",
                                                                  "before_cursor": None, "before_url": None, "end_of_stream": False, "tickets": tix[:8]}},
        {"match": {"cursor": "zd-after-8"}, "response": {"after_cursor": "zd-after-12", "after_url": "https://acme.zendesk.com/api/v2/incremental/tickets/cursor?cursor=zd-after-12",
                                                                          "before_cursor": "zd-after-8", "before_url": None, "end_of_stream": True, "tickets": tix[8:]}},
    ],
})
write("zendesk/tickets-time.pages.json", {
    "$shapedFrom": shaped(ZD_ACTIONS[1][1], "Incremental Ticket Export (Time-Based); dry-run page only"),
    "actionId": ZD_ACTIONS[1][0],
    "pages": [{"match": {"cursor": None}, "response": {"tickets": tix[:5], "next_page": "https://acme.zendesk.com/api/v2/incremental/tickets.json?start_time=1761700000",
                                                                        "count": 5, "end_of_stream": True, "end_time": rel_unix("-3h")}}],
})
write("zendesk/tickets-list.pages.json", {
    "$shapedFrom": shaped(ZD_ACTIONS[2][1], "List Tickets; dry-run page only"),
    "actionId": ZD_ACTIONS[2][0],
    "pages": [{"match": {"cursor": None}, "response": {"tickets": tix[:5], "meta": {"has_more": True, "after_cursor": "zd-list-5", "before_cursor": None},
                                                                        "links": {"next": "https://acme.zendesk.com/api/v2/tickets.json?page%5Bafter%5D=zd-list-5", "prev": None}}}],
})
write("zendesk/tickets-recent.pages.json", {
    "$shapedFrom": shaped(ZD_ACTIONS[3][1], "List Recent Tickets; dry-run page only"),
    "actionId": ZD_ACTIONS[3][0],
    "pages": [{"match": {"cursor": None}, "response": {"tickets": tix[-5:], "next_page": None, "previous_page": None, "count": 5}}],
})
zusers = [{"id": k, "url": "https://acme.zendesk.com/api/v2/users/%d.json" % k, "name": v[0], "email": v[1], "role": "agent" if v[2] == "Acme Inc" else "end-user",
           "organization_id": 7000 + k % 10, "created_at": rel("-200d 10:00"), "updated_at": rel("-10d 10:00"), "active": True, "time_zone": "Pacific Time (US & Canada)"}
          for k, v in ZD_USERS.items()]
write("zendesk/users.pages.json", {
    "$shapedFrom": shaped(ZD_ACTIONS[4][1], "Incremental User Export (Time-Based); dry-run page only"),
    "actionId": ZD_ACTIONS[4][0],
    "pages": [{"match": {"cursor": None}, "response": {"users": zusers, "next_page": None, "count": len(zusers), "end_of_stream": True, "end_time": rel_unix("-1h")}}],
})
COUNTS["zendesk.tickets"] = 12

# --- the proposal the sample LLM returns (ProposalOutput, CONTRACT 4.6)
ZD_PROFILE = {
    "$schema": "https://search.forkable.dev/schema/profile-1.json",
    "id": "zendesk.tickets", "platform": "zendesk", "model": "tickets", "kind": "record", "title": "Zendesk tickets",
    "description": "Support tickets changed since the last run, from Zendesk's cursor-based incremental export.",
    "author": "sample", "revision": 1, "verified": "none", "sampleOnly": True,
    "proposal": {"by": "fixture", "draftId": "drf_sample_zendesk", "at": "2026-10-29T10:12:00Z"},
    "list": {
        "actionId": "sample::zendesk::incremental-tickets-cursor",
        "query": {"start_time": "{{ run.since | unix }}", "support_type_scope": "all"},
        "resultsPath": "tickets", "idPath": "id",
        "pagination": {"type": "cursor", "next": "after_cursor", "passAs": "query:cursor", "hasMore": "end_of_stream", "hasMoreInverted": True},
    },
    "incremental": {"strategy": "watermark", "field": "item.updated_at", "order": "asc", "overlap": "10m", "initial": "180d"},
    "deletes": {"when": "item.status == 'deleted'", "reconcile": "onFullPass", "fullPassEvery": "7d"},
    "fields": {
        "title": "item.subject",
        "body": {"path": "item.description", "decode": "html"},
        "occurredAt": {"path": "item.created_at", "decode": "datetime"},
        "updatedAt": {"path": "item.updated_at", "decode": "datetime"},
        "url": "https://acme.zendesk.com/agent/tickets/{{ item.id }}",
        "status": "item.status",
        "labels": {"path": "item.tags[]", "pick": "all"},
        "facets": {"x_priority": "item.priority", "x_channel": "item.via.channel"},
    },
    "entities": {"refs": [
        {"role": "author", "type": "person", "externalId": {"template": "zendesk:user:{{ item.requester_id }}"}},
        {"role": "assignee", "type": "person", "externalId": {"template": "zendesk:user:{{ item.assignee_id }}"}},
    ]},
    "chunk": {"strategy": "paragraph", "maxTokens": 400},
    "schedule": {"every": "30m"},
}
ZD_USERS_PROFILE = {
    "$schema": "https://search.forkable.dev/schema/profile-1.json",
    "id": "zendesk.users", "platform": "zendesk", "model": "users", "kind": "person", "title": "Zendesk people",
    "description": "Requesters and agents, so ticket authors resolve to people.",
    "author": "sample", "revision": 1, "verified": "none", "sampleOnly": True,
    "proposal": {"by": "fixture", "draftId": "drf_sample_zendesk", "at": "2026-10-29T10:12:00Z"},
    "list": {
        "actionId": "sample::zendesk::incremental-users",
        "query": {"start_time": "{{ run.since | unix }}"},
        "resultsPath": "users", "idPath": "id",
        "pagination": {"type": "nextUrl", "next": "next_page"},
    },
    "incremental": {"strategy": "watermark", "field": "item.updated_at", "order": "asc", "overlap": "10m", "initial": "all"},
    "deletes": {"when": "item.active == false", "reconcile": "onFullPass", "fullPassEvery": "7d"},
    "fields": {
        "title": "item.name",
        "body": {"join": ["item.email", "item.role"], "sep": ". "},
        "occurredAt": {"path": "item.created_at", "decode": "datetime"},
        "updatedAt": {"path": "item.updated_at", "decode": "datetime"},
        "url": "https://acme.zendesk.com/agent/users/{{ item.id }}",
        "facets": {"email": {"path": "item.email", "decode": "email"}},
    },
    "entities": {"directory": True, "is": {"type": "person", "email": {"path": "item.email", "decode": "email"}, "name": "item.name",
                                           "externalId": {"template": "zendesk:user:{{ item.id }}"}}},
    "chunk": {"strategy": "whole"},
    "schedule": {"every": "60m"},
}
write("proposals/zendesk.tickets.json", {
    "$shapedFrom": "ProposalOutput (CONTRACT 4.6): what the proposal model returns for the sample Zendesk draft. Saving zendesk.tickets indexes 12 tickets.",
        "models": [
            {"recommended": True,
             "reason": "Tickets are what people search for in a help desk, and this export returns only what changed since the last run.",
             "profile": ZD_PROFILE,
             "fieldNotes": [
                 {"target": "title", "path": "item.subject", "confidence": 0.97, "reason": "Short, present on every ticket"},
                 {"target": "body", "path": "item.description", "confidence": 0.9, "reason": "First comment, the customer's words"},
                 {"target": "occurredAt", "path": "item.created_at", "confidence": 0.95, "reason": "ISO creation time on every sample"},
                 {"target": "updatedAt", "path": "item.updated_at", "confidence": 0.95, "reason": "Also the incremental watermark"},
                 {"target": "url", "path": "item.url", "confidence": 0.62, "reason": "API url; agent page built from its subdomain"},
                 {"target": "status", "path": "item.status", "confidence": 0.93, "reason": "new, open, pending, hold, solved, closed"},
                 {"target": "labels", "path": "item.tags[]", "confidence": 0.88, "reason": "Tags are how agents group tickets"},
                 {"target": "facets.x_priority", "path": "item.priority", "confidence": 0.8, "reason": "Useful filter, not a core facet"},
                 {"target": "entities.refs[0]", "path": "item.requester_id", "confidence": 0.7, "reason": "Only an id; names need the users model"},
             ],
             "questions": ["The API returns an API url, not the agent page. Is https://acme.zendesk.com/agent/tickets/<id> the right link?"]},
            {"recommended": False,
             "reason": "A directory of requesters and agents. Turn it on only if you want ticket authors to show as people.",
             "profile": ZD_USERS_PROFILE,
             "fieldNotes": [
                 {"target": "title", "path": "item.name", "confidence": 0.95, "reason": "Full name on every sample"},
                 {"target": "entities.is.email", "path": "item.email", "confidence": 0.93, "reason": "Merges with people from mail and CRM"},
             ],
             "questions": []},
        ],
        "notes": "List Tickets and List Recent Tickets return the same objects without a change filter, so the cursor export is the better list. The time-based export is older and pages less evenly.",
})

# ================================================================== catalog/platforms.json (shape of GET /v1/available-connectors)
def catalog_rows():
    keep = ["hubspot", "attio", "gmail", "outlook-mail", "google-calendar", "outlook-calendar", "notion", "linear", "slack", "teams", "granola",
            "zendesk", "intercom", "salesforce", "pipedrive", "jira", "asana", "github", "google-drive", "dropbox", "confluence", "airtable",
            "front", "freshdesk", "zoom", "calendly", "stripe", "shopify", "monday", "clickup", "trello", "basecamp", "help-scout",
            "openai", "anthropic", "gemini", "cohere", "mistral-ai", "typesafe"]
    rows = []
    for p in range(1, 12):
        f = "/tmp/srchpk/conn_%d.json" % p
        if os.path.exists(f):
            rows += json.load(open(f))["rows"]
    by = {r["platform"]: r for r in rows}
    out = [by[k] for k in keep if k in by]
    return out
rows = catalog_rows()
if rows:
    write("catalog/platforms.json", rows)   # rows of GET https://api.withone.ai/v1/available-connectors (public, fetched 2026-10-29), a subset

# ================================================================== judgments, matches, rerank, chat
def ref_gmail(key): return "gmail:" + dict(THREAD_META)[key]
JUDG_OUT = {
    "$shapedFrom": "TypeSafe systemone (conn_mod_def::GNh4bXcHPaU::V2ndvy5CQJmYHvkElwVM_w) answers for question set item-v1 (SPEC 9.1), reduced to core's fixture shape; `lane` is the expected lane with VIPs Priya Shah and Owen Price",
    "vips": ["email:priya@globex.com", "email:owen@northwind.vc"],
    "items": JUDG,
}
write("judgments.json", JUDG_OUT)
lanes = {}
for k, v in JUDG.items():
    lanes[v["lane"]] = lanes.get(v["lane"], 0) + 1

write("matches.json", {
    "$shapedFrom": "TypeSafe systemone noul answers for the entity match check (SPEC 8.2)",
    "keyedBy": "the entity key of each side (email:..., name:...)",
    "pairs": [
        {"a": "email:priya@globex.com", "b": "email:priya.shah@gmail.com", "same": 0.93, "reason": "name_only", "expect": "merged",
         "why": "Priya S. attended the Globex contract review that Priya Shah was invited to."},
        {"a": "email:ravi@initech.io", "b": "email:ravi.menon@protonmail.com", "same": 0.72, "reason": "name_only", "expect": "pending",
         "why": "Ravi M. attended an Initech meeting from a personal address. Likely, not certain."},
        {"a": "email:mia@acme.com", "b": "email:mia.park@hooli.dev", "same": 0.08, "reason": "name_only", "expect": "rejected",
         "why": "Same name, different companies: Acme's engineering lead and Hooli's cofounder."},
    ],
})

T = dict(THREAD_META)
OL_REDLINE = "outlook-mail:" + next(m["id"] for _, m in ol_msgs if m["subject"] == "Globex legal redline, final")
GR_REVIEW = "granola:" + gid("contract_review")
NOTION_GLOBEX = "notion:" + uid("notion", "page", "globex_plan")
ACME298 = "linear:" + uid("linear", "issue", "ACME-298")
HANNAH_ASK = "outlook-mail:" + next(m["id"] for _, m in ol_msgs if m["subject"] == "RE: Procurement questionnaire" and m["from"]["emailAddress"]["address"] == email("hannah"))
CHECKIN = "google-calendar:" + hexid("gcal", "initech_checkin", n=26)
LENA_ASK = "teams:" + str(1761000000000 + 7331)
write("rerank.json", {
    "$shapedFrom": "TypeSafe systemone score answers for Jev rerank (SPEC 9.2), reduced to core's fixture shape: candidates best first; anything not listed keeps its RRF place after them",
    "queries": {
        "globex renewal": ["hubspot:401", "gmail:" + T["renewal"], "attio:" + at_id("deals", "globex"), OL_REDLINE, GR_REVIEW, NOTION_GLOBEX],
        "globex renewal terms": ["gmail:" + T["renewal"], "hubspot:401", OL_REDLINE, GR_REVIEW, NOTION_GLOBEX, "attio:" + at_id("deals", "globex")],
        "where are we with globex": ["hubspot:401", NOTION_GLOBEX, OL_REDLINE, GR_REVIEW, "gmail:" + T["renewal"]],
        "initech csv import problem": [ACME298, "gmail:" + T["pilot_import"], "linear:" + uid("linear", "document", "import_runbook"), "gmail:" + T["csv_sample"]],
    },
})

write("chat.json", {
    "$shapedFrom": "Anthropic Create a Message (conn_mod_def::GJfJ6hmtpYo::zy68VQHpRFmqayjAzxkjDA) answers for the sample chat, reduced to core's fixture shape; [n] is the n-th entry of cite",
    "answers": [
        {"q": "where are we with globex?",
         "text": "Priya Shah is your champion on the $84,000 renewal [1]. Globex legal sent the final redline two days ago [2], and on the contract review Priya asked for a multi-year discount before signing [3].",
         "cite": ["hubspot:401", OL_REDLINE, GR_REVIEW],
         "proposal": {"query": "globex with:globex.com after:14d", "reason": "Narrow to the last two weeks of Globex activity."},
         "followups": ["What did Priya ask for on the call?", "Is the SSO rollout on track?", "Draft the two year quote email"]},
        {"q": "what did ravi ask about the pilot?",
         "text": "Ravi reported that the nightly import fails on their 80 MB export and asked for a fix date before Friday's check-in [1]. Mia reproduced it and a chunked importer is in review [2].",
         "cite": ["gmail:" + T["pilot_import"], ACME298],
         "proposal": {"query": "initech import after:7d", "reason": "Everything about the import issue this week."},
         "followups": ["When is the next Initech check-in?", "Who owns ACME-298?"]},
        {"q": "what is waiting on me?",
         "text": "Six things need you. Mia needs a call on which customer gets SSO first [1], Ravi wants a fix date for the import [2], Hannah needs the questionnaire by Friday [3], Theo wants deck edits by Wednesday night [4], Lena needs your OK on Umbrella's 12% ask [5], and the Initech weekly check-in is still waiting for your reply [6].",
         "cite": ["gmail:" + T["sso_priority"], "gmail:" + T["pilot_import"], HANNAH_ASK, "gmail:" + T["board_deck"], LENA_ASK, CHECKIN],
         "proposal": {"query": "lane:needs-you after:7d", "reason": "Only what arrived this week."},
         "followups": ["Which of these are from customers?", "What is due by Friday?"]},
    ],
})

# ================================================================== expectations
def entity_sources():
    return {
        "email:priya@globex.com": {"name": "Priya Shah", "sources": ["hubspot", "attio", "gmail", "google-calendar", "granola", "slack", "outlook-mail", "notion", "linear"],
                                   "via": {"granola": "Jev match of Priya S. (priya.shah@gmail.com), 0.93", "slack": "ext:slack:U05PRIYA from slack.users email",
                                           "outlook-mail": "cc on Globex legal redline, final", "notion": "Champion email property on Globex account plan",
                                           "linear": "externalUserCreator on ACME-311"}},
        "domain:globex.com": {"name": "Globex", "type": "company"},
        "self": {"name": "Dana Oyelaran", "emails": ["dana@acme.com", "dana@acme.eu"], "ext": ["slack:U01DANA"]},
    }

PLAT_EXPECT = {
    "hubspot": {"profiles": {"hubspot.contacts": 8, "hubspot.companies": 6, "hubspot.deals": 4, "hubspot.notes": 5}, "kinds": {"person": 8, "company": 6, "deal": 4, "note": 5}, "tombstoned": 0},
    "attio": {"profiles": {"attio.people": 7, "attio.companies": 5, "attio.deals": 3, "attio.notes": 3}, "kinds": {"person": 7, "company": 5, "deal": 3, "note": 3}, "tombstoned": 0},
    "gmail": {"profiles": {"gmail.threads": 24}, "kinds": {"email_thread": 24}, "tombstoned": 0},
    "outlook-mail": {"profiles": {"outlook-mail.messages": 14}, "kinds": {"email_thread": 14}, "tombstoned": 0, "groups": 8},
    "google-calendar": {"profiles": {"google-calendar.events": 15}, "kinds": {"event": 15}, "tombstoned": 0, "fetched": 16, "cancelledNeverIndexed": 1, "partitions": 2},
    "outlook-calendar": {"profiles": {"outlook-calendar.events": 5}, "kinds": {"event": 5}, "tombstoned": 1, "fetched": 6, "runs": 2,
                         "note": "6 after the first run; the second run's delta removes one"},
    "notion": {"profiles": {"notion.pages": 8}, "kinds": {"doc": 8}, "tombstoned": 0, "hydrated": 8},
    "linear": {"profiles": {"linear.issues": 14, "linear.projects": 2, "linear.documents": 3, "linear.comments": 6}, "kinds": {"task": 14, "doc": 5, "message": 6},
               "tombstoned": 0, "enabledByDefault": {"linear.issues": 14, "linear.projects": 2, "linear.documents": 3}},
    "slack": {"profiles": {"slack.users": 6, "slack.messages": 48}, "kinds": {"person": 6, "message": 48}, "tombstoned": 0, "partitions": 4,
              "threadsWithReplies": 2, "note": "slack.users is a directory profile"},
    "teams": {"profiles": {"teams.chat-messages": 18, "teams.channel-messages": 3}, "kinds": {"message": 21}, "tombstoned": 0,
              "enabledByDefault": {"teams.chat-messages": 18}},
    "granola": {"profiles": {"granola.notes": 6}, "kinds": {"meeting_note": 6}, "tombstoned": 0, "hydrated": 6},
}
ent = entity_sources()
for plat, e in PLAT_EXPECT.items():
    e["items"] = sum(e["profiles"].values())
    # Granola knows Priya only as "Priya S." <priya.shah@gmail.com>; the link to priya@globex.com needs the cross-source Jev match
    key = "email:priya.shah@gmail.com" if plat == "granola" else "email:priya@globex.com"
    e["entities"] = {key: {"sources": [plat]}} if plat in ent["email:priya@globex.com"]["sources"] else {}
    write("%s/expect.json" % plat, {"$comment": "test:profiles expectations (CONTRACT 12): items per profile after all fixture runs", **e})

write("expect-demo.json", {
    "$comment": "Numbers the keyless demo must print (SPEC 18) that come from the fixtures alone. Chunk and vector counts depend on the chunker and are not pinned here.",
    "items": 201,
    "bySource": {"hubspot": 23, "attio": 18, "gmail": 27, "outlook-mail": 14, "google-calendar": 15, "outlook-calendar": 5,
                 "notion": 8, "linear": 19, "slack": 48, "teams": 18, "granola": 6},
    "queries": {"from:priya after:30d type:mail": 3, "lane:needs-you": 6},
    "sources": {
        "hubspot": {"contacts": 8, "companies": 6, "deals": 4, "notes": 5, "items": 23},
        "attio": {"people": 7, "companies": 5, "deals": 3, "notes": 3, "items": 18},
        "gmail": {"threads": 24, "personalThreads": 3, "items": 27, "accounts": 2},
        "outlook-mail": {"messages": 14, "conversations": 8, "items": 14},
        "google-calendar": {"events": 16, "cancelled": 1, "items": 15},
        "outlook-calendar": {"events": 6, "removedOnDelta": 1, "items": 5},
        "notion": {"pages": 8, "items": 8},
        "linear": {"issues": 14, "projects": 2, "documents": 3, "items": 19},
        "slack": {"messages": 48, "threads": 2, "items": 48},
        "teams": {"chatMessages": 18, "items": 18},
        "granola": {"notes": 6, "items": 6},
    },
    "entities": ent,
    "matches": {"merged": 1, "pending": 1, "rejected": 1},
    "lanes": lanes,
    "queryDetails": {
        "from:priya after:30d type:mail": {"titles": ["Globex renewal terms", "Globex security questionnaire", "Intro: Marco from Globex legal"]},
        "lane:needs-you": {"note": "6 judged items, no two in one group"},
        "globex renewal": {"top": ["Globex renewal 2027", "Globex renewal terms", "Globex legal redline, final", "Globex contract review", "#deals"]},
    },
    "ask": {"question": "Where are we with Globex?", "citations": 3, "proposalResults": None},
    "access": "Gmail · delete   declined, 403",
})

assert lanes.get("needs_you") == 6, lanes
print("counts", json.dumps(COUNTS))
print("lanes", lanes, "judged", len(JUDG))
