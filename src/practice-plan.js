const drills = {
  intro_clarity: [
    "Make the product concrete",
    "Record a 20-second answer: who uses it, what they do with it, and the result. Remove category jargon.",
    "A cofounder can repeat the user, task and benefit after hearing it once.",
  ],
  team_story: [
    "Show why this team",
    "Each founder writes one relevant accomplishment and what they personally built. Choose the strongest example for this company.",
    "A 30-second team answer connects specific past work to the challenge ahead.",
  ],
  slope: [
    "Make progress measurable",
    "List what changed over the last four weeks: shipped work, customer learning and outcomes. Separate plans from completed work.",
    "You can name one dated change, its result, and the next experiment in 30 seconds.",
  ],
  traction_honesty: [
    "Prepare your numbers",
    "Make a one-page metrics sheet with definitions, time windows and sources. Separate active users, pilots, paid customers and revenue.",
    "Every founder gives the same current figures and says explicitly when a figure is unknown.",
  ],
  market_depth: [
    "Explain the customer choice",
    "Pick one real customer problem. Compare the current workaround with your product, including switching cost and your evidence.",
    "Answer “why would they switch?” in 30 seconds without unsupported market-size claims.",
  ],
  chemistry: [
    "Practice clean handoffs",
    "Agree who leads product, customer and technical answers. Rehearse one lead answer followed by one short, non-repeating addition.",
    "No overlapping answers in the next practice. Mixed audio cannot reliably measure individual teamwork.",
  ],
  concision: [
    "Lead with the answer",
    "Redo the longest answer: one direct sentence, one concrete example, then stop. Record it twice and remove the setup.",
    "The answer is under 30 seconds and addresses the actual question in its first sentence.",
  ],
  candor: [
    "Separate facts from hypotheses",
    "Choose a difficult question. State what you know, what remains uncertain, and the next test. Avoid defending an unverified claim.",
    "The listener can distinguish evidence, assumptions and plans without asking again.",
  ],
};
export function practicePlan(card) {
  return [...(card.scores || [])]
    .filter((s) => drills[s.criterion] && Number.isFinite(s.score))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((s, index) => ({
      priority: index + 1,
      criterion: s.criterion,
      title: drills[s.criterion][0],
      drill: drills[s.criterion][1],
      success: drills[s.criterion][2],
      evidence: s.quote || "",
    }));
}
