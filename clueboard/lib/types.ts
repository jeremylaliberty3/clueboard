export type Round = "single" | "final";

export type Clue = {
  id: number;
  category: string;
  categoryTag: string;
  clue: string;
  answer: string;
  value: number | null;
  round: Round;
  // Optional category-level metadata used by the board generator's
  // variety rules. All five clues in a category share the same values.
  topic?: string | null;
  categoryStyle?: string | null;
  difficultyProfile?: string | null;
};

export type ClueForClient = {
  id: number;
  category: string;
  categoryTag: string;
  clue: string;
  value: number | null;
  round: Round;
  isDailyDouble?: boolean;
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
  /** Score-affecting magnitude. For regular clues this is the clue's dollar
   *  value. For a Daily Double this is the player's wager. */
  value: number;
  isDailyDouble?: boolean;
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
