import { currentUser } from "@/lib/auth";
import { workspace } from "@/lib/workspace";
import WorkspaceApp from "@/components/workspace-app";
import SignIn from "./sign-in";

export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await currentUser();
  if (!user) return <SignIn />;
  return <WorkspaceApp initial={await workspace(user)} />;
}
