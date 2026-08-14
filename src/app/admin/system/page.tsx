import { requireAdminPage } from "@/lib/admin";
import { systemHealth } from "@/lib/analytics/queries";
import { ACTIVATION, ENGAGEMENT, SESSION_IDLE_MINUTES } from "@/lib/analytics/config";
import { Card, Stat, Table } from "../ui";

export const dynamic = "force-dynamic";

export default async function System() {
  await requireAdminPage();
  const h = await systemHealth();

  return (
    <div className="flex flex-col gap-4">
      <Card title="Event integrity" hint="Anything non-zero in the bottom three rows means the tracker is misbehaving.">
        <div className="grid grid-cols-2 min-[560px]:grid-cols-3 gap-3">
          <Stat label="Events recorded" value={h.events.toLocaleString()} />
          <Stat label="Sessions" value={h.sessions.toLocaleString()} />
          <Stat label="Latest event" value={h.latestEvent ? new Date(h.latestEvent).toISOString().slice(0, 16).replace("T", " ") : "—"} />
          <Stat label="Events with no session" value={h.orphanEvents} />
          <Stat label="Events with a deleted user" value={h.danglingUsers} />
          <Stat label="Events with no timezone" value={h.missingTimezone} sub="reported as UTC" />
        </div>
      </Card>

      <Card title="Configured thresholds" hint="All of these live in src/lib/analytics/config.ts.">
        <Table
          head={["Setting", "Value"]}
          rows={[
            ["Session idle timeout", `${SESSION_IDLE_MINUTES} minutes`],
            ["New user, for how long", `${ENGAGEMENT.newUserDays} days`],
            ["Highly engaged", `${ENGAGEMENT.highlyEngagedDaysPerWeek}+ active days per week`],
            ["Active within", `${ENGAGEMENT.activeWithinDays} days`],
            ["At risk after", `${ENGAGEMENT.atRiskAfterDays} days`],
            ["Dormant after", `${ENGAGEMENT.dormantAfterDays} days`],
            ["Activation window", `${ACTIVATION.windowDays} days`],
            ["Activation active days", `${ACTIVATION.distinctActiveDays}`],
          ]}
        />
      </Card>
    </div>
  );
}
