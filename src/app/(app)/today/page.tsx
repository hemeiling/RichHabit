import { redirect } from "next/navigation";

/**
 * /today, kept for every link that already points here.
 *
 * The day's habits are Rich Habits now, so this is where the old address
 * resolves to. A redirect rather than a copy of the screen: two routes
 * rendering one experience is two things to keep in step, and the app settled
 * that question once already for Community Progress.
 *
 * Nothing about anyone's data is involved. No record moved, no id changed and
 * nothing was rewritten to make this route answer differently — it is a URL
 * pointing at a different URL, and that is the whole of it.
 */
export default function Page() {
  redirect("/habits");
}
