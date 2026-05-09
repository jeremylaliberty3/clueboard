import { getDailyBoard } from "@/lib/board";
import PlayClient from "@/components/PlayClient";

export const dynamic = "force-dynamic";

export default function PlayPage() {
  const board = getDailyBoard();
  return <PlayClient board={board} />;
}
