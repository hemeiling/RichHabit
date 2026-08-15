"use client";
import { useState } from "react";
import { useHabits } from "@/components/store";
import { Empty, Field, Segmented } from "@/components/ui";
import { useLocale, useT } from "@/lib/i18n/context";
import { shortDateFor } from "@/lib/i18n";
import { todayISO } from "@/lib/dates";
import { uid } from "@/lib/habits";
import { monthOf, summarise } from "@/lib/spending";
import { SPENDING_CATEGORIES } from "@/lib/types";

/**
 * Spending awareness (reference §27, CLAUDE.md §17).
 *
 * Deliberately not a habit. "Did you record your spending" could be a checkbox,
 * but what was spent is an outcome, and the only interesting part — where it
 * actually goes — cannot survive being flattened into done/not-done.
 *
 * The tone matters as much as the numbers: this reports proportions and leaves
 * them there. No budget, no target, no colour-coding someone's coffee as a
 * failure. §27 says the purpose is awareness, not shame, and a module that
 * scored people would quietly become the opposite.
 *
 * Amounts are currency-agnostic. The module compares a person's own numbers to
 * each other, which needs no symbol and no exchange rate.
 */

export default function Spending() {
  const { state, actions } = useHabits();
  const t = useT();
  const locale = useLocale();

  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("food");
  const [needWant, setNeedWant] = useState<"need" | "want">("need");
  const [planned, setPlanned] = useState(true);

  /** §27. Category % = category spending / total tracked spending × 100. */
  const month = summarise(state.spending, monthOf(todayISO()));
  const hasRecordsThisMonth = month.total > 0
    || state.spending.some((r) => monthOf(r.date) === monthOf(todayISO()));

  const money = (n: number) => n.toFixed(2);
  const pct = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

  /**
   * A third of a 390px row leaves about 80px of label. "Unplanned" at the
   * eyebrow's usual .14em tracking does not fit and breaks as "UNPLANNE / D",
   * so these three tighten up and stay on one line.
   */
  const statLabel = { fontSize: 10, letterSpacing: "0.06em", whiteSpace: "nowrap" } as const;

  const add = () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) return;
    actions.saveSpending({
      id: uid(), date, amount: Math.round(value * 100) / 100,
      description: description.trim(), category, needWant, planned, notes: "",
    });
    setAmount("");
    setDescription("");
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <div className="eyebrow">{t.spending.addTitle}</div>
        <p className="muted mt-2" style={{ fontSize: 14, lineHeight: 1.5 }}>{t.spending.intro}</p>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <Field label={t.spending.amount}>
            <input className="input num" type="number" inputMode="decimal" min={0} step="0.01"
              value={amount} placeholder="0.00"
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()} />
          </Field>
          <Field label={t.spending.date}>
            <input className="input num" type="date" value={date} max={todayISO()}
              onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
        </div>

        <Field label={t.spending.what}>
          <input className="input" value={description} placeholder={t.spending.whatPlaceholder}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()} />
        </Field>

        <Field label={t.spending.category}>
          <Segmented<string> value={category} onChange={setCategory} small
            options={SPENDING_CATEGORIES.map((c) => ({
              value: c, label: t.spending.categories[c] ?? c,
            }))} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t.spending.needWant}>
            <Segmented<"need" | "want"> value={needWant} onChange={setNeedWant} small
              options={[
                { value: "need", label: t.spending.need },
                { value: "want", label: t.spending.want },
              ]} />
          </Field>
          <Field label={t.spending.plannedLabel}>
            <Segmented<boolean> value={planned} onChange={setPlanned} small
              options={[
                { value: true, label: t.spending.planned },
                { value: false, label: t.spending.unplanned },
              ]} />
          </Field>
        </div>

        <div className="flex justify-end">
          <button className="btn btn-primary" disabled={!amount.trim()} onClick={add}>
            {t.spending.save}
          </button>
        </div>
      </section>

      {hasRecordsThisMonth && (
        <section className="card p-5">
          <div className="eyebrow mb-3">{t.spending.thisMonth}</div>
          <div className="grid grid-cols-2 min-[360px]:grid-cols-3 gap-3">
            <div className="flat p-3.5">
              <div className="eyebrow" style={statLabel}>{t.spending.total}</div>
              <div className="display num mt-1" style={{ fontSize: 24 }}>{money(month.total)}</div>
            </div>
            <div className="flat p-3.5">
              <div className="eyebrow" style={statLabel}>{t.spending.unplannedShare}</div>
              <div className="display num mt-1" style={{ fontSize: 24 }}>
                {month.unplannedPct == null ? "—" : `${pct(month.unplannedPct)}%`}
              </div>
            </div>
            <div className="flat p-3.5">
              <div className="eyebrow" style={statLabel}>{t.spending.wantShare}</div>
              <div className="display num mt-1" style={{ fontSize: 24 }}>
                {month.wantPct == null ? "—" : `${pct(month.wantPct)}%`}
              </div>
            </div>
          </div>

          <p className="faint mt-3" style={{ fontSize: 12.5 }}>
            {month.changePct == null
              ? t.spending.noComparison
              : t.spending.change(`${month.changePct > 0 ? "+" : ""}${pct(month.changePct)}`)}
          </p>
        </section>
      )}

      {month.byCategory.length > 0 && (
        <section className="card p-5">
          <div className="eyebrow mb-3">{t.spending.byCategory}</div>
          <div className="flex flex-col gap-2.5">
            {month.byCategory.map((c) => (
              <div key={c.key}>
                <div className="flex justify-between items-baseline" style={{ fontSize: 13.5 }}>
                  <span>{t.spending.categories[c.key] ?? c.key}</span>
                  <span className="num muted">{money(c.spent)} · {pct(c.pct)}%</span>
                </div>
                <div style={{ height: 6, background: "var(--line-soft)", borderRadius: 4, marginTop: 5 }}>
                  <div style={{
                    width: `${c.pct}%`, height: "100%",
                    background: "var(--accent)", borderRadius: 4,
                  }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card px-5 py-2">
        <div className="eyebrow pt-4 pb-1">{t.spending.recent}</div>
        {state.spending.length === 0 ? (
          <div className="py-3">
            <Empty title={t.spending.emptyTitle} body={t.spending.emptyBody} />
          </div>
        ) : (
          <div className="divide">
            {state.spending.slice(0, 40).map((r) => (
              <div key={r.id} className="flex items-baseline justify-between gap-3 py-3">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14.5 }}>
                    {r.description || (t.spending.categories[r.category] ?? r.category)}
                  </div>
                  <div className="faint flex flex-wrap gap-x-2.5 mt-0.5" style={{ fontSize: 11.5 }}>
                    <span>{shortDateFor(r.date, locale)}</span>
                    <span>{t.spending.categories[r.category] ?? r.category}</span>
                    <span>{r.needWant === "want" ? t.spending.want : t.spending.need}</span>
                    {!r.planned && <span>{t.spending.unplanned}</span>}
                  </div>
                </div>
                <div className="text-right" style={{ flex: "none" }}>
                  <div className="num" style={{ fontSize: 14.5 }}>{money(r.amount)}</div>
                  <button className="btn btn-quiet" style={{ padding: "1px 7px", fontSize: 11.5 }}
                    onClick={() => actions.deleteSpending(r.id)}>{t.spending.remove}</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="h-2" />
      </section>
    </div>
  );
}
