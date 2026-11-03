import { useEffect } from "react";
import { track } from "./analytics";
import * as Tabs from "@radix-ui/react-tabs";
import type { Scorecard as Card } from "./types";
import { practicePlan } from "../src/practice-plan.js";
import { Icon } from "./ui";
const Disclosure = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <details>
    <summary>
      <span>{title}</span>
      <Icon name="chevron" />
    </summary>
    {children}
  </details>
);
export default function Scorecard({ card }: { card: Card }) {
  useEffect(() => { track("scorecard_viewed"); }, []);
  const scores = card.scores.filter(s => Number.isFinite(s.score));
  const average = scores.length ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length : null;
  return (
    <div className="score-review">
      <div className="score-verdict">
        <div className="score-overview">
          <div><h3>{card.verdict[0].toUpperCase() + card.verdict.slice(1)}</h3></div>
          {average !== null && <div className="score-total" aria-label={`Average criterion score: ${average.toFixed(1)} out of 10`}>
            <div><strong>{Number(average.toFixed(1))}</strong><span>/10</span></div>
            <small>Average score</small>
          </div>}
        </div>
        <p>{card.reason}</p>
      </div>
      <Tabs.Root defaultValue="scores" className="score-sections">
        <Tabs.List className="score-section-tabs" aria-label="Scorecard sections">
          <Tabs.Trigger value="scores">Score</Tabs.Trigger>
          <Tabs.Trigger value="suggestions">Suggestions</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="scores">
      <section className="score-rubric" aria-label="Scores">
        {card.scores.map((s) => (
          <div className="score-row" key={s.criterion}>
            <div className="score-row-heading">
              <span className="score-label">
                {s.criterion.replaceAll("_", " ")}
              </span>
              <strong>{s.score}/10</strong>
            </div>
            <meter
              min={0}
              max={10}
              value={s.score}
              aria-label={s.criterion.replaceAll("_", " ")}
            />
            {s.quote && (
              <Disclosure title="Evidence">
                <blockquote>{s.quote}</blockquote>
              </Disclosure>
            )}
          </div>
        ))}
      </section>
        </Tabs.Content>
        <Tabs.Content value="suggestions">
      <section className="practice-plan">
        {practicePlan(card).map(
          (a: {
            priority: number;
            title: string;
            drill: string;
            success: string;
            evidence?: string;
          }) => (
            <article className="practice-action" key={a.priority}>
              <h4>
                {a.priority}. {a.title}
              </h4>
              <p>{a.drill}</p>
              <p className="practice-success">Aim for: {a.success}</p>
              {a.evidence && (
                <Disclosure title="Supporting quote">
                  <blockquote>{a.evidence}</blockquote>
                </Disclosure>
              )}
            </article>
          ),
        )}
      </section>
      {!!card.weakest_answers.length && (
        <h4 className="score-section-title">Answers to improve</h4>
      )}
      {card.weakest_answers.map((a, i) => (
        <article className="answer-review" key={i}>
          <span className="eyebrow">
            {Math.floor(a.timestamp_seconds / 60)}:
            {String(Math.floor(a.timestamp_seconds) % 60).padStart(2, "0")}
          </span>
          <blockquote>{a.quote}</blockquote>
          <p>{a.why_weak}</p>
          <Disclosure title="Suggested answer">
            <p>{a.better_answer}</p>
          </Disclosure>
        </article>
      ))}
        </Tabs.Content>
      </Tabs.Root>
      {(
        [
          ["Fact checks", card.fact_mismatches],
          ["Limitations", card.limitations],
        ] as const
      ).map(
        ([title, items]) =>
          !!items.length && (
            <section className="score-footnote" key={title}>
              <h4>{title}</h4>
              {items.map((text, i) => (
                <p key={i}>{text}</p>
              ))}
            </section>
          ),
      )}
    </div>
  );
}
