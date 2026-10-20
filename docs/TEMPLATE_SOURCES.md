# Habit Template Library: sources and attribution

The template definitions live in `src/lib/library.ts` (structure, schedules, links)
and `src/lib/i18n/{en,zh}.ts` (`templates.*`: names, descriptions, "Why this habit?",
citations, collection texts). This file records where every claim comes from, so
the library can be maintained without repeating the research.

Sources verified 2026-10-20. Every quotation was matched against the loaded page.
Every link in `library.ts` was fetched and checked for its quoted text.

## Rules

- **Attribution, shown to the reader in plain words:**
  - **Documented practice** (*有据可查的做法*): the person did it, in their own words or as recorded by an eyewitness.
  - **Their own advice** (*本人的建议*): the person recommends this behaviour in their own words.
  - **RichHabit adaptation** (*RichHabit 改编*): our habit, inspired by their ideas. The schedule is always ours unless a source states one.
- **No statistics are presented as findings.** Corley's study figures contradict each other across his own articles, so none are used. The one percentage in the library is the savings example people adjust.
- **No promises.** Nothing says a habit causes wealth, success or health. "Guarantee" wording, fixed habit-formation durations ("90 days", "six months") and work-hours material are excluded.
- **Never fabricated.** A quote that cannot be traced to a primary source is not used. In particular, Musk's popular "Failure is an option here…" is unattributable.
- **Text-first collections.** Initials only: no portraits, no book covers.

## Collections

| Collection | Habits | Primary sources (all links in `library.ts` → `SRC`) |
|---|---|---|
| **The 13 Virtues** (Franklin) | Virtue of the week (HT-2c rotation), the morning and evening questions, and each virtue twice: the virtue itself (documented: his evening check) and a practical habit (adaptation; Humility's is his recorded rule, so documented) | *Autobiography*, Harvard Classics ed. (Eliot, 1909), Project Gutenberg #148. The precepts match it word for word. The morning question comes from his daily *scheme*: a plan he kept "with occasional intermissions", not proof he rose at five every day. |
| **Rich Habits** (Corley) | Five themes. The theme names are RichHabit's ("Golden Morning Routine" is not his term). Four everyday templates (exercise, top three priorities, reading, spending review) are shown inside the collection instead of being copied. | richhabits.net posts by Corley; his CNBC Make It columns (2018); CNBC reporting on his advice (2017). Book: *Rich Habits: The Daily Success Habits of Wealthy Individuals* (Langdon Street Press, 2010; Open Library OL25989176M, not linked in-app because its page sends automated visitors to a verification check). Found **not** in his writing, and so labelled adaptations: saying no, a phone-free morning, monthly learning review, paying cards on time, weekly and monthly reviews. |
| **Lifelong Learning** (Gates) | Reading before sleep (30 min is RichHabit's suggestion; he said "an hour almost every night" in 1990), notes, thinking time, a new field, applying what you learn. All adaptations. | Seattle Times column, 31 Jul 1990 (direct quote); his LinkedIn post (2024, notes in margins); CNBC on his Gates Notes Think Week post (2024); eSchool News on his Gates Notes post (2010); the NYT (2016) via the Children's Book Council; Open Culture (2016, "about a book a week"). gatesnotes.com refuses automated requests (HTTP 403), so it is not linked; verified copies are linked instead. The WSJ 2005 Think Week article is **not** used (18-hour reading days). |
| **First-Principles Thinking** (Musk) | Challenge an assumption, break a problem into basic facts, delete a step (his own advice); a focused session and learning from a failed experiment (adaptations) | TED2013 conversation, transcript on ted.com ("boil things down to their fundamental truths…"); Everyday Astronaut Starbase interview (2021) for the five-step "algorithm", which is paraphrased rather than quoted. |
| **Long-Term Thinking** (Bezos) | Eight hours of sleep and hardest thinking before lunch (documented, 2018); the door check and the customer view (his own advice); the decision of the day, simplifying a process, the long-term goal review (adaptations) | Economic Club of Washington transcript, 13 Sep 2018; shareholder letters of 1997 (aboutamazon.com), 2015 (SEC exhibit) and 2016 (aboutamazon.com); Academy of Achievement interview (2001, "regret minimization framework"). |
| **From History** (existing HT-1 shelf) | Marcus Aurelius, Darwin ×2, Hemingway, Buffett, Seneca | Cited by book or interview in `templates.sources` (no links). |

## Corrections made to existing text

The old wording is kept in `RETIRED_WORDING` (`src/lib/templates.ts`), so copies people already have keep their template link and translation.

- Franklin's morning question no longer says he "opened each day at five". That was his plan.
- Chastity quotes Franklin's precept, with *venery* glossed. The modern reading is offered as a labelled adaptation, not as his meaning.
- Sincerity's punctuation follows the cited edition.
- Bezos's sleep quote shows that it begins mid-sentence ("…for me, I need eight hours of sleep").
- The Gates citation is a Seattle Times column, not an interview.
- Six Chinese virtue names follow the approved list: 缄默, 决心, 勤奋, 正义, 整洁, 贞洁.

## Changing or adding a template

1. Edit `library.ts`, then add or change the strings in both `en.ts` and `zh.ts`.
2. If an existing name or description changes, add the old text to `RETIRED_WORDING`.
3. Never reuse or rename a key: users' copies point at it. Library changes never rewrite anyone's habit, because adoption copies.
4. Run `npx vitest run tests/habit-templates.test.ts tests/i18n.test.ts tests/branding.test.ts`. They check bilingual completeness, attribution, https links, valid schedules, and promise and statistics wording.
5. Re-check every link and quoted phrase before release. Bios (especially current roles) change; re-check them on release day.
