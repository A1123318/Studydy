import type { ReactNode } from "react";
import "./styles.css";

export function StudyGuide({ title, message, mood = "guide", step, action }: {
  title: string;
  message: string;
  mood?: "guide" | "welcome" | "encourage" | "thinking";
  step?: "read" | "practice" | "next";
  action?: ReactNode;
}) {
  const image = {
    guide: "learning-guide", welcome: "welcome-wave",
    encourage: "success-jump", thinking: "processing-laptop",
  }[mood];
  return <aside className={`study-guide is-${mood}`} aria-label="Studydy 學習引導">
    <img className="study-guide__character" src={`/assets/studydy/${image}.png`} alt="" />
    <div className="study-guide__copy">
      <span className="study-guide__name">Studydy 陪你學</span>
      <h2>{title}</h2>
      <p>{message}</p>
      {step && <ol className="study-guide__steps" aria-label="學習步驟">
        {([["read", "閱讀重點"], ["practice", "理解練習"], ["next", "接著學習"]] as const).map(([id, label], index) =>
          <li key={id} aria-current={step === id ? "step" : undefined}><span>{index + 1}</span>{label}</li>)}
      </ol>}
    </div>
    {action && <div className="study-guide__action">{action}</div>}
  </aside>;
}
