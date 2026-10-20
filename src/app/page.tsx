import { currentUser } from "@/lib/auth";
import { workspace } from "@/lib/workspace";
import WorkspaceApp from "@/components/workspace-app";
import SignIn from "./sign-in";
import { MAIN_BRAIN_ID } from "@/lib/brain-scope";

export const dynamic = "force-dynamic";
export default async function Home({ searchParams }: { searchParams: Promise<{ brain?: string | string[] }> }) {
  const user = await currentUser();
  if (!user) return <SignIn />;
  const selected = (await searchParams).brain;
  const brainId = selected === undefined ? MAIN_BRAIN_ID : typeof selected === "string" ? selected : "";
  return <WorkspaceApp key={brainId} initial={await workspace(user, brainId)} />;
}
