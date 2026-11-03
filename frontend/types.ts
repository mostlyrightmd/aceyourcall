export type Program = "speedrun-10" | "speedrun-10-hard" | "yc-10" | string;
export interface Interviewer {
  name: string;
  linkedin?: string;
  notes?: string;
  photo?: string;
  voice?: "auto" | "cedar" | "marin";
}
export interface Draft {
  application: string;
  facts: string;
  program: Program;
  interviewer: Interviewer;
}
export interface Profile {
  id: string;
  title: string;
  interviewer?: Interviewer;
}
export interface Turn {
  speaker: string;
  speakerName?: string;
  text: string;
  start_ms: number;
  end_ms?: number;
}
export interface Scorecard {
  verdict: string;
  reason: string;
  scores: { criterion: string; score: number; quote?: string }[];
  weakest_answers: {
    timestamp_seconds: number;
    quote: string;
    why_weak: string;
    better_answer: string;
  }[];
  fact_mismatches: string[];
  limitations: string[];
}
export interface Session {
  id: string;
  status: string;
  profile: string;
  started?: number;
  transcript: Turn[];
  scorecard?: Scorecard;
  scoreStatus?: string;
  scoreError?: string;
  captionFinishing?: boolean;
  agendaWarning?: string;
  stopReason?: string;
  interrupted?: boolean;
  providerCloseReason?: string;
}
export interface Research {
  status: string;
  error?: string;
  result?: {
    matched: boolean;
    name: string;
    summary: string;
    topics: string[];
    sources: { title: string; url: string }[];
  };
}
export interface RoomState {
  research?: Research;
  preparation?: Research;
  host: boolean;
  profiles: Profile[];
  application: string;
  facts: string;
  interviewer?: Interviewer;
  enabled: boolean;
  busy: boolean;
  queueEnabled?: boolean;
  sessions: Session[];
}
export interface Grant {
  id: string;
  key: string;
  code?: string;
  program: string;
}
export interface Config {
  canCreate?: boolean;
  communityPreview?: boolean;
  turnstileSitekey?: string;
}
export const permissions = {
  version: "2026-11-01",
  terms: true,
  improvement: false,
  sales: false,
};
