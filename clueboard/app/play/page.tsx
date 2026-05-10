import { getDailyBoard } from "@/lib/board";
import PlayClient from "@/components/PlayClient";

export const dynamic = "force-dynamic";

export default async function PlayPage() {
  const board = await getDailyBoard();
  return <PlayClient board={board} />;
}
