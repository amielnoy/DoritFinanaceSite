-- The new-agency wizard, Rollout step 2: Dorit seeded as agency 1
-- (docs/superpowers/plans/2026-10-21-agency-content-step2.md).
--
-- What VITE_AGENCY_CONTENT (off) will read for her: her agents row, the seven
-- success cases and the profile's consent and notification columns. The values
-- are the strings the site bundles, copied as they are, and
-- tests/contract/agency-content-seed.contract.test.ts holds the two together:
-- change one and that test fails until the other follows.
--
-- The order is review N-1. agents_guard stamps verified_licence_number on the
-- insert (licence_verified_at is given), and agents_after_change, which fires
-- on it, clears the profile's approval and moves consent_version on. So the
-- agent goes first, the cases after it, and the profile last: its update sets
-- consent_version and the approval to what is meant, and nothing after it
-- can move them again.
--
-- It does not touch testimonials. The consent stamp (consent_confirmed_at/by)
-- records that a reviewer agreed to be shown under an agent, and nobody has
-- recorded that for Dorit's existing rows; stamping them here would write a
-- consent that was never given. They stay public through the agency-1 policy
-- as they are.
--
-- photo_path and booking_url are null: the portrait is a bundled file the
-- site serves for agency 1 (it is not in the agent-photos bucket), and the
-- booking link (VITE_CAL_LINK) is a build-time setting with no value here.
-- licence_types and affiliations are empty: the repository holds no record
-- of either, and inventing them would put a claim in a regulated card.
--
-- Safe to apply once with psql -1, and a second run does nothing.

do $seed$
declare
  c jsonb := $json$
{
  "agency_id": "00000000-0000-0000-0000-000000000001",
  "agent": {
    "id": "00000000-0000-0000-0000-0000000000a1",
    "full_name": "דורית גוב ארי",
    "grammatical_gender": "f",
    "professional_title": "מתכננת פיננסית וסוכנת ביטוח",
    "photo_alt": "דורית גוב ארי — דיוקן מקצועי",
    "licence_number": "L-00107009",
    "licence_regulator": "רשות שוק ההון, ביטוח וחיסכון",
    "has_institutional_affiliation": true,
    "bio": {
      "headline": "תכנון פיננסי וביטוחי שמתחיל בתמונה המלאה — פנסיה, גמל והשתלמות, מיסוי וקיבוע זכויות, ודמי הניהול שנגבים מהחיסכון לאורך השנים.",
      "family": "שמי דורית גוב ארי, נשואה לניב ואמא לשגיא, עדן וירין.",
      "credentials": "ותיקה בתחומי הפיננסים והביטוח, בעלת רישיון סוכן ותואר אקדמאי במדעי ההתנהגות, ניהול וכלכלה.",
      "career": "עבדתי שנים ארוכות כמתכננת פיננסית וביטוח עצמאית, 12 שנים בבנק מזרחי טפחות כיועצת פנסיונית, ותקופה ארוכה כמתכננת פנסיה ומיסוי במרכז לתכנון כלכלי מתקדם בחברת הראל. בשנים האחרונות אני עובדת כמתכננת פיננסית בכירה עם התמחות בהיבטי המיסוי השונים, בשיתוף עם חברת ארבע עונות — בין חברות התכנון הפיננסי הגדולות בארץ.",
      "insight": "במהלך השנים הבנתי כמה דברים בתחום הפנסיוני: הבלבול, תחושת חוסר האונים מול קופות הגמל, ההשתלמות והמוצרים הפנסיוניים השונים, וחוסר הידע של האנשים מביא לטעויות משמעותיות דווקא בקשר לכספים הגדולים והמשמעותיים ביותר שלהם. הלקוחות זקוקים לפתרונות מותאמים לצרכים האישיים שלהם ושל בן/בת הזוג.",
      "unique": "מה שמייחד אותי כאשת מקצוע: שילוב בין מקצועיות וניסיון רבים מאד, אכפתיות ויושר אמיתיים כלפי הלקוחות, הסברים בגובה העיניים המובנים לכולם בתחום המורכב הזה — ובעיקר אנושיות, יחס חם וחיוך תמיד.",
      "signature": "— דורית"
    },
    "stats": [
      {
        "num": "30",
        "label": "שנות ניסיון"
      },
      {
        "num": "מאות",
        "label": "לקוחות מרוצים"
      },
      {
        "num": "1:1",
        "label": "ליווי אישי"
      }
    ],
    "review_links": {
      "google": "https://www.google.com/search?q=דורית+גוב+ארי+ביטוח+חוות+דעת",
      "midrag": "https://www.midrag.co.il/"
    },
    "meeting_minutes": 15
  },
  "success_cases": [
    {
      "id": "00000000-0000-0000-0000-0000000005c1",
      "sort_order": 1,
      "tag": "תביעת חיים",
      "title": "מ-דחייה לאישור מלא תוך 11 ימים",
      "body": "משפחה שנתקלה בסירוב ראשוני לתביעת חיים. ניהלתי את ההליך מול החברה, השלמתי תיעוד והבאתי את הכיסוי המלא — בלי שהמשפחה נאלצה להרים טלפון.",
      "metric": "850 אלף ₪ שולמו",
      "metric_is_estimate": false
    },
    {
      "id": "00000000-0000-0000-0000-0000000005c2",
      "sort_order": 2,
      "tag": "תכנון פנסיה",
      "title": "תכנון שהכפיל את ההכנסה הצפויה בפרישה",
      "body": "לקוח עצמאי בן 47 עם תיק מפוזר. איחדתי מוצרים, בניתי מסלול מותאם והתאמתי את החשיפה — לפי התחזית, הכנסה חודשית בפרישה גבוהה פי שניים מזו שבתיק המקורי.",
      "metric": "פי 2 בתחזית",
      "metric_is_estimate": true
    },
    {
      "id": "00000000-0000-0000-0000-0000000005c3",
      "sort_order": 3,
      "tag": "ביטוח משכנתא",
      "title": "חיסכון של 38% בפרמיה",
      "body": "זוג עם משכנתא חדשה קיבל הצעה סטנדרטית. בדקתי את הכיסויים מול פרופיל הסיכון האמיתי, הסרתי כפילויות והוזלתי את העלות משמעותית.",
      "metric": "38% פחות בפרמיה",
      "metric_is_estimate": false
    },
    {
      "id": "00000000-0000-0000-0000-0000000005c4",
      "sort_order": 4,
      "tag": "בריאות",
      "title": "כיסוי ניתוח שאושר תוך 48 שעות",
      "body": "לקוחה שנזקקה לניתוח דחוף ונדחתה פעמיים. התערבתי ישירות מול מחלקת האישורים, והכיסוי אושר בטרם הניתוח.",
      "metric": "48 שעות",
      "metric_is_estimate": false
    },
    {
      "id": "00000000-0000-0000-0000-0000000005c5",
      "sort_order": 5,
      "tag": "עסק",
      "title": "כיסוי לשותפים בעסק",
      "body": "שותפים בעסק בינוני ללא הסכם שותפים. בניתי מערך כיסויים שנועד לתמוך בהמשכיות העסק ובמשפחות במקרה של אובדן כושר עבודה או פטירה.",
      "metric": "המשכיות עסקית",
      "metric_is_estimate": false
    },
    {
      "id": "00000000-0000-0000-0000-0000000005c6",
      "sort_order": 6,
      "tag": "חיסכון פנסיוני",
      "title": "חיסכון מוערך של 420 אלף ₪ בדמי ניהול",
      "body": "שכירה בת 39 שהפקידה לארבעה מוצרים שונים עם דמי ניהול גבוהים. איחדתי לשני מסלולים ממוקדים, ניהלתי משא ומתן מול הגופים המוסדיים והורדתי את דמי הניהול — החיסכון המצטבר עד הפרישה מוערך ב-₪420 אלף.",
      "metric": "420 אלף ₪ בהערכה",
      "metric_is_estimate": true
    },
    {
      "id": "00000000-0000-0000-0000-0000000005c7",
      "sort_order": 7,
      "tag": "תכנון פיננסי",
      "title": "יציאה לעצמאות עם כרית ביטחון בת 3 שנים",
      "body": "זוג בשנות ה-40 שרצה לעבור לעצמאות אך חשש מאי-הוודאות. בניתי תכנון פיננסי רב-שנתי: קרן חירום, מיפוי סיכונים ומסלול השקעה מדורג. כעבור שלוש שנים יצאו לעצמאות עם כרית ביטחון מלאה.",
      "metric": "3 שנים לעצמאות",
      "metric_is_estimate": false
    }
  ],
  "profile": {
    "notify_emails": [
      "amielnoy@gmail.com",
      "amielnoy@outlook.com"
    ],
    "domain": "govari-fin.co.il",
    "consent_version": "2026-10-agents-v5"
  }
}
  $json$::jsonb;
  a jsonb := c -> 'agent';
