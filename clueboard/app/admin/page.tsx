import { notFound } from "next/navigation";
import { adminLoadCatalogAction } from "@/lib/admin-actions";
import AdminBoardBuilder from "./AdminBoardBuilder";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // Dev-only. Never reachable in production builds.
  if (process.env.NODE_ENV === "production") notFound();

  const catalog = await adminLoadCatalogAction();
  return <AdminBoardBuilder catalog={catalog} />;
}
