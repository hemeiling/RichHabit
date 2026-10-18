import { redirect } from "next/navigation";

/**
 * The standalone Community page retired in favour of the two embedded cards:
 * the habit ranking lives on Rich Habits, the priority ranking on Priority
 * Compass. Old links keep working by going where their board went — the
 * `?board=` parameter this page used to read now just picks the destination.
 * The targets enforce sign-in themselves, so there is no loop and no hole;
 * the rankings, their API and their data are all unchanged.
 */
export default function Page({ searchParams }: { searchParams: { board?: string } }) {
  redirect(searchParams.board === "accomplishments" ? "/priorities" : "/habits");
}