begin
  if exists (select 1 from public.agents where id = (a ->> 'id')::uuid) then
    raise notice 'agency 1 is already seeded — nothing done';
    return;
  end if;

  -- 1. the agent (agents_after_change moves consent_version and clears the
  --    approval — both fixed in 3)
  insert into public.agents (
    id, agency_id, user_id, full_name, grammatical_gender, professional_title,
    photo_path, photo_alt, licence_number, licence_types, licence_regulator,
    has_institutional_affiliation, affiliations, licence_verified_at,
    bio, stats, booking_url, meeting_minutes, review_links
  )
  select (a ->> 'id')::uuid,
         (c ->> 'agency_id')::uuid,
         (select id from auth.users where email = 'dorit@govari-fin.co.il'),
         a ->> 'full_name',
         a ->> 'grammatical_gender',
         a ->> 'professional_title',
         null,
         a ->> 'photo_alt',
         a ->> 'licence_number',
         '{}',
         a ->> 'licence_regulator',
         (a ->> 'has_institutional_affiliation')::boolean,
         '{}',
         now(),
         a -> 'bio',
         a -> 'stats',
         null,
         (a ->> 'meeting_minutes')::integer,
         a -> 'review_links';

  -- 2. the success cases, published, bound to the agent
  insert into public.success_cases (id, agency_id, agent_id, sort_order, tag, title, body, metric, metric_is_estimate, published)
  select s.id, (c ->> 'agency_id')::uuid, (a ->> 'id')::uuid, s.sort_order, s.tag, s.title, s.body, s.metric,
         s.metric_is_estimate, true
    from jsonb_to_recordset(c -> 'success_cases')
      as s(id uuid, sort_order integer, tag text, title text, body text, metric text, metric_is_estimate boolean);

  -- 3. LAST: the profile, so nothing after it moves consent_version
  update public.agency_profiles
     set notify_emails = array(select jsonb_array_elements_text(c #> '{profile,notify_emails}')),
         domain = c #>> '{profile,domain}',
         disclosures_approved_at = now(),
         disclosures_approved_by = null,
         consent_version = c #>> '{profile,consent_version}'
   where agency_id = (c ->> 'agency_id')::uuid;

  -- 4. refuse a half-seed
  if (select consent_version from public.agency_profiles where agency_id = (c ->> 'agency_id')::uuid)
       is distinct from c #>> '{profile,consent_version}'
     or not exists (select 1 from public.public_agent_cards where id = (a ->> 'id')::uuid) then
    raise exception 'agency 1 seed did not land as written';
  end if;
end
$seed$;
