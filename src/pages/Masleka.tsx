import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import MaslekaSteps, { type MaslekaStep, type StepScreens } from "@/components/masleka/MaslekaSteps";
import { CLEARINGHOUSE_SAVER_URL, MASLEKA_ENABLED } from "@/config/masleka";
import { normalizeIsraeliId } from "@/lib/israeli-id";
import { clientMessage, isPlausibleCode, readTokenFromHash } from "@/lib/masleka";
import { services } from "@/services";
import Glossed from "@/components/dorit/primitives/Glossed";

/**
 * /masleka — where a client hands over the clearinghouse power-of-attorney
 * code and their ID number, from the personal link in their mail.
 *
 * The token travels in the fragment (`#t=…`) and is taken out of the address
 * bar on the first render, so it stays out of history, screenshots and
 * anything that later reads `location`. Nothing is sent until both values
 * pass the same checks the function makes; after a successful send the page
 * says thank you and nothing else, and the values are cleared. Neither value
 * is written to storage, the console or analytics.
 *
 * Dark until VITE_MASLEKA_ENABLED: then it only says the service is not
 * available, and never posts. Every failure is worded by `clientMessage`.
 */
export interface MaslekaPageProps {
  enabled?: boolean;
  submit?: (token: string, code: string, idNumber: string) => Promise<void>;
  /** Optional screenshots for the three steps; none ship today. */
  screenshots?: StepScreens;
}

const BAD_ID = "מספר תעודת הזהות אינו תקין. בדקו את הספרות ונסו שוב.";
const BAD_CODE = "הקוד אינו נראה תקין. העתיקו אותו שוב מאתר המסלקה.";

const STEPS: MaslekaStep[] = [
  {
    title: "נרשמים לאתר המסלקה הפנסיונית",
    body: (
      <>
        ההרשמה ללא עלות.{" "}
        <a href={CLEARINGHOUSE_SAVER_URL} target="_blank" rel="noopener noreferrer" className="underline text-accent">
          לאתר המסלקה
        </a>
      </>
    ),
  },
  {
    title: "מפיקים קוד אימות",
    body: <>באזור האישי באתר המסלקה לוחצים על „הפקת קוד אימות” ומעתיקים את הקוד שמתקבל.</>,
  },
  {
    title: "מדביקים כאן את הקוד ואת מספר הזהות",
    body: <>ושולחים. דורית תגיש בשמכם את הבקשה במסלקה ותקבל את הנתונים לקראת הפגישה.</>,
  },
];

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card">
        <div className="max-w-[720px] mx-auto px-4 sm:px-6 py-5">
          <Link to="/" className="font-heading text-xl">
            דורית גוב ארי
          </Link>
          <p className="text-sm text-muted-foreground mt-1">מתכננת פיננסית וסוכנת ביטוח</p>
        </div>
      </header>
      <main id="main" className="max-w-[720px] mx-auto px-4 sm:px-6 py-8">{children}</main>
    </div>
  );
}

export default function Masleka({
  enabled = MASLEKA_ENABLED,
  submit = (token, code, idNumber) => services.masleka.submitCode(token, code, idNumber),
  screenshots,
}: MaslekaPageProps) {
  const [token] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readTokenFromHash(window.location.hash),
  );
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
  }, []);
  const [code, setCode] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [phase, setPhase] = useState<"form" | "sending" | "done">("form");
  const [error, setError] = useState<string | null>(null);

  if (!enabled) {
    return (
      <Shell>
        <h1 className="font-heading text-2xl md:text-3xl">השירות אינו זמין כרגע</h1>
        <p className="mt-4 text-muted-foreground">אפשר להשיב למייל שקיבלתם, ודורית תחזור אליכם.</p>
        <Link to="/" className="inline-block mt-6 underline text-accent">
          חזרה לאתר
        </Link>
      </Shell>
    );
  }

  if (phase === "done") {
    return (
      <Shell>
        <h1 className="font-heading text-2xl md:text-3xl">תודה — דורית תטפל בזה</h1>
      </Shell>
    );
  }

  if (!token) {
    return (
      <Shell>
        <h1 className="font-heading text-2xl md:text-3xl">הקישור חסר או שגוי</h1>
        <p className="mt-4 text-muted-foreground">פתחו את הקישור מהמייל שקיבלתם, כפי שהוא.</p>
      </Shell>
    );
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const id = normalizeIsraeliId(idNumber);
    if (!id) {
      setError(BAD_ID);
      return;
    }
    const trimmed = code.trim();
    if (!isPlausibleCode(trimmed)) {
      setError(BAD_CODE);
      return;
    }
    setPhase("sending");
    try {
      await submit(token, trimmed, id);
      setCode("");
      setIdNumber("");
      setPhase("done");
    } catch (e) {
      setPhase("form");
      setError(clientMessage(e).text);
    }
  };

  return (
    <Shell>
      <h1 className="font-heading text-2xl md:text-3xl">מסירת קוד המסלקה</h1>
      <p className="mt-4 text-muted-foreground leading-relaxed">
        <Glossed text="כדי שדורית תוכל להכין לפגישה תמונה מלאה של הפנסיה, הגמל וההשתלמות שלכם, היא צריכה את אישורכם במסלקה הפנסיונית. שלושה צעדים, כמה דקות:" />
      </p>
      <div className="mt-8">
        <MaslekaSteps steps={STEPS} screenshots={screenshots} />
      </div>
      <form onSubmit={onSubmit} noValidate aria-label="מסירת קוד המסלקה" className="mt-10 space-y-5 border border-border/60 bg-card p-5">
        <div>
          <label htmlFor="masleka-code" className="block text-sm font-medium">
            קוד האימות מאתר המסלקה
          </label>
          <input
            id="masleka-code"
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="mt-2 w-full border border-border bg-background px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="masleka-id" className="block text-sm font-medium">
            מספר תעודת זהות
          </label>
          <input
            id="masleka-id"
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            value={idNumber}
            onChange={(e) => setIdNumber(e.target.value)}
            className="mt-2 w-full border border-border bg-background px-3 py-2"
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={phase === "sending"}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2 disabled:opacity-60"
        >
          {phase === "sending" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
          שליחה
        </button>
        <p className="text-xs text-muted-foreground leading-relaxed">
          הקוד ומספר הזהות נשמרים מוצפנים, משמשים רק להגשת הבקשה במסלקה בשמכם, ונמחקים מיד לאחר ההגשה — ולכל
          המאוחר כעבור 9 ימים. פרטים נוספים ב<Link to="/privacy" className="underline">מדיניות הפרטיות</Link>.
        </p>
      </form>
    </Shell>
  );
}
