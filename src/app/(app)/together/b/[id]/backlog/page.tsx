import { redirect } from "next/navigation";

/**
 * The Backlog used to be its own page; it is now a section of the space's one
 * work surface. Old links land on it there. (The space page does its own access
 * check, so nothing is decided here.)
 */
export default function SpaceBacklogRedirect({ params }: { params: { id: string } }) {
  redirect(`/together/b/${encodeURIComponent(params.id)}#backlog`);
}
