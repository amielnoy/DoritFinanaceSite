/**
 * The site's glossary: a one- or two-sentence definition of each basic term a
 * visitor meets in the copy, shown as a tooltip on the term itself
 * (`<Glossed>` → `<Term>`).
 *
 * Each entry is written once per language. `match` lists the forms the term
 * takes in running text — longest first is not required, `glossSegments`
 * sorts them — and Hebrew forms also match with a prefix letter attached
 * (ב, ה, ו, ל, מ, ש, כ), so "בקרן השתלמות" finds "קרן השתלמות".
 *
 * The rules that bind the rest of the copy bind this file too (§2 of the
 * compliance block): every definition is descriptive. No figure that changes
 * by year, no "saves you", no comparison between institutions, no product
 * recommendation. A definition explains the word; it never advises.
 * `tests/unit/glossary.test.ts` holds the three languages to the same entries.
 */

export interface GlossaryText {
  /** The heading inside the tooltip. */
  title: string;
  /** The definition: short, plain, descriptive. */
  def: string;
  /** The forms that link to this entry in running text. */
  match: string[];
}

export interface GlossaryEntry {
  id: string;
  he: GlossaryText;
  en: GlossaryText;
  fr: GlossaryText;
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    id: "pension-fund",
    he: {
      title: "קרן פנסיה",
      def: "חיסכון לגיל פרישה שמשלם קצבה חודשית לכל החיים, ובדרך כלל כולל גם ביטוח למקרה של נכות ולמשפחה במקרה של פטירה (שאירים).",
      match: ["קרן פנסיה", "קרנות פנסיה", "קרן הפנסיה", "קרנות הפנסיה", "פנסיה"],
    },
    en: {
      title: "Pension fund (Keren Pensia)",
      def: "Retirement savings that pay a monthly annuity for life, usually with built-in disability cover and cover for the family if the saver dies (survivors).",
      match: ["pension fund", "pension"],
    },
    fr: {
      title: "Fonds de pension (Keren Pensia)",
      def: "Épargne retraite qui verse une rente mensuelle à vie, avec en général une couverture invalidité et une couverture pour la famille en cas de décès (survivants).",
      match: ["fonds de pension", "pension"],
    },
  },
  {
    id: "provident-fund",
    he: {
      title: "קופת גמל",
      def: "מוצר חיסכון ארוך טווח עם הטבות מס. הכסף נצבר בחשבון אישי על שמכם ומושקע לפי מסלול ההשקעה שבחרתם.",
      match: ["קופת גמל", "קופות גמל", "קופת הגמל", "קופות הגמל", "גמל"],
    },
    en: {
      title: "Provident fund (Kupat Gemel)",
      def: "Long-term savings with tax benefits. The money builds up in a personal account in your name and is invested according to the track you choose.",
      match: ["provident fund", "provident"],
    },
    fr: {
      title: "Caisse de prévoyance (Kupat Gemel)",
      def: "Épargne à long terme avec avantages fiscaux. L'argent s'accumule sur un compte personnel à votre nom et est investi selon le parcours choisi.",
      match: ["caisse de prévoyance", "caisses de prévoyance"],
    },
  },
  {
    id: "gemel-invest",
    he: {
      title: "קופת גמל להשקעה",
      def: "חיסכון גמיש: אפשר למשוך ממנו בכל עת (בתשלום מס רווח הון), או להשאיר עד גיל 60 ולמשוך כקצבה בפטור ממס.",
      match: ["קופת גמל להשקעה", "גמל להשקעה"],
    },
    en: {
      title: "Investment provident fund (Gemel LeHashkaa)",
      def: "Flexible savings: you can withdraw at any time (paying capital gains tax), or keep it until 60 and draw it as a tax-free annuity.",
      match: ["investment provident fund"],
    },
    fr: {
      title: "Caisse de prévoyance d'investissement (Gemel LeHashkaa)",
      def: "Épargne souple : on peut retirer à tout moment (en payant l'impôt sur la plus-value), ou attendre 60 ans et la percevoir en rente exonérée d'impôt.",
      match: ["caisse de prévoyance d'investissement"],
    },
  },
  {
    id: "study-fund",
    he: {
      title: "קרן השתלמות",
      def: "חיסכון לטווח בינוני עם הטבות מס. הכסף נזיל בדרך כלל אחרי שש שנים (או שלוש, למטרת לימודים), והרווחים פטורים ממס רווח הון עד תקרת ההפקדה.",
      match: ["קרן השתלמות", "קרנות השתלמות", "קרן ההשתלמות", "קרנות ההשתלמות"],
    },
    en: {
      title: "Study fund (Keren Hishtalmut)",
      def: "Medium-term savings with tax benefits. The money usually becomes available after six years (three, for studies), and gains are free of capital gains tax up to the deposit ceiling.",
      match: ["study fund", "study-fund", "keren hishtalmut"],
    },
    fr: {
      title: "Fonds de formation (Keren Hishtalmut)",
      def: "Épargne à moyen terme avec avantages fiscaux. L'argent est en général disponible après six ans (trois, pour des études), et les gains sont exonérés d'impôt sur la plus-value jusqu'au plafond de versement.",
      match: ["fonds de formation", "keren hishtalmut"],
    },
  },
  {
    id: "managers-insurance",
    he: {
      title: "ביטוח מנהלים",
      def: "פוליסת חיסכון לפנסיה שמנוהלת בחברת ביטוח, ויכולה לכלול כיסויי ביטוח לפי בחירה. בפוליסות ותיקות יש לעיתים מקדם קצבה מובטח.",
      match: ["ביטוח מנהלים", "ביטוחי מנהלים", "ביטוח המנהלים"],
    },
    en: {
      title: "Executive insurance (Bituach Menahalim)",
      def: "A pension savings policy run by an insurance company, which can include insurance cover of your choice. Older policies sometimes carry a guaranteed annuity factor.",
      match: ["executive insurance", "managers' insurance"],
    },
    fr: {
      title: "Assurance cadre (Bituach Menahalim)",
      def: "Police d'épargne retraite gérée par une compagnie d'assurance, qui peut inclure des couvertures au choix. Les polices anciennes ont parfois un coefficient de rente garanti.",
      match: ["assurance cadre", "assurances cadres"],
    },
  },
  {
    id: "management-fees",
    he: {
      title: "דמי ניהול",
      def: "העמלה שגוף החיסכון גובה על ניהול הכסף: אחוז מכל הפקדה חודשית ו/או אחוז מהצבירה. הפרש קטן באחוזים מצטבר לאורך שנים.",
      match: ["דמי ניהול", "דמי הניהול"],
    },
    en: {
      title: "Management fees (Dmei Nihul)",
      def: "What the savings provider charges for managing the money: a percentage of each monthly deposit and/or of the balance. A small difference in percent adds up over the years.",
      match: ["management fees", "management fee"],
    },
    fr: {
      title: "Frais de gestion (Dmei Nihul)",
      def: "Ce que l'organisme prélève pour gérer l'argent : un pourcentage de chaque versement mensuel et/ou du solde accumulé. Un petit écart de pourcentage s'accumule au fil des années.",
      match: ["frais de gestion"],
    },
  },
  {
    id: "investment-track",
    he: {
      title: "מסלול השקעה",
      def: "האופן שבו הכסף בקופה מושקע — למשל מסלול מנייתי, אג״חי, כללי או מסלול שמותאם לגיל. לכל מסלול רמת סיכון אחרת.",
      match: ["מסלול השקעה", "מסלולי השקעה", "מסלול ההשקעה", "מסלולי ההשקעה"],
    },
    en: {
      title: "Investment track (Maslul Hashkaa)",
      def: "How the money in the fund is invested — for example equities, bonds, a general mix, or a track matched to your age. Each track carries a different level of risk.",
      match: ["investment track"],
    },
    fr: {
      title: "Parcours d'investissement (Maslul Hashkaa)",
      def: "La façon dont l'argent du fonds est investi — par exemple en actions, en obligations, en mix général, ou selon l'âge. Chaque parcours a un niveau de risque différent.",
      match: ["parcours d'investissement", "parcours de placement"],
    },
  },
  {
    id: "har-habituach",
    he: {
      title: "הר הביטוח",
      def: "מאגר ממשלתי של רשות שוק ההון, שבו אפשר לראות במקום אחד את כל פוליסות הביטוח הפעילות על שמכם.",
      match: ["הר הביטוח", "הר-הביטוח"],
    },
    en: {
      title: "Har HaBituach",
      def: "A government database run by the Capital Market Authority that shows, in one place, every active insurance policy in your name.",
      match: ["har habituach", "har ha-bituach"],
    },
    fr: {
      title: "Har HaBituach",
      def: "Base de données publique de l'Autorité des marchés de capitaux qui affiche, en un seul endroit, toutes les polices d'assurance actives à votre nom.",
      match: ["har habituach", "har ha-bituach"],
    },
  },
  {
    id: "clearinghouse",
    he: {
      title: "המסלקה הפנסיונית",
      def: "מערכת מרכזית בפיקוח רשות שוק ההון, שמרכזת את המידע על כל חשבונות הפנסיה, הגמל וההשתלמות שלכם, מכל הגופים, במקום אחד.",
      match: ["המסלקה הפנסיונית", "מסלקה הפנסיונית", "מסלקה פנסיונית", "מסלקה"],
    },
    en: {
      title: "Pension clearinghouse (HaMaslaka)",
      def: "A central system, supervised by the Capital Market Authority, that gathers in one place the details of all your pension, provident and study-fund accounts, across every provider.",
      match: ["pension clearinghouse", "clearinghouse"],
    },
    fr: {
      title: "Chambre de compensation (HaMaslaka)",
      def: "Système central, placé sous la supervision de l'Autorité des marchés de capitaux, qui rassemble en un seul endroit les informations de tous vos comptes de pension, de prévoyance et de formation, tous organismes confondus.",
      match: ["chambre de compensation"],
    },
  },
  {
    id: "life-insurance",
    he: {
      title: "ביטוח חיים",
      def: "ביטוח שמשלם סכום כסף למוטבים — בדרך כלל המשפחה — אם המבוטח נפטר במהלך תקופת הביטוח.",
      match: ["ביטוח חיים", "ביטוחי חיים", "ביטוח החיים"],
    },
    en: {
      title: "Life insurance",
      def: "Insurance that pays a sum to the beneficiaries — usually the family — if the insured person dies during the policy term.",
      match: ["life insurance", "life cover"],
    },
    fr: {
      title: "Assurance vie",
      def: "Assurance qui verse une somme aux bénéficiaires — en général la famille — si l'assuré décède pendant la durée du contrat.",
      match: ["assurance vie", "assurance-vie", "assurances vie"],
    },
  },
  {
    id: "health-insurance",
    he: {
      title: "ביטוח בריאות",
      def: "ביטוח פרטי שמשלים את סל הבריאות הציבורי — למשל ניתוחים, תרופות שאינן בסל והתייעצויות עם רופאים מומחים.",
      match: ["ביטוח בריאות", "ביטוחי בריאות", "ביטוח הבריאות"],
    },
    en: {
      title: "Health insurance",
      def: "Private insurance that supplements the public health basket — for example surgery, medicines outside the basket and specialist consultations.",
      match: ["health insurance"],
    },
    fr: {
      title: "Assurance santé",
      def: "Assurance privée qui complète le panier de santé public — par exemple chirurgie, médicaments hors panier et consultations de spécialistes.",
      match: ["assurance santé", "assurances santé"],
    },
  },
  {
    id: "disability",
    he: {
      title: "אובדן כושר עבודה",
      def: "ביטוח שמשלם הכנסה חודשית אם מחלה או תאונה מונעות מכם לעבוד לתקופה ממושכת.",
      match: ["אובדן כושר עבודה", "אובדן כושר העבודה", "אובדן כושר"],
    },
    en: {
      title: "Disability / loss of earning capacity",
      def: "Insurance that pays a monthly income if illness or an accident keeps you from working for a long period.",
      match: ["disability cover", "disability insurance", "loss of earning capacity", "disability"],
    },
    fr: {
      title: "Incapacité de travail",
      def: "Assurance qui verse un revenu mensuel si une maladie ou un accident vous empêche de travailler pendant une longue période.",
      match: ["incapacité de travail"],
    },
  },
  {
    id: "critical-illness",
    he: {
      title: "ביטוח מחלות קשות",
      def: "ביטוח שמשלם סכום חד-פעמי עם אבחון של מחלה קשה שמוגדרת בפוליסה, כמו סרטן, התקף לב או שבץ.",
      match: ["ביטוח מחלות קשות", "מחלות קשות"],
    },
    en: {
      title: "Critical illness insurance",
      def: "Insurance that pays a lump sum on diagnosis of a serious illness defined in the policy, such as cancer, a heart attack or a stroke.",
      match: ["critical illness insurance", "critical illness"],
    },
    fr: {
      title: "Assurance maladies graves",
      def: "Assurance qui verse une somme forfaitaire lors du diagnostic d'une maladie grave définie au contrat, comme un cancer, un infarctus ou un AVC.",
      match: ["maladies graves"],
    },
  },
  {
    id: "long-term-care",
    he: {
      title: "ביטוח סיעודי",
      def: "ביטוח שמשלם סכום חודשי אם המבוטח זקוק לעזרה בפעולות יום-יומיות, כמו לקום, להתלבש, להתרחץ או לאכול.",
      match: ["ביטוח סיעודי", "ביטוחי סיעוד", "ביטוח סיעוד"],
    },
    en: {
      title: "Long-term care insurance",
      def: "Insurance that pays a monthly sum if the insured person needs help with everyday activities such as getting up, dressing, washing or eating.",
      match: ["long-term care insurance", "long-term care"],
    },
    fr: {
      title: "Assurance dépendance",
      def: "Assurance qui verse une somme mensuelle si l'assuré a besoin d'aide pour les gestes du quotidien : se lever, s'habiller, se laver ou manger.",
      match: ["assurance dépendance"],
    },
  },
  {
    id: "double-insurance",
    he: {
      title: "כפל ביטוח",
      def: "מצב שבו יש לכם שתי פוליסות או יותר שמכסות את אותו הדבר — ולפעמים משלמים פעמיים על כיסוי שבפועל ישולם רק פעם אחת.",
      match: ["כפל ביטוח", "כפלי ביטוח", "כפל ביטוחי", "כפלים"],
    },
    en: {
      title: "Double insurance",
      def: "Two or more policies covering the same thing — sometimes paying twice for cover that would in practice pay out only once.",
      match: ["double insurance", "duplicate cover", "duplicate policies", "duplicates"],
    },
    fr: {
      title: "Double assurance",
      def: "Deux polices ou plus qui couvrent la même chose — on paie parfois deux fois pour une couverture qui, en pratique, ne versera qu'une seule fois.",
      match: ["double assurance", "doublons", "doublon"],
    },
  },
  {
    id: "annuity",
    he: {
      title: "קצבה",
      def: "תשלום חודשי שמקבלים מהחיסכון הפנסיוני מגיל הפרישה, בדרך כלל לכל החיים.",
      match: ["קצבה חודשית", "קצבה", "קצבאות"],
    },
    en: {
      title: "Annuity (Kitzba)",
      def: "A monthly payment drawn from pension savings from retirement age, usually for life.",
      match: ["annuity", "annuities"],
    },
    fr: {
      title: "Rente (Kitzba)",
      def: "Versement mensuel perçu sur l'épargne retraite à partir de l'âge de la retraite, en général à vie.",
      match: ["rente", "rentes"],
    },
  },
  {
    id: "annuity-factor",
    he: {
      title: "מקדם קצבה",
      def: "המספר שבו מחלקים את הצבירה כדי לחשב את הקצבה החודשית. ככל שהמקדם נמוך יותר — הקצבה גבוהה יותר.",
      match: ["מקדם קצבה", "מקדם המרה", "מקדם הקצבה"],
    },
    en: {
      title: "Annuity factor",
      def: "The number the balance is divided by to work out the monthly annuity. The lower the factor, the higher the annuity.",
      match: ["annuity factor", "conversion factor"],
    },
    fr: {
      title: "Coefficient de rente",
      def: "Le nombre par lequel on divise le solde pour calculer la rente mensuelle. Plus le coefficient est bas, plus la rente est élevée.",
      match: ["coefficient de rente", "coefficient de conversion"],
    },
  },
  {
    id: "balance",
    he: {
      title: "צבירה",
      def: "סך הכסף שנצבר בחשבון החיסכון עד היום — ההפקדות יחד עם הרווחים, אחרי דמי ניהול.",
      match: ["צבירה", "הצבירה", "צבירות"],
    },
    en: {
      title: "Accumulated balance (Tzvira)",
      def: "The total in the savings account to date — deposits plus returns, after management fees.",
      match: ["accumulated balance", "accumulated savings"],
    },
    fr: {
      title: "Épargne accumulée (Tzvira)",
      def: "Le total du compte d'épargne à ce jour — les versements plus les rendements, après frais de gestion.",
      match: ["épargne accumulée", "solde accumulé"],
    },
  },
  {
    id: "deposits",
    he: {
      title: "הפקדות",
      def: "הסכומים שמועברים לחיסכון מדי חודש — מהשכר של העובד, מהמעסיק (תגמולים ופיצויים), או ישירות על ידי עצמאי.",
      match: ["הפקדות", "הפקדה חודשית"],
    },
    en: {
      title: "Deposits",
      def: "The amounts paid into savings each month — from the employee's salary, from the employer (contributions and severance), or directly by a self-employed person.",
      match: ["deposits"],
    },
    fr: {
      title: "Cotisations / versements",
      def: "Les sommes versées chaque mois à l'épargne — prélevées sur le salaire, payées par l'employeur (cotisations et indemnités), ou directement par un indépendant.",
      match: ["cotisations", "versements"],
    },
  },
  {
    id: "return",
    he: {
      title: "תשואה",
      def: "הרווח (או ההפסד) על הכסף המושקע, באחוזים. תשואת עבר אינה מבטיחה תשואה בעתיד.",
      match: ["תשואה", "תשואות", "התשואה", "התשואות"],
    },
    en: {
      title: "Return",
      def: "The gain (or loss) on the money invested, in percent. Past returns do not guarantee future returns.",
      match: ["returns", "return on"],
    },
    fr: {
      title: "Rendement",
      def: "Le gain (ou la perte) sur l'argent investi, en pourcentage. Les rendements passés ne garantissent pas les rendements futurs.",
      match: ["rendement", "rendements"],
    },
  },
  {
    id: "transfer",
    he: {
      title: "ניוד",
      def: "העברת כסף מקופה אחת לאחרת, או מגוף לגוף, בלי למשוך אותו ובלי לשלם עליו מס.",
      match: ["ניוד", "הניוד", "לנייד", "ניודים"],
    },
    en: {
      title: "Transfer (Nayud)",
      def: "Moving money from one fund or provider to another without withdrawing it and without paying tax on it.",
      match: ["fund transfer", "transferring funds"],
    },
    fr: {
      title: "Transfert (Nayud)",
      def: "Faire passer l'argent d'un fonds ou d'un organisme à un autre, sans le retirer et sans payer d'impôt dessus.",
      match: ["transfert", "transferts"],
    },
  },
  {
    id: "severance",
    he: {
      title: "פיצויים",
      def: "הכסף שהמעסיק מפקיד לחיסכון הפנסיוני לטובת פיצויי פיטורים. משיכתו לפני הפרישה עלולה להקטין את הקצבה ולחייב במס.",
      match: ["כספי פיצויים", "פיצויי פיטורים", "פיצויים"],
    },
    en: {
      title: "Severance (Pitzuim)",
      def: "Money the employer deposits into the pension savings towards severance pay. Withdrawing it before retirement can reduce the annuity and be taxed.",
      match: ["severance pay", "severance"],
    },
    fr: {
      title: "Indemnités de licenciement (Pitzuim)",
      def: "L'argent que l'employeur verse à l'épargne retraite au titre des indemnités de licenciement. Le retirer avant la retraite peut réduire la rente et être imposé.",
      match: ["indemnités de licenciement"],
    },
  },
  {
    id: "survivors",
    he: {
      title: "שאירים",
      def: "הכיסוי בקרן הפנסיה שמשלם קצבה לבן או לבת הזוג ולילדים אם החוסך נפטר.",
      match: ["ביטוח שאירים", "פנסיית שאירים", "שאירים"],
    },
    en: {
      title: "Survivors' cover",
      def: "The cover in a pension fund that pays an annuity to the spouse and children if the saver dies.",
      match: ["survivors' cover", "survivors' pension", "survivors"],
    },
    fr: {
      title: "Couverture survivants",
      def: "La couverture du fonds de pension qui verse une rente au conjoint et aux enfants si l'épargnant décède.",
      match: ["couverture survivants", "pension de survivants", "survivants"],
    },
  },
  {
    id: "beneficiaries",
    he: {
      title: "מוטבים",
      def: "האנשים שקבעתם שיקבלו את הכסף מהחיסכון או מהביטוח אם תלכו לעולמכם.",
      match: ["מוטבים", "המוטבים", "מוטב"],
    },
    en: {
      title: "Beneficiaries",
      def: "The people you name to receive the money from your savings or insurance if you die.",
      match: ["beneficiaries", "beneficiary"],
    },
    fr: {
      title: "Bénéficiaires",
      def: "Les personnes que vous désignez pour recevoir l'argent de votre épargne ou de votre assurance en cas de décès.",
      match: ["bénéficiaires", "bénéficiaire"],
    },
  },
  {
    id: "tax-refund",
    he: {
      title: "החזר מס",
      def: "כסף שמגיע לכם בחזרה מרשות המסים כששילמתם יותר מס ממה שנדרש — למשל בגלל נקודות זיכוי שלא נוצלו או החלפת עבודה באמצע השנה.",
      match: ["החזר מס", "החזרי מס", "החזר המס"],
    },
    en: {
      title: "Tax refund",
      def: "Money owed back to you by the Tax Authority when you paid more tax than required — for example unused credit points or a change of job mid-year.",
      match: ["tax refund", "tax refunds"],
    },
    fr: {
      title: "Remboursement d'impôt",
      def: "L'argent que l'administration fiscale vous doit quand vous avez payé plus d'impôt que nécessaire — par exemple des points de crédit non utilisés ou un changement d'emploi en cours d'année.",
      match: ["remboursement d'impôt", "remboursements d'impôt"],
    },
  },
  {
    id: "credit-points",
    he: {
      title: "נקודות זיכוי",
      def: "הנחה במס ההכנסה החודשי. לכל תושב יש נקודות בסיס, ויש נקודות נוספות — למשל על ילדים, תואר אקדמי או עלייה.",
      match: ["נקודות זיכוי", "נקודות הזיכוי", "נקודת זיכוי"],
    },
    en: {
      title: "Tax credit points",
      def: "A reduction in monthly income tax. Every resident has basic points, with extra points for example for children, an academic degree or immigration.",
      match: ["tax credit points", "credit points"],
    },
    fr: {
      title: "Points de crédit d'impôt",
      def: "Une réduction de l'impôt sur le revenu mensuel. Chaque résident a des points de base, et des points supplémentaires par exemple pour les enfants, un diplôme ou l'alyah.",
      match: ["points de crédit d'impôt", "points de crédit"],
    },
  },
  {
    id: "amendment-190",
    he: {
      title: "תיקון 190",
      def: "הסדר מס שמאפשר לחוסכים מגיל 60 שכבר מובטחת להם קצבה מינימלית להפקיד לקופת גמל, ולמשוך את הכסף כקצבה פטורה ממס או כסכום חד-פעמי במס מופחת.",
      match: ["תיקון 190"],
    },
    en: {
      title: "Amendment 190",
      def: "A tax arrangement that lets savers aged 60 and over who already have a minimum pension deposit into a provident fund, and draw it as a tax-free annuity or as a lump sum at a reduced tax rate.",
      match: ["amendment 190"],
    },
    fr: {
      title: "Amendement 190",
      def: "Un régime fiscal qui permet aux épargnants de 60 ans et plus disposant déjà d'une rente minimale de verser sur une caisse de prévoyance, puis de percevoir l'argent en rente exonérée ou en capital à taux réduit.",
      match: ["amendement 190"],
    },
  },
  {
    id: "capital-gains-tax",
    he: {
      title: "מס רווח הון",
      def: "מס על הרווח שנוצר מהשקעה — ההפרש בין הסכום שהושקע לבין הסכום שנמשך.",
      match: ["מס רווח הון", "מס רווחי הון", "רווח הון"],
    },
    en: {
      title: "Capital gains tax",
      def: "Tax on the profit made from an investment — the difference between what was invested and what was withdrawn.",
      match: ["capital gains tax", "capital gains"],
    },
    fr: {
      title: "Impôt sur la plus-value",
      def: "L'impôt sur le gain réalisé par un placement — la différence entre la somme investie et la somme retirée.",
      match: ["impôt sur la plus-value", "plus-value", "plus-values"],
    },
  },
  {
    id: "child-savings",
    he: {
      title: "חיסכון לכל ילד",
      def: "תוכנית שבה המדינה מפקידה מדי חודש סכום לחיסכון על שם כל ילד, וההורים יכולים להוסיף הפקדה משלהם.",
      match: ["חיסכון לכל ילד"],
    },
    en: {
      title: "Savings for Every Child",
      def: "A programme in which the state deposits a monthly sum into savings in each child's name, and parents can add a deposit of their own.",
      match: ["savings for every child"],
    },
    fr: {
      title: "Épargne pour chaque enfant",
      def: "Un programme dans lequel l'État verse chaque mois une somme sur une épargne au nom de chaque enfant, et les parents peuvent y ajouter leur propre versement.",
      match: ["épargne pour chaque enfant"],
    },
  },
  {
    id: "form-106",
    he: {
      title: "טופס 106",
      def: "סיכום שנתי שהמעסיק נותן לכל עובד: השכר, המס שנוכה וההפקדות לפנסיה במהלך השנה.",
      match: ["טופס 106", "טפסי 106"],
    },
    en: {
      title: "Form 106",
      def: "The annual summary an employer gives each employee: salary, tax withheld and pension deposits over the year.",
      match: ["form 106"],
    },
    fr: {
      title: "Formulaire 106",
      def: "Le récapitulatif annuel que l'employeur remet à chaque salarié : salaire, impôt prélevé et cotisations retraite de l'année.",
      match: ["formulaire 106"],
    },
  },
  {
    id: "form-101",
    he: {
      title: "טופס 101",
      def: "הטופס שממלאים אצל המעסיק בתחילת עבודה ובכל שנה, ולפיו נקבעים נקודות הזיכוי וגובה המס שמנוכה מהשכר.",
      match: ["טופס 101", "טפסי 101"],
    },
    en: {
      title: "Form 101",
      def: "The form filled in with the employer when starting a job and every year, which sets your credit points and how much tax is withheld from your salary.",
      match: ["form 101"],
    },
    fr: {
      title: "Formulaire 101",
      def: "Le formulaire rempli chez l'employeur à l'embauche puis chaque année, qui fixe vos points de crédit et l'impôt prélevé sur votre salaire.",
      match: ["formulaire 101"],
    },
  },
  {
    id: "commutation",
    he: {
      title: "היוון",
      def: "המרה של חלק מהקצבה החודשית לסכום חד-פעמי שמקבלים מראש, על חשבון קצבה נמוכה יותר.",
      match: ["היוון", "היוון קצבה", "להוון"],
    },
    en: {
      title: "Commutation (Hivun)",
      def: "Converting part of the monthly annuity into a lump sum paid up front, in exchange for a lower annuity.",
      match: ["commutation"],
    },
    fr: {
      title: "Capitalisation (Hivun)",
      def: "Convertir une partie de la rente mensuelle en une somme forfaitaire versée d'avance, en contrepartie d'une rente plus faible.",
      match: ["capitalisation de rente", "capitalisation"],
    },
  },
];

/** The entry for an id, or undefined. */
export const glossaryEntry = (id: string): GlossaryEntry | undefined => GLOSSARY.find((e) => e.id === id);

