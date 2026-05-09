export type Round = "single" | "final";

export type Clue = {
  id: number;
  category: string;
  categoryTag: string;
  clue: string;
  answer: string;
  value: number | null;
  round: Round;
};

export type ClueForClient = {
  id: number;
  category: string;
  categoryTag: string;
  clue: string;
  value: number | null;
  round: Round;
};

export type DailyBoard = {
  date: string;
  categories: string[];
  cellsByCategory: Record<string, ClueForClient[]>;
  finalClue: ClueForClient;
};

export type AnswerRecord = {
  clueId: number;
  userAnswer: string;
  correct: boolean;
  skipped: boolean;
  value: number;
  correctAnswer: string;
  answeredAt: string;
};

export type GamePhase = "board" | "final_wager" | "final_clue" | "done";

export type GameState = {
  date: string;
  answers: Record<number, AnswerRecord>;
  score: number;
  phase: GamePhase;
  finalCategory?: string;
  finalWager?: number;
  finalAnswer?: string;
  finalCorrect?: boolean;
  finalCorrectAnswer?: string;
  finalScore?: number;
};
