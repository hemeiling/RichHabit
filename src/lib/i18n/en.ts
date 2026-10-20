/**
 * The English dictionary, and the shape every other language must match.
 * `zh.ts` is typed as `Dict`, so a missing or misspelled key is a build error
 * rather than a blank space on someone's screen.
 *
 * Anything with a number or a name in it is a function, not a template built by
 * concatenation at the call site — word order differs between languages, and
 * "3 days running" cannot be assembled from parts that work in both.
 */
/**
 * Category and unit words are declared once and reused by the labels *and* by
 * the sentences that mention them. That matters for the bilingual dictionary:
 * a function must resolve its own language's noun, because passing an
 * already-bilingual string in would render it twice ("High · 高 priority ·
 * High · 高优先级").
 */
export type CategoryKey = "morning" | "daytime" | "nighttime";
export type UnitKey = "kcal" | "hours" | "glasses" | "minutes" | "none";

/** A template collection's own words. Only the featured ones have the "About" fields. */
export interface CollectionText {
  title: string;
  person: string;
  idea: string;
  bio?: string;
  philosophy?: string;
  useful?: string;
  /** Labels for the collection's links (library.ts `COLLECTION_INFO`), in the same order. */
  links?: string[];
}

// Values are widened to `string` so the dictionary type is about shape, not
// about which words English happens to use.
const CAT: Record<CategoryKey, string> = {
  morning: "Morning", daytime: "Daytime", nighttime: "Nighttime",
};
const UNIT: Record<UnitKey, string> = {
  kcal: "kcal", hours: "hrs", glasses: "glasses", minutes: "min", none: "",
};

/**
 * Together's stage names, kept outside the dictionary so the sentences that
 * name a stage can take its key: the bilingual dictionary calls each language
 * with the same arguments, and a label passed in would arrive already in both.
 */
const WORK_STAGES = { backlog: "Backlog", todo: "To do", doing: "In progress", waiting: "Waiting", done: "Done" } as const;
type WorkStage = keyof typeof WORK_STAGES;

export const en = {
  appName: "RichHabit",
  /** One line, under the name. The product's promise in the reader's language. */
  tagline: "Build Rich Habits. Build a Richer Life.",
  localeName: "English",

  /**
   * The public front page. One statement, one supporting line, two actions —
   * and nothing else, on purpose: the page exists to be felt and acted on, not
   * read. Anything that explains a feature belongs behind the sign-in.
   */
  landing: {
    /**
     * Written as its own lines. The break after "matters" is the sentence's
     * hinge, and at this size where it breaks is the design — see Landing.tsx.
     */
    headline: ["Turn what matters", "into what you do."],
    support: ["Build habits. Choose what matters.", "See the life you're creating."],
    signUp: "Sign Up",
    logIn: "Log In",
  },

  nav: {
    /*
     * The umbrella the three experiences sit under. A group, not a page: it
     * names the progression from direction to behaviour to action without
     * putting a dashboard between people and the three things they came to do.
     */
    journey: "My Journey",
    /*
     * The three named destinations, in the order direction, behaviour, action.
     * "Rich Habits" is the phrase, not the product name — RichHabit is one
     * word, and this is the habit experience's own name.
     *
     * Shorter here than the page title on purpose: the sidebar is 244px wide,
     * these are indented under a parent, and they have to sit on one line
     * beside an icon. "Clarify Intention" keeps the verb, which is what makes
     * the destination an act rather than a noun.
     */
    intention: "Clarify Intention",
    habits: "Rich Habits",
    priorities: "Priority Compass",
    week: "Week",
    insights: "Insights",
    /* Sits after the four personal views and before settings: it is the one
       screen that looks outward, and the sidebar reads inward-to-outward. */
    together: "Together",
    togetherOverview: "Overview",
    more: "More",
    /** The sidebar's own labels: the landmark, the drawer, the account block. */
    mainNavigation: "Main navigation",
    openMenu: "Open menu",
    account: "Account & settings",
  },

  titles: {
    /* No "/today": it redirects to /habits, so its title never renders. */
    "/intention": "Clarify Your Intention",
    "/habits": "Rich Habits",
    "/priorities": "Priority Compass",
    "/week": "Rich habits checklist",
    "/insights": "Analytics",
    "/together": "Together",
    "/more": "More",
    "/more/habits": "My Habit Sheet",
    "/more/refine": "Refine my habits",
    "/more/awareness": "Habit awareness",
    "/more/goals": "Goals",
    "/more/metrics": "Metrics",
    "/more/spending": "Spending",
    "/more/stacks": "Habit stacking",
    "/more/review": "Weekly review",
  } as Record<string, string>,

  common: {
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    close: "Close",
    new: "New",
    remove: "Remove",
    dismiss: "Dismiss",
    back: "Back",
    saving: "Saving",
    savingEllipsis: "Saving…",
    allSaved: "All changes saved.",
    loading: "Loading your habits…",
    optional: "Optional",
    none: "—",
    // Numerals read the same in both languages, so this collapses to one
    // copy in bilingual mode instead of "0 of 5 · 0 / 5".
    of: (done: number, total: number) => `${done} / ${total}`,
    previousDay: "Previous day",
    nextDay: "Next day",
    previousWeek: "Previous week",
    nextWeek: "Next week",
    toggleDarkMode: "Toggle dark mode",
    language: "Language",
  },

  categories: {
    morning: { label: CAT.morning, note: "Phase one" },
    daytime: { label: CAT.daytime, note: "Phase two" },
    nighttime: { label: CAT.nighttime, note: "Phase three" },
  },

  days: {
    short: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    initial: ["S", "M", "T", "W", "T", "F", "S"],
  },

  priority: { low: "Low", medium: "Medium", high: "High" },

  goalAreas: {
    Health: "Health",
    Fitness: "Fitness",
    Career: "Career",
    Learning: "Learning",
    Relationships: "Relationships",
    Financial: "Financial",
    "Personal project": "Personal project",
    Sleep: "Sleep",
  } as Record<string, string>,

  /**
   * System-provided starter content. These are keyed, not stored as text: the
   * database keeps `template_key` and the display name is resolved here, so a
   * seeded habit follows the language the reader picked. A habit the user
   * renames loses its key and keeps their words forever after.
   */
  templates: {
    habits: {
      plan_priorities: "Plan today's priorities",
      exercise: "Exercise / move",
      read_for_learning: "Read / learn",
      begin_intentionally: "Begin the day intentionally",
      // Library-only (§10), not on the starter sheet.
      brush_morning_night: "Brush morning and night",
      top_three_priorities: "Choose your top three priorities",
      stand_every_hour: "Stand or move every hour",
      record_spending: "Record what you spent",
      review_spending: "Review spending by category",
      reach_out_to_someone: "Reach out to someone you care about",
      important_goals: "Work on important goals",
      drink_water: "Drink enough water",
      movement_breaks: "Take movement breaks",
      read_for_learning_night: "Read / learn",
      prepare_tomorrow: "Prepare for tomorrow",
      bedtime_routine: "Follow an intentional bedtime routine",
      // Retired from the starter sheet but still named, so an account that has
      // one from an earlier release keeps a readable label.
      personal_goal: "Work on a personal goal",
      skip_early_email: "Skip the early email check",
      goal_related_work: "Do important goal-related work",
      avoid_junk_food: "Avoid junk food",
      avoid_gossip: "Avoid gossip",
      downtime_learning: "Use downtime for learning",
      limit_tv: "Limit recreational TV",
      limit_internet: "Limit recreational internet",
      meaningful_goal_hour: "Spend an hour on a meaningful goal",
      bed_on_time: "Go to bed on time",
      /* ── Franklin's thirteen virtues (Autobiography) ── */
      franklin_virtue_week: "Virtue of the week",
      franklin_temperance: "Temperance",
      franklin_silence: "Silence",
      franklin_order: "Order",
      franklin_resolution: "Resolution",
      franklin_frugality: "Frugality",
      franklin_industry: "Industry",
      franklin_sincerity: "Sincerity",
      franklin_justice: "Justice",
      franklin_moderation: "Moderation",
      franklin_cleanliness: "Cleanliness",
      franklin_tranquility: "Tranquility",
      franklin_chastity: "Chastity",
      franklin_humility: "Humility",
      franklin_morning_question: "Morning question: what good shall I do today?",
      franklin_evening_question: "Evening question: what good have I done today?",
      /* ── Practices from history ── */
      marcus_morning_prep: "Prepare for the day's difficult moments",
      darwin_morning_walk: "Short walk before breakfast",
      hemingway_morning_writing: "Do your creative work first thing",
      darwin_daily_walk: "Take a daily thinking walk",
      buffett_reading_block: "Keep a daily reading block",
      bezos_hard_before_lunch: "Do the hardest thinking before lunch",
      seneca_evening_review: "Review the day before sleep",
      gates_reading_before_sleep: "Read before sleep",
      bezos_sleep_eight: "Protect eight hours of sleep",
      /* ── Template Library: Franklin, one practical habit per virtue ── */
      franklin_temperance_practice: "Stop eating when you're satisfied",
      franklin_silence_practice: "Pause before you speak: will it help?",
      franklin_order_practice: "Plan tomorrow's top three priorities",
      franklin_resolution_practice: "Finish one thing you resolved to do",
      franklin_frugality_practice: "Review the week's unnecessary expenses",
      franklin_industry_practice: "Complete one focused work session",
      franklin_sincerity_practice: "Speak plainly: no misleading words",
      franklin_justice_practice: "Do one thing you owe someone",
      franklin_moderation_practice: "Let one grievance go",
      franklin_cleanliness_practice: "Reset your space before bed",
      franklin_tranquility_practice: "Reflect calmly on a stressful moment",
      franklin_chastity_practice: "Honour your commitments in intimate life",
      franklin_humility_practice: "Disagree gently: ask, don't contradict",
      /* ── Thomas C. Corley ── */
      corley_phone_free_morning: "Keep your morning routine phone-free",
      corley_say_no: "Say no to one low-value commitment",
      corley_to_dont: "Name one time-waster to skip today",
      corley_time_block: "Block time for your most important work",
      corley_insight: "Write down one useful insight",
      corley_apply_idea: "Put one new idea to use",
      corley_learning_review: "Review what you learned this month",
      corley_pay_yourself_first: "Pay yourself first",
      corley_card_in_full: "Pay card balances in full and on time",
      corley_money_goals: "Review your financial goals",
      corley_checkin: "Two-minute habit check-in",
      corley_weekly_review: "Review your week's habit progress",
      corley_monthly_growth: "Reflect on how you've grown this month",
      /* ── Bill Gates ── */
      gates_learning_note: "Write down one important thing you learned",
      gates_think_time: "Schedule uninterrupted thinking time",
      gates_new_field: "Explore a topic outside your field",
      gates_apply_learning: "Reflect on how to use what you learned",
      /* ── Elon Musk ── */
      musk_challenge_assumption: "Challenge one assumption",
      musk_first_principles: "Break a hard problem into its basic facts",
      musk_focus_session: "Do a focused problem-solving session",
      musk_delete_step: "Delete one unnecessary step",
      musk_failure_review: "Learn from one failed experiment",
      /* ── Jeff Bezos ── */
      bezos_key_decision: "Name today's one high-impact decision",
      bezos_customer_view: "Look at one decision from the customer's side",
      bezos_door_check: "One-way or two-way door? Sort one decision",
      bezos_simplify_process: "Simplify one recurring process",
      bezos_long_term_review: "Review one long-term goal",
    } as Record<string, string>,
    /*
     * What each template means in a sentence or two. Franklin's virtues carry
     * his own precepts, quoted; historical practices say what the person
     * actually did, in their words where possible — and never promise that
     * the habit makes anyone rich or successful.
     */
    descriptions: {
      franklin_virtue_week: "Franklin's method as one habit: a week's strict attention to each of his thirteen virtues in turn, then round again. Tick each day you kept this week's virtue.",
      franklin_temperance: "“Eat not to dullness; drink not to elevation.” — Franklin's precept",
      franklin_silence: "“Speak not but what may benefit others or yourself; avoid trifling conversation.” — Franklin's precept",
      franklin_order: "“Let all your things have their places; let each part of your business have its time.” — Franklin's precept",
      franklin_resolution: "“Resolve to perform what you ought; perform without fail what you resolve.” — Franklin's precept",
      franklin_frugality: "“Make no expense but to do good to others or yourself; i.e., waste nothing.” — Franklin's precept",
      franklin_industry: "“Lose no time; be always employ'd in something useful; cut off all unnecessary actions.” — Franklin's precept",
      franklin_sincerity: "“Use no hurtful deceit; think innocently and justly, and, if you speak, speak accordingly.” — Franklin's precept",
      franklin_justice: "“Wrong none by doing injuries, or omitting the benefits that are your duty.” — Franklin's precept",
      franklin_moderation: "“Avoid extreams; forbear resenting injuries so much as you think they deserve.” — Franklin's precept",
      franklin_cleanliness: "“Tolerate no uncleanliness in body, cloaths, or habitation.” — Franklin's precept",
      franklin_tranquility: "“Be not disturbed at trifles, or at accidents common or unavoidable.” — Franklin's precept",
      // Franklin's meaning kept, not redefined; the modern reading is in its "Why".
      franklin_chastity: "“Rarely use venery but for health or offspring, never to dulness, weakness, or the injury of your own or another's peace or reputation.” — Franklin's precept (venery: sexual indulgence)",
      franklin_humility: "Franklin's own precept, quoted: “Imitate Jesus and Socrates.”",
      franklin_morning_question: "The morning question in Franklin's daily scheme, followed by planning the day's business.",
      franklin_evening_question: "And closed it with this one — an evening look at the day. He marked his faults nightly in a little book, one virtue in focus each week.",
      marcus_morning_prep: "A principle from his private notes, not a recorded routine: begin the morning ready to meet difficult people with patience.",
      darwin_morning_walk: "Darwin took a short turn outdoors before breakfast — a habit his son says he kept almost to the end of his life.",
      hemingway_morning_writing: "“When I am working on a book or a story I write every morning as soon after first light as possible” — stopping while he still knew what came next.",
      darwin_daily_walk: "His midday round of the Sandwalk, counting laps with a heap of flints — walking as thinking time.",
      buffett_reading_block: "His own estimate: “I just read and read and read… probably five or six hours a day.” Set a length that fits your day.",
      bezos_hard_before_lunch: "“I like to do my high-IQ meetings before lunch.” Put the demanding work where your head is freshest.",
      seneca_evening_review: "“I pass the whole day in review before myself” — a nightly accounting, once the lamp was out.",
      gates_reading_before_sleep: "“I read an hour almost every night. It's part of falling asleep.”",
      bezos_sleep_eight: "“…for me, I need eight hours of sleep.” He says he prioritises it, except when travelling across time zones.",
      /*
       * Template Library. What to do, without naming a frequency — the copy
       * keeps this text when someone changes how often it repeats.
       */
      franklin_temperance_practice: "At one meal today, stop when you're satisfied rather than full.",
      franklin_silence_practice: "In conversation today, pause once before speaking and leave out what wouldn't help anyone.",
      franklin_order_practice: "Before the day ends, write down the three things that matter most tomorrow.",
      franklin_resolution_practice: "Pick one thing you told yourself you'd do, and see it through today.",
      franklin_frugality_practice: "Look back at what you spent and note what you didn't really need. Your Spending page already separates needs from wants.",
      franklin_industry_practice: "Work on one important task without switching to anything else, for as long as suits you.",
      franklin_sincerity_practice: "When you're tempted to mislead or shade the truth, say it plainly instead.",
      franklin_justice_practice: "Follow through on something owed: a reply, a thank-you, a promise, or your fair share.",
      franklin_moderation_practice: "Choose one slight or annoyance and consciously let it go.",
      franklin_cleanliness_practice: "Spend a few minutes putting your room or desk back in order before sleep.",
      franklin_tranquility_practice: "Think back over one stressful moment and ask whether it deserved the worry.",
      franklin_chastity_practice: "A private check: has your intimate life stayed within your commitments, and respected everyone involved?",
      franklin_humility_practice: "When you disagree, ask a question or offer your view as a view, instead of flatly contradicting.",
      corley_phone_free_morning: "Until your morning routine is done, keep social media and news feeds closed.",
      corley_say_no: "Politely turn down or drop one request that doesn't serve your goals.",
      corley_to_dont: "Write a one-line “to-don't” list: the distraction you'll avoid today.",
      corley_time_block: "Set aside a fixed block of time for your most important goal, and protect it from interruptions.",
      corley_insight: "Note one idea worth keeping from something you read or heard.",
      corley_apply_idea: "Try one thing you learned in your work or life.",
      corley_learning_review: "Look back over your notes and choose what to keep practising.",
      corley_pay_yourself_first: "When income arrives, set savings aside before spending — aim for 20% if you can; any amount builds the habit.",
      corley_card_in_full: "Pay the full statement balance by the due date, so no interest builds up.",
      corley_money_goals: "Reread your money goals and note one next step.",
      corley_checkin: "Before bed, take two minutes with today's habits: what went well, and what to adjust.",
      corley_weekly_review: "Open your weekly review and decide what to keep, simplify or change.",
      corley_monthly_growth: "Write a few lines about what has changed this month, however small.",
      gates_learning_note: "Write a few lines about the most useful thing you read or learned.",
      gates_think_time: "Block time with no meetings or messages — just reading, thinking and notes.",
      gates_new_field: "Spend time on a subject you know little about: a book, a lecture or a course.",
      gates_apply_learning: "Pick one idea from your reading and decide where it could make a difference.",
      musk_challenge_assumption: "Pick something done “because that's how it's done” and ask whether it's actually true.",
      musk_first_principles: "List what you know to be true about one hard problem, then build your answer up from those facts.",
      musk_focus_session: "Work on one hard problem without distractions — then stop and rest.",
      musk_delete_step: "Look at a routine or process you use and remove one step that doesn't need to be there.",
      musk_failure_review: "Look at something that didn't work; write down what it taught you and what you'll try next.",
      bezos_key_decision: "Write down the one decision that will matter most today, and give it your best attention.",
      bezos_customer_view: "Take one decision and ask how it looks to the people it's for: customers, colleagues or family.",
      bezos_door_check: "Ask of one pending decision: can it be undone? If so, decide quickly; if not, take your time.",
      bezos_simplify_process: "Pick a routine task, ask whether every step still serves its purpose, and cut or simplify one.",
      bezos_long_term_review: "Reread one long-term goal and choose the next step toward it.",
    } as Record<string, string>,
    /* The citation under each historical template. Short, honest, checkable. */
    sources: {
      franklin_virtue_week: "Benjamin Franklin, Autobiography (1791)",
      franklin_temperance: "Benjamin Franklin, Autobiography (1791)",
      franklin_silence: "Benjamin Franklin, Autobiography (1791)",
      franklin_order: "Benjamin Franklin, Autobiography (1791)",
      franklin_resolution: "Benjamin Franklin, Autobiography (1791)",
      franklin_frugality: "Benjamin Franklin, Autobiography (1791)",
      franklin_industry: "Benjamin Franklin, Autobiography (1791)",
      franklin_sincerity: "Benjamin Franklin, Autobiography (1791)",
      franklin_justice: "Benjamin Franklin, Autobiography (1791)",
      franklin_moderation: "Benjamin Franklin, Autobiography (1791)",
      franklin_cleanliness: "Benjamin Franklin, Autobiography (1791)",
      franklin_tranquility: "Benjamin Franklin, Autobiography (1791)",
      franklin_chastity: "Benjamin Franklin, Autobiography (1791)",
      franklin_humility: "Benjamin Franklin, Autobiography (1791)",
      franklin_morning_question: "Benjamin Franklin, Autobiography (1791)",
      franklin_evening_question: "Benjamin Franklin, Autobiography (1791)",
      marcus_morning_prep: "Marcus Aurelius, Meditations 2.1 — a principle, not a recorded habit",
      darwin_morning_walk: "Francis Darwin, Life and Letters of Charles Darwin (1887)",
      hemingway_morning_writing: "Ernest Hemingway, The Paris Review, Art of Fiction No. 21 (1958)",
      darwin_daily_walk: "Francis Darwin, Life and Letters of Charles Darwin (1887)",
      buffett_reading_block: "Warren Buffett, Iconic Voices interview (2015)",
      bezos_hard_before_lunch: "Jeff Bezos, Economic Club of Washington (2018)",
      seneca_evening_review: "Seneca, On Anger 3.36",
      gates_reading_before_sleep: "Bill Gates, quoted in The Seattle Times (1990)",
      bezos_sleep_eight: "Jeff Bezos, Economic Club of Washington (2018)",
      // Template Library. Links are in library.ts; every one was opened and checked.
      franklin_temperance_practice: "Benjamin Franklin, Autobiography (1791)",
      franklin_silence_practice: "Benjamin Franklin, Autobiography (1791)",
      franklin_order_practice: "Benjamin Franklin, Autobiography (1791)",
      franklin_resolution_practice: "Benjamin Franklin, Autobiography (1791)",
      franklin_frugality_practice: "Benjamin Franklin, Autobiography (1791)",
      franklin_industry_practice: "Benjamin Franklin, Autobiography (1791)",
      franklin_sincerity_practice: "Benjamin Franklin, Autobiography (1791)",
      franklin_justice_practice: "Benjamin Franklin, Autobiography (1791)",
      franklin_moderation_practice: "Benjamin Franklin, Autobiography (1791)",
      franklin_cleanliness_practice: "Benjamin Franklin, Autobiography (1791)",
      franklin_tranquility_practice: "Benjamin Franklin, Autobiography (1791)",
      franklin_chastity_practice: "Benjamin Franklin, Autobiography (1791)",
      franklin_humility_practice: "Benjamin Franklin, Autobiography (1791)",
      corley_phone_free_morning: "Tom Corley, “The To Don't List Is More Important Than The To Do List”, richhabits.net",
      corley_say_no: "Tom Corley, “The To Don't List Is More Important Than The To Do List”, richhabits.net",
      corley_to_dont: "Tom Corley, “The To Don't List Is More Important Than The To Do List”, richhabits.net",
      corley_time_block: "Tom Corley, CNBC Make It (2018)",
      corley_insight: "Tom Corley, CNBC Make It (2018)",
      corley_apply_idea: "Tom Corley, “Without Action, Knowledge Is Worthless”, richhabits.net",
      corley_learning_review: "Tom Corley, “Without Action, Knowledge Is Worthless”, richhabits.net",
      corley_pay_yourself_first: "CNBC Make It, on Tom Corley's advice (2017)",
      corley_card_in_full: "Tom Corley, “Daily Habits That Make You Rich or Poor”, richhabits.net",
      corley_money_goals: "CNBC Make It, on Tom Corley's advice (2017)",
      corley_checkin: "Tom Corley, “Self-Accountability Forces You To Grow…”, richhabits.net (2020)",
      corley_weekly_review: "Tom Corley, “Self-Accountability Forces You To Grow…”, richhabits.net (2020)",
      corley_monthly_growth: "Tom Corley, CNBC Make It (2018)",
      // Everyday templates as shown in Corley's collection: `collection:key`.
      "corley:exercise": "Tom Corley, CNBC Make It (2018)",
      "corley:top_three_priorities": "Tom Corley, CNBC Make It (2018)",
      "corley:read_for_learning": "Tom Corley, CNBC Make It (2018)",
      "corley:review_spending": "CNBC Make It, on Tom Corley's advice (2017)",
      gates_learning_note: "Bill Gates, LinkedIn (2024)",
      gates_think_time: "Bill Gates, Gates Notes (2024), as reported by CNBC",
      gates_new_field: "Bill Gates, Gates Notes (2010), as reported by eSchool News",
      gates_apply_learning: "Bill Gates in The New York Times (2016), as quoted by the Children's Book Council",
      musk_challenge_assumption: "Elon Musk, TED2013 conversation with Chris Anderson",
      musk_first_principles: "Elon Musk, TED2013 conversation with Chris Anderson",
      musk_focus_session: "Elon Musk, TED2013 conversation with Chris Anderson",
      musk_delete_step: "Elon Musk, Starbase interview, Everyday Astronaut (2021)",
      musk_failure_review: "Elon Musk, Starbase interview, Everyday Astronaut (2021)",
      bezos_key_decision: "Jeff Bezos, 2016 Letter to Shareholders",
      bezos_customer_view: "Jeff Bezos, 2016 Letter to Shareholders",
      bezos_door_check: "Jeff Bezos, 2015 Letter to Shareholders",
      bezos_simplify_process: "Jeff Bezos, 2016 Letter to Shareholders",
      bezos_long_term_review: "Jeff Bezos, 1997 Letter to Shareholders",
    } as Record<string, string>,
    /*
     * "Why this habit?" — shown before anything is added. Quotes are verbatim
     * from the linked source (docs/TEMPLATE_SOURCES.md); anything RichHabit
     * added says so. Franklin's thirteen share `franklin_virtue`.
     */
    why: {
      franklin_virtue: "Franklin's own method: he kept a little book with a page for each virtue and marked his faults every evening. Tick the days you kept this one — and if it slips, simply carry on, as he did.",
      franklin_virtue_week: "Franklin gave “a week's strict attention to each of the virtues successively” — thirteen weeks for a full course, then round again. This is that method as one habit; it complements the individual virtues below.",
      franklin_morning_question: "In Franklin's daily scheme, the morning began with “What good shall I do this day?” and planning the day's business. It was his plan, which he says he kept “with occasional intermissions”.",
      franklin_evening_question: "His scheme closed each day with “What good have I done to-day?” and an examination of the day.",
      franklin_temperance_practice: "Temperance, Franklin's first virtue: “Eat not to dullness; drink not to elevation.” Stopping in time at one meal a day is a small, concrete way to practise it.",
      franklin_silence_practice: "Franklin's precept for Silence: “Speak not but what may benefit others or yourself; avoid trifling conversation.” A short pause is what makes it possible.",
      franklin_order_practice: "Order: “Let all your things have their places; let each part of your business have its time.” Franklin's own daily scheme ended by putting things in their places and began by planning the day's business.",
      franklin_resolution_practice: "Resolution: “Resolve to perform what you ought; perform without fail what you resolve.” Keeping small promises to yourself is how it grows.",
      franklin_frugality_practice: "Frugality: “Make no expense but to do good to others or yourself; i.e., waste nothing.” A weekly look is about awareness, not a budget — no judgement, just noticing.",
      franklin_industry_practice: "Industry: “Lose no time; be always employ'd in something useful; cut off all unnecessary actions.” One focused session a day is a version you can sustain.",
      franklin_sincerity_practice: "Sincerity: “Use no hurtful deceit; think innocently and justly, and, if you speak, speak accordingly.” Plain speech is its everyday form.",
      franklin_justice_practice: "Justice: “Wrong none by doing injuries, or omitting the benefits that are your duty.” For Franklin, leaving a duty undone was a wrong too.",
      franklin_moderation_practice: "Moderation: “Avoid extreams; forbear resenting injuries so much as you think they deserve.” Letting one thing go is the practice.",
      franklin_cleanliness_practice: "Cleanliness: “Tolerate no uncleanliness in body, cloaths, or habitation.” A short nightly reset keeps it small and steady.",
      franklin_tranquility_practice: "Tranquility: “Be not disturbed at trifles, or at accidents common or unavoidable.” Looking back calmly helps tell the trifles from what matters.",
      franklin_chastity_practice: "Franklin's Chastity meant sexual restraint — “venery” is an old word for sexual indulgence — never to the injury of “your own or another's peace or reputation.” This RichHabit adaptation keeps that core as a private check: restraint, and respect for everyone involved. Like everything on your sheet, it stays private.",
      franklin_humility_practice: "Franklin's own practice for Humility: “I made it a rule to forbear all direct contradiction to the sentiments of others, and all positive assertion of my own.” He admitted he never fully mastered it.",
      "corley:exercise": "Daily exercise is one of Corley's core habits. Describing his own routine, he writes: “I exercise between 30 minutes to 60 minutes every day.” Start with whatever fits — five minutes counts.",
      "corley:top_three_priorities": "Corley suggests starting the day by asking: “What are the five most productive things I can do today to help me achieve the goals that will help me realize my dreams?” Three is RichHabit's suggestion — choose your own number.",
      "corley:read_for_learning": "Reading to learn is part of the morning routine Corley recommends: “Read to learn for 30-45 minutes.” The minimum here is two minutes, so a rushed morning still counts.",
      "corley:review_spending": "Corley's money advice starts with awareness: track what you spend. Your Spending page already separates needs from wants, so a weekly review needs no extra entries.",
      corley_phone_free_morning: "Corley's “to-don't” list names time-wasters to avoid, such as “Don't waste time today on Facebook, Twitter, YouTube, etc.” Keeping your morning free of feeds is RichHabit's adaptation of that idea.",
      corley_say_no: "Corley urges protecting your time from things that don't move you forward. Saying no to one commitment a week is RichHabit's adaptation — he doesn't put it in these words.",
      corley_to_dont: "Corley argues that “The To Don't List Is More Important Than The To Do List”, with items like “Don't watch more than 1 hour of TV today.”",
      corley_time_block: "Corley describes time-blocking: “They blocked off a set amount of time at the same time every day to pursue their dream.” In his own routine, that block was early morning.",
      corley_insight: "Corley keeps lists of new words and summaries of what he studies, and reviews them each morning. Writing down one insight is RichHabit's lighter version.",
      corley_apply_idea: "In Corley's words: “It's not enough to learn something new. You must put what you learn to use.”",
      corley_learning_review: "A monthly look back helps reading turn into use, in the spirit of Corley's advice to act on what you learn. The monthly rhythm is RichHabit's suggestion.",
      corley_pay_yourself_first: "Corley's advice is to save first and live on the rest. He uses 20% as a target, and tells beginners that 10, 5 or even 1 percent is fine — the point is the habit. Treat 20% as an example to adjust.",
      corley_card_in_full: "Corley lists relying on debt to fund your standard of living as a poor habit. Paying cards in full and on time is RichHabit's practical version; no bank connection is needed — just tick it when it's done.",
      corley_money_goals: "Corley encourages setting clear money goals and keeping them in view. A monthly review is RichHabit's suggested rhythm.",
      corley_checkin: "Corley kept to his habits with a daily checklist: “In order to ensure I followed my Rich Habits, I used checklists almost on a daily basis.” Your RichHabit sheet is that checklist — this is the moment to look at it.",
      corley_weekly_review: "Corley tracked his habits with daily checklists; a weekly review isn't part of his advice. It's RichHabit's adaptation, and it uses your Weekly review page.",
      corley_monthly_growth: "Corley's message is that small daily habits add up over years: “Consistency in doing those little things keeps you growing and moving forward.” A monthly reflection helps you notice it; the rhythm is RichHabit's suggestion.",
      gates_reading_before_sleep: "In 1990 Gates told The Seattle Times: “I read an hour almost every night. It's part of falling asleep.” He added that he needs about seven hours of sleep to be creative. The 30 minutes suggested here, with 10 as the minimum, is RichHabit's adaptation — adjust it to your evenings.",
      gates_learning_note: "Gates says he takes notes as he reads: “I take tons of notes in the margins while I read.” A weekly note is RichHabit's adaptation.",
      gates_think_time: "Gates has described taking a “Think Week” at Microsoft: time away “with nothing but a big bag of books and technical papers.” A weekly block of thinking time is a small, sustainable version, and RichHabit's suggestion.",
      gates_new_field: "Gates has written about learning well beyond his own field, from online lecture courses to “Big History”, a course “so broad that it synthesizes the history of everything…”. A monthly exploration is RichHabit's adaptation.",
      gates_apply_learning: "For Gates, reading “is still the main way that I both learn new things and test my understanding.” Testing one idea against your own life is RichHabit's adaptation of that.",
      musk_challenge_assumption: "Musk contrasts first-principles thinking with reasoning by analogy, which he says “essentially means copying what other people do with slight variations.” Questioning one assumption a week puts that into practice.",
      musk_first_principles: "In his words: “boil things down to their fundamental truths and reason up from there, as opposed to reasoning by analogy.”",
      musk_focus_session: "First-principles thinking takes focus. A few unhurried sessions a week is RichHabit's adaptation — and deliberately nothing about long hours, which clear thinking doesn't need.",
      musk_delete_step: "Musk's often-described engineering “algorithm” begins by questioning every requirement and deleting any part or process you can — before simplifying, speeding up or automating what's left.",
      musk_failure_review: "Musk's approach includes speeding up the cycle of trying, learning and improving. A weekly look at what didn't work is RichHabit's personal version of that.",
      bezos_sleep_eight: "At the Economic Club of Washington in 2018, Bezos said: “I get eight hours of sleep. I prioritize it,” unless he is travelling across time zones, because “I think better, I have more energy, my mood is better.”",
      bezos_hard_before_lunch: "He told the same audience that anything mentally demanding goes in the morning: “I like to do my high-I.Q. meetings before lunch.”",
      bezos_key_decision: "Bezos wrote that to keep a “Day 1” spirit, “you have to somehow make high-quality, high-velocity decisions.” Picking the day's most important one is RichHabit's adaptation.",
      bezos_customer_view: "In his 2016 letter Bezos wrote that “obsessive customer focus is by far the most protective of Day 1 vitality.” The people a decision serves might be customers, colleagues or family.",
      bezos_door_check: "From his 2015 letter: most decisions “are changeable, reversible – they're two-way doors” and can be made quickly; the rare one-way doors deserve care.",
      bezos_simplify_process: "Bezos warned that “the process can become the thing” — good process should serve the result, not replace it. Simplifying one process a week is RichHabit's adaptation.",
      bezos_long_term_review: "Bezos's first letter to shareholders, in 1997, has a section headed “It's All About the Long Term.” A monthly look at one long-term goal is RichHabit's personal version.",
      marcus_morning_prep: "From Meditations 2.1, his private notes: begin the morning expecting difficult people, and meet them with patience. A principle he set himself, rather than a recorded routine.",
      darwin_morning_walk: "Recorded by his son Francis in the Life and Letters of Charles Darwin (1887).",
      hemingway_morning_writing: "Hemingway's own account, in his 1958 interview with The Paris Review.",
      darwin_daily_walk: "Described by his son Francis: a daily round of the Sandwalk, used as thinking time.",
      buffett_reading_block: "Buffett's own estimate, from a 2015 interview. The hours aren't the point — a regular reading block that fits your day is.",
      seneca_evening_review: "Seneca describes his nightly self-examination in On Anger (3.36).",
    } as Record<string, string>,
    /** The collections' own words. Only the featured ones have an "About" section. */
    collections: {
      franklin: {
        title: "The 13 Virtues",
        person: "Benjamin Franklin",
        idea: "Thirteen virtues, one week's attention each, checked every evening in a little book.",
        bio: "Benjamin Franklin (1706–1790) was a printer, writer, scientist and inventor who also served as postmaster and ambassador — one of the Founding Fathers of the United States.",
        philosophy: "In his Autobiography he lists thirteen virtues, each with a short precept, and describes giving “a week's strict attention to each of the virtues successively”, marking his faults every evening.",
        useful: "It turns character into small, concrete daily checks. Franklin admits he “fell far short” of perfection but saw his faults diminish — a forgiving method, not a test.",
        links: ["The Autobiography (Project Gutenberg)", "The Franklin Institute: Benjamin Franklin FAQ"],
      },
      corley: {
        title: "Rich Habits",
        person: "Thomas C. Corley",
        idea: "Small daily routines for health, learning, focus and money, kept up over years.",
        bio: "Tom Corley describes himself as an accountant and financial planner who runs a financial services firm in New Jersey. His books, starting with Rich Habits (2010), draw on interviews he says he held with wealthy and poor people between 2004 and 2007 — his own research, not independently reviewed.",
        philosophy: "Habits add up: “Consistency in doing those little things keeps you growing and moving forward.”",
        useful: "His ideas are practical and easy to try. The five themes here are RichHabit's grouping, and the statistics from his studies are deliberately left out.",
        links: ["Rich Habits: Tom Corley's site", "About Tom Corley"],
      },
      gates: {
        title: "Lifelong Learning",
        person: "Bill Gates",
        idea: "Read widely, take notes, make room to think, and stay curious beyond your own field.",
        bio: "Bill Gates (born 1955) co-founded Microsoft with Paul Allen in 1975 and chairs the Gates Foundation. He shares book reviews and reading lists on his blog, Gates Notes.",
        philosophy: "Reading, in his words, “is still the main way that I both learn new things and test my understanding.”",
        useful: "Learning compounds when it's regular and active: reading, writing notes, and time to think. The schedules here are RichHabit's suggestions, not his routine.",
        links: ["Gates Foundation: Bill Gates", "Open Culture (2016): “about a book a week”"],
      },
      musk: {
        title: "First-Principles Thinking",
        person: "Elon Musk",
        idea: "Break problems down to what's actually true, question requirements, and keep simplifying.",
        bio: "Elon Musk (born 1971) is an engineer and entrepreneur who founded SpaceX in 2002 and has led Tesla as chief executive since 2008.",
        philosophy: "At TED in 2013 he described first-principles reasoning: “boil things down to their fundamental truths and reason up from there, as opposed to reasoning by analogy.”",
        useful: "It's a way to think more clearly about hard problems, at any pace. These habits borrow the thinking method only — nothing here is about working long hours.",
        links: ["TED2013 conversation (transcript)", "Starbase interview, Everyday Astronaut (2021)"],
      },
      bezos: {
        title: "Long-Term Thinking",
        person: "Jeff Bezos",
        idea: "Think in years, sort decisions by how reversible they are, and protect the sleep good judgement needs.",
        bio: "Jeff Bezos (born 1964) founded Amazon in 1994, led it as chief executive until 2021, and is now its executive chair. He also founded the spaceflight company Blue Origin.",
        philosophy: "His first letter to shareholders, in 1997, has a section headed “It's All About the Long Term.” He has described deciding to start Amazon with a “regret minimization framework”, imagining himself at 80, looking back.",
        useful: "These are thinking habits for any job or household: telling reversible “two-way door” decisions from the rare one-way ones, a monthly look at long-term goals, and enough sleep to think well.",
        links: ["Amazon: letters to shareholders", "Economic Club of Washington (2018): transcript", "Academy of Achievement interview (2001)"],
      },
      history: {
        title: "From History",
        person: "Philosophers, writers and investors",
        idea: "Practices documented in their own words or by people who saw them.",
      },
    } as Record<string, CollectionText>,
    /** Groups inside a collection. Franklin's virtue groups use the virtue's own name. */
    groups: {
      method: "Franklin's own method",
      corley_morning: "Golden Morning Routine",
      corley_attention: "Protect Your Attention",
      corley_learning: "Read and Apply Knowledge",
      corley_money: "Financial Management",
      corley_consistency: "Long-Term Consistency",
    } as Record<string, string>,
    /** How directly a habit comes from its person, in plain words. */
    attribution: {
      documented: "Documented practice",
      principle: "Their own advice",
      adaptation: "RichHabit adaptation",
    },
    attributionHint: {
      documented: "They did this themselves — in their own words, or as recorded by someone who saw it.",
      principle: "They recommend this in their own words.",
      adaptation: "Inspired by their ideas. The habit and its schedule are RichHabit's suggestion.",
    },
    goals: {
      career_growth: "Career growth",
      health_energy: "Health & energy",
      learning: "Learning",
    } as Record<string, string>,
    units: {
      min: "min",
      glasses: "glasses",
      tasks: "tasks",
      hr: "hr",
      times: "times",
    } as Record<string, string>,
  },
  trends: {
    up: "Improving",
    down: "Slipping",
    flat: "Steady",
    new: "Too early",
  },
  encouragement: {
    nothingScheduled: "Nothing scheduled today. Rest counts too.",
    startAgain: "Start again today. One habit is enough to turn it around.",
    firstIsHardest: "First one is the hard one. Pick the easiest and go.",
    allDone: "Every habit done. That's the whole day's work on yourself, finished.",
    strongDay: "Strong day. A couple left if you want them.",
    underway: "Underway. Consistency beats a perfect record.",
  },
  today: {
    todayLabel: "Today",
    /** The quiet link from the day's header to its progress on Insights. */
    seeProgress: "See today's progress",
    avoid: "Avoid",
    daysRunning: (n: number) => (n === 1 ? "1 day running" : `${n} days running`),
    // A "times a week" habit: progress toward the week's target, and what it needs now.
    weekProgress: (done: number, target: number) => `${done} of ${target} this week`,
    // A share of the period that rounds to nothing (a late start) — say why, and that it is not a miss.
    startsNextWeek: "Counts from next week · started late this week",
    monthProgress: (done: number, target: number) => `${done} of ${target} this month`,
    startsNextMonth: "Counts from next month · started late this month",
    statusOnTrack: "On track",
    statusDue: "Due today",
    statusBehind: "Behind",
    statusCompleted: "Completed",
    highPriority: "High priority",
    note: "Note",
    currentStreak: "Current streak",
    streakDays: (n: number) => `${n}d`,
    done: "Done",
    nothingScheduled: "Nothing scheduled",
    nothingScheduledBody: "Add a habit or change a schedule to see it here.",
    /** §20. A small win counts; it just is not the target. */
    minimumMet: "Minimum",
    targetMet: "Target",
    progress: (value: number, target: number, unit: string) =>
      `${value} / ${target} ${unit}`.trim(),
    underLimit: (target: number, unit: string) => `under ${target} ${unit}`.trim(),
    overLimit: (value: number, target: number, unit: string) =>
      `${value} of ${target} ${unit}`.trim(),
    addOne: "Add one",
    removeOne: "Remove one",
    anchorPrefix: (anchor: string) => `After ${anchor}`,
    logTitle: "Log this habit",
    logValue: "How much?",
    logNote: "Note",
    logNoteHint: "Only for today's entry — the day's notes are at the bottom.",
    logOpen: "Add a note or amount",
    logSave: "Save entry",
    notesTitle: "Notes for this day",
    notesPlaceholder: "What shaped the day? Anything worth remembering.",
    check: (name: string) => `Check ${name}`,
    uncheck: (name: string) => `Uncheck ${name}`,
  },
  /** §12/§14. Customising the checklist without leaving Today. */
  customise: {
    addHabit: "Add habit",
    addTo: (section: string) => `Add to ${section}`,
    fromLibrary: "Explore templates",
    createOwn: "Create my own",
    /** Under a template: who, where, when — never a promise. */
    sourcePrefix: "Source: ",
    previewHint: "Opens the habit form first, so you can adjust everything before it joins your sheet.",
    searchPlaceholder: "Search habits, people or ideas",
    showAll: "All times of day",
    showSection: (section: string) => `${section} only`,
    build: "Build",
    avoid: "Avoid",
    noMatches: "No templates match. Try another word or goal.",
    alreadyOnSheet: "Already on your sheet",
    inBacklog: "In your backlog",
    /* ── The Template Library (Explore templates) ── */
    featured: "Featured collections",
    everyday: "Everyday habits",
    goalFilter: "Filter by goal",
    goalAll: "All",
    goals: {
      learning: "Learning",
      finance: "Finance",
      health: "Health",
      productivity: "Productivity",
      growth: "Personal growth",
    },
    habitCount: (n: number) => (n === 1 ? "1 habit" : `${n} habits`),
    resultCount: (n: number) => (n === 1 ? "1 template" : `${n} templates`),
    allTemplates: "All templates",
    aboutPerson: "About this person",
    aboutWho: "Who",
    aboutIdea: "Big idea",
    aboutUseful: "Why it may help",
    sources: "Sources",
    why: "Why this habit?",
    openSource: "Read the source",
    selectAll: (n: number) => `Select all (${n})`,
    clearCollection: "Clear selection",
    selectHint: "Nothing is added until you review your choices.",
    allTaken: "Everything here is already on your sheet.",
    selectedCount: (n: number) => (n === 1 ? "1 selected" : `${n} selected`),
    reviewSelected: (n: number) => `Review (${n})`,
    clearSelected: "Clear",
    reviewTitle: (n: number) => (n === 1 ? "Review 1 habit" : `Review ${n} habits`),
    reviewIntro: "Adjust anything you like before adding. You can change it all later, too.",
    reviewMany: (n: number) =>
      `That's ${n} new habits at once. Starting with a few usually makes them easier to keep — the rest can wait in your backlog.`,
    keepBrowsing: "Keep browsing",
    howOften: "How often",
    change: "Change",
    doneEditing: "Done",
    allOptions: "All options",
    removePick: "Remove",
    addToToday: (n: number) => (n === 1 ? "Add to Today" : `Add ${n} to Today`),
    saveToBacklog: (n: number) => (n === 1 ? "Save to backlog" : `Save ${n} to backlog`),
    destinationHint: "Today puts them on your checklist now. Your backlog keeps them as Planned until you're ready.",
    /** Under a weekly or monthly choice in the review: the late-start rule, before it surprises anyone. */
    periodHint: {
      week: "Counted by calendar week. Start late in a week and it counts from the next one — you can tick it any time.",
      month: "Counted by calendar month. Start late in a month and it counts from the next one — you can tick it any time.",
    },
    saving: "Saving…",
    resultAdded: (n: number) => (n === 1 ? "1 habit added to Today." : `${n} habits added to Today.`),
    resultSaved: (n: number) =>
      n === 1 ? "1 habit saved to your backlog. You'll find it in Refine my habits." : `${n} habits saved to your backlog. You'll find them in Refine my habits.`,
    resultLimit: (n: number, limit: number) =>
      `Your plan allows ${limit} active habits, so ${n === 1 ? "1 wasn't" : `${n} weren't`} added to Today.`,
    saveRestToBacklog: (n: number) => (n === 1 ? "Save it to backlog instead" : `Save these ${n} to backlog instead`),
    resultFailed: (n: number) =>
      `${n === 1 ? "1 habit" : `${n} habits`} couldn't be saved. Check your connection and try again — nothing will be added twice.`,
    tryAgain: "Try again",
    openSpending: "Open Spending",
    openReview: "Open weekly review",
    duplicateTitle: "You already have this one",
    duplicateBody: (name: string) =>
      `“${name}” is already on your sheet. Adding it again means two rows to tick and a score counted twice.`,
    addAnyway: "Add it anyway",
    added: (name: string) => `Added ${name}`,

    /** The row menu. */
    menuTitle: "Habit options",
    logEntry: "Add a note or amount",
    edit: "Edit habit",
    moveTo: "Move to",
    moveUp: "Move up",
    moveDown: "Move down",
    pause: "Pause",
    resume: "Resume",
    pauseHint: "Stops appearing on Today. Nothing is lost.",
    replace: "Replace with something else",
    replaceHint: "Keeps this one and its history, and starts the new one in its place.",
    replacing: (name: string) => `Replacing “${name}”`,
    remove: "Remove from my checklist",
    removeHint: "Stops tracking it. Your history stays, so Insights and the coach still see it.",
    removeTitle: "Remove from your checklist?",
    removeBody: (name: string) =>
      `“${name}” will stop appearing on Today. Its record is kept — every day you completed it still counts in Insights, and you can put it back later from My habits.`,
    removeConfirm: "Remove it",
    deleteForever: "Delete permanently",
    deleteHint: "Erases the habit and everything recorded against it.",
    deleteTitle: "Delete permanently?",
    deleteBody: (name: string) =>
      `“${name}” and anything recorded against it will be erased. This cannot be undone.`,
    deleteConfirm: "Delete permanently",
    deleteUnavailable: (days: number) =>
      days === 1
        ? "There is 1 day of history here, so this can only be removed, not erased."
        : `There are ${days} days of history here, so this can only be removed, not erased.`,
    reorderHint: "Drag to reorder, or use the habit's menu.",
    dragHandle: "Reorder",
  },
  habits: {
    all: "All",
    newHabit: "New habit",
    editHabit: "Edit habit",
    addHabit: "Add habit",
    saveChanges: "Save changes",
    noneTitle: "No habits here yet",
    noneBody: "Start with one or two. Changing everything at once is why most attempts don't hold.",
    addFirst: "Add your first habit",
    fieldHabit: "Habit",
    habitPlaceholder: "Read for learning",
    fieldDescription: "Description",
    descriptionHint: "Optional — what counts as done?",
    descriptionPlaceholder: "Non-fiction, anything that teaches me something",
    fieldTimeOfDay: "Time of day",
    fieldKind: "Kind",
    kindBuild: "Habit to build",
    kindDrop: "Habit to drop",
    fieldFrequency: "Frequency",
    freqDaily: "Every day",
    freqDays: "Certain days",
    freqTimes: "X times a week",
    perWeek: (n: number) => `${n} / week`,
    timesAWeek: (n: number) => `${n}× a week`,
    freqEvery: "Every few days",
    freqMonthTimes: "X times a month",
    freqMonthDays: "Days of the month",
    everyNDays: (n: number) => `Every ${n} days`,
    intervalLabel: "Repeat every",
    intervalUnit: "days",
    intervalAria: "Days between each time",
    anchorLabel: "Counting from",
    everyHint: "The rhythm counts from this day, so a missed day never moves the next one.",
    perMonth: (n: number) => `${n} / month`,
    timesAMonth: (n: number) => `${n}× a month`,
    monthTimesHint: "Stays on your list each day until this month's count is reached — like times a week. Started late in a month, it counts from the next one.",
    onMonthDays: (days: number[]) => `On the ${days.map((d) => {
      const tens = d % 100, last = d % 10;
      const suffix = tens >= 11 && tens <= 13 ? "th" : last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th";
      return `${d}${suffix}`;
    }).join(", ")}`,
    monthDaysHint: "In a shorter month, the 29th, 30th and 31st fall on its last day.",
    scheduleProblem: {
      pickWeekday: "Pick at least one day of the week.",
      pickMonthDay: "Pick at least one day of the month.",
      intervalRange: "Choose every 2 to 365 days.",
      anchorMissing: "Choose the day to count from.",
      monthTimesRange: "Choose 1 to 31 times a month.",
    },
    // No full stop: the store appends ". That change wasn't saved."
    repeatUnavailable: "This way of repeating isn't available yet — please choose another for now",
    /* These take the item's template KEY and name it from this dictionary, so
       the bilingual one reads "…: Order · 本周美德：秩序" rather than nesting a
       bilingual name inside each half. */
    virtueOfWeek: (key: string): string => `Virtue of the week: ${en.templates.habits[key] ?? key}`,
    rotationThisWeek: (key: string, n: number, of: number): string =>
      `This week: ${en.templates.habits[key] ?? key} · week ${n} of ${of}`,
    rotationExplain: "One virtue a week, in Franklin's order. After the 13th week the cycle starts again with Temperance. A missed day is just that day — next week still moves on to the next virtue, and every past week keeps the virtue it had.",
    rotationStartWith: "Start this week with",
    rotationUnavailable: "Rotating habits aren't available yet — please try again later",
    fieldTracking: "How is it measured?",
    trackingBoolean: "Did it",
    trackingCount: "A number of times",
    trackingDuration: "Minutes",
    trackingQuantity: "An amount",
    trackingInterval: "Times through the day",
    trackingMaximum: "Stay under a limit",
    trackingAvoidance: "Didn't do it",
    fieldMinimum: "Minimum",
    minimumHint: "What still counts on a bad day. Leave empty if only the target counts.",
    designTitle: "Making it happen",
    fieldAnchor: "After I…",
    anchorHint: "An existing habit this attaches to — \"pour my morning coffee\".",
    anchorPlaceholder: "pour my morning coffee",
    fieldEnvironment: "What makes it easier",
    environmentPlaceholder: "Running shoes by the door",
    fieldFriction: "What gets in the way of the old habit",
    frictionPlaceholder: "Phone charges in the kitchen overnight",
    fieldTarget: "Target",
    fieldUnit: "Unit",
    unitPlaceholder: "min",
    fieldPriority: "Priority",
    priorityHint: "Higher priority habits count for more in your score.",
    priorityFull: { low: "Low priority", medium: "Medium priority", high: "High priority" },
    fieldGoal: "Goal it supports",
    noGoal: "Not linked to a goal",
    fieldStartDate: "Start date",
    statusHint: "Only active habits appear on Today and count towards your score.",
    statusActive: "Active",
    statusPaused: "Paused",
    statusEstablished: "Established",
    statusRetired: "Retired",
    statusCandidate: "Candidate",
    statusRecommended: "Recommended",
    statusPlanned: "Planned",
    fieldStatus: "Status",
    active: "Active",
    paused: "Paused",
  },
  week: {
    checklist: "Seven-day checklist",
    intro: "Work one phase at a time. Give a phase seven days before adding the next, and keep the earlier ones running.",
    noHabitsInPhase: "No habits in this phase yet.",
    habitColumn: "Habit",
    phaseResult: (c: CategoryKey) => `${CAT[c]} · seven-day result`,
    completion: "Completion",
    scheduledOf: (done: number, scheduled: number) => `${done} of ${scheduled} scheduled`,
    longestStreak: "Longest streak",
    daysInARow: "days in a row",
    strongest: "Strongest habit",
    weakest: "Weakest habit",
    allPhases: "All phases this week",
    focusNext: "Focus for next week",
    holdingAt: (c: CategoryKey, pct: number) =>
      `${CAT[c]} is holding at ${pct}%. Ready to add the next phase.`,
    keepSteady: (name: string) =>
      `Keep this phase steady and put "${name}" first — it's the one slipping.`,
    cellLabel: (name: string, date: string) => `${name} on ${date}`,
  },
  insights: {
    /*
     * Completed priorities, looked back on. The titles are the user's own words,
     * shown exactly as written; the counts are theirs alone and never shared.
     */
    accomplishments: {
      title: "Accomplishments",
      month: "Month",
      year: "Year",
      thisMonth: "accomplished this month",
      inMonth: (month: string) => `accomplished in ${month}`,
      thisYear: "accomplished this year",
      inYear: (year: string) => `accomplished in ${year}`,
      today: (n: number) => `Today ${n}`,
      previousMonth: "Previous month",
      nextMonth: "Next month",
      previousYear: "Previous year",
      nextYear: "Next year",
      byDay: (n: number, month: string) => `${n} accomplished in ${month}, shown by day`,
      byMonth: (n: number, year: string) => `${n} accomplished in ${year}, shown by month`,
      openMonth: (month: string, n: number) => `${month}: ${n}. Show this month`,
      chooseMonth: "Choose a month to see what you accomplished.",
      yours: "Your accomplishments",
      emptyMonth: (month: string) => `Nothing crossed off in ${month} yet. Completed priorities gather here.`,
      emptyYear: (year: string) => `Nothing crossed off in ${year} yet. Completed priorities gather here.`,
    },
    score: "Rich habit score",
    /** Insights' first section: the day's dial and counts, moved from Rich Habits. */
    todayProgress: "Today · Daily progress",
    sevenDays: "7 days",
    thirtyDays: "30 days",
    ninetyDays: "90 days",
    currentStreak: "Current streak",
    perfectDays: "Perfect days",
    habitsCompleted: "Habits completed",
    lastWeeks: (n: number) => `Last ${n} weeks`,
    byTimeOfDay: "By time of day · 30 days",
    habitCount: (n: number) => (n === 1 ? "1 habit" : `${n} habits`),
    perHabit: "Per habit · 30 days",
    noActiveHabits: "No active habits.",
    doneCount: (done: number, scheduled: number) => `${done}/${scheduled} done`,
    missedCount: (n: number) => `${n} missed`,
    streakCount: (n: number) => `${n}d streak`,
    bestCount: (n: number) => `best ${n}d`,
    correlationsTitle: "What tracks with a good day",
    correlationLabels: {
      sleepNextDay: "Sleep → next day",
      sleepSameDay: "Sleep → same day",
      cardioSameDay: "Cardio minutes → same day",
      waterSameDay: "Water → same day",
      gymSameDay: "Gym day → same day",
    } as Record<string, string>,
    basedOn: (n: number) => `${n} days`,
    readingPositive: "moves with your completion",
    readingNegative: "moves against your completion",
    readingNone: "no clear relationship",
    correlationFootnote: "Relationships, not causes. More days make these steadier.",
    patterns: "Patterns",
    noCorrelation: "Log sleep in Metrics for a couple of weeks and the relationship between sleep and the next day's completion will show up here.",
  },
  suggestions: {
    needData: "Give it a few days of tracking — patterns need data before they mean anything.",
    worst: (name: string, pct: number) =>
      `"${name}" is landing ${pct}% of the time. Consider shrinking it or moving it earlier in the day.`,
    best: (name: string, pct: number) =>
      `"${name}" is solid at ${pct}%. It's a good anchor to stack a newer habit onto.`,
    weakestWindow: (c: CategoryKey, pct: number) =>
      `${CAT[c]} is your weakest window (${pct}%). One habit there will move the score more than three anywhere else.`,
    tooMany: "You're tracking a lot at once. The phased approach works better: pick one window and let it settle.",
    allGood: "Nothing looks off. Keep the current set steady for another week.",
  },
  coach: {
    title: "Ask RichHabit",
    subtitle: "Answered from the data on this screen — your habits, goals and metrics.",
    placeholder: "Ask about your habits, progress, or what to improve next...",
    ask: "Ask",
    thinking: "Thinking…",
    reading: "Reading your last 90 days…",
    tryAgain: "Try again",
    emptyAnswer: "The coach returned an empty answer.",
    failed: (status: number) => `Coach request failed (${status}).`,
    wentWrong: "Something went wrong.",
    suggestions: [
      "What habit should I focus on next?",
      "Why is my rich habit score not improving?",
      "Which habits are helping me most?",
      "What should I change this week?",
    ],
  },
  refine: {
    title: "Refine my habits",
    note: "Name what you'd like to change. Nothing here is tracked until you put it on your sheet.",
    stepBehaviours: "What would you like to change?",
    intro: "Describe it in your own words — what you actually do, not what a habit should be called. Your wording is kept exactly as you write it.",
    placeholder: "e.g. I sit for hours without moving",
    kindLabel: "Which is it?",
    kindAvoid: "Something I do too much",
    kindGood: "Something I want to start",
    importance: "How much does it matter?",
    add: "Add to my backlog",
    backlogTitle: "Backlog",
    backlogNote: "Candidates and suggestions waiting for a decision. None of these are on your sheet.",
    emptyTitle: "Nothing in the backlog",
    emptyBody: "Anything you name here waits until you choose to track it.",
    activate: "Put on my sheet",
    activated: "On your sheet",
    remove: "Remove",
    onSheet: (n: number) => `${n} on your sheet`,
    inBacklog: (n: number) => `${n} waiting`,
    capturedAs: "Your words, kept as written",
    suggest: "Suggest replacements",
    suggesting: "Thinking…",
    suggestNote: "For each behaviour above, one habit you could track instead. Nothing is added to your sheet — you decide.",
    suggestNone: "Nothing new to suggest. Add a behaviour first.",
    suggestFailed: "Couldn't get suggestions just now. Your backlog is unchanged.",
    suggested: (n: number) => (n === 1 ? "1 suggestion added below" : `${n} suggestions added below`),
    replacesLabel: (behaviour: string) => `Instead of: ${behaviour}`,
    whySuggested: "Why this",

    // §12 — the four groups the workspace keeps apart.
    groupBehaviours: "Behaviours I want to change",
    groupBehavioursNote: "In your words. Not tracked.",
    groupRecommended: "Recommended",
    groupRecommendedNote: "Suggestions waiting for your decision.",
    groupLibrary: "From the library",
    groupLibraryNote: "Templates you've picked out but not started.",
    groupFocus: "My focus habits",
    groupFocusNote: "What you're actually tracking right now.",
    groupEmpty: "Nothing here yet.",

    // §13 — pacing, not a rule.
    focusCount: (n: number) => `${n} active`,
    tooManyTitle: "That's a lot at once",
    tooMany: (n: number) => `You're tracking ${n} habits. Changes tend to hold better a few at a time — the rest keep just as well in the backlog.`,

    libraryTitle: "Habit library",
    libraryNote: "Optional templates. Adding one puts it in your backlog, not on your sheet.",
    libraryBrowse: "Browse the library",
    libraryHide: "Hide the library",
    libraryAdd: "Add",
    libraryAdded: "In your backlog",
    libraryOnSheet: "Already on your sheet",
    libraryMinTarget: (min: string, target: string) => `Start at ${min}, aim for ${target}`,
    libraryTargetOnly: (target: string) => `Aim for ${target}`,
    domains: {
      health: "Health", career: "Career", learning: "Learning",
      money: "Money", relationships: "Relationships", home: "Home",
    } as Record<string, string>,
  },

  spending: {
    title: "Spending awareness",
    intro: "Write down what you spent, and see where it actually goes. This is for noticing — it isn't a budget, and nothing here scores you.",
    addTitle: "Record a purchase",
    amount: "Amount",
    // Its own word rather than reusing the habit form's "Start date", which is
    // about when a habit begins and reads wrong against a purchase.
    date: "Date",
    what: "What was it?",
    whatPlaceholder: "Coffee, train fare, new headphones",
    category: "Category",
    needWant: "Need or want?",
    need: "Need",
    want: "Want",
    plannedLabel: "Did you plan it?",
    planned: "Planned",
    unplanned: "Unplanned",
    notes: "Notes",
    save: "Record it",
    recent: "Recent",
    emptyTitle: "Nothing recorded yet",
    emptyBody: "Add a purchase or two. The pattern shows up faster than you'd think.",
    thisMonth: "This month",
    lastMonth: "Last month",
    total: "Total",
    byCategory: "Where it went",
    share: (pct: string) => `${pct}%`,
    plannedShare: "Planned",
    unplannedShare: "Unplanned",
    wantShare: "Wants",
    change: (pct: string) => `${pct}% vs last month`,
    noComparison: "Not enough history to compare months yet.",
    remove: "Remove",
    categories: {
      housing: "Housing", food: "Food", shopping: "Shopping",
      transport: "Transport", travel: "Travel", entertainment: "Entertainment",
      personal_care: "Personal care", education: "Education",
      gifts: "Gifts", other: "Other",
    } as Record<string, string>,
  },

  more: {
    /** The window between a deploy and the migration that follows it. */
    prefsNotDeployed: "That setting isn't available yet — this account's database is still being updated. Nothing was changed; try again shortly.",
    links: {
      /* Every habit on the sheet, and the way in to change one. It answered at
         /habits until Rich Habits took that address. */
      habits: { label: "My Habit Sheet", note: "Every habit you keep, and how each is going" },
      refine: { label: "Refine my habits", note: "Name what to change, then choose what to track" },
      awareness: { label: "Habit awareness", note: "Log a normal day, then grade it" },
      goals: { label: "Goals", note: "What each habit is actually for" },
      metrics: { label: "Health metrics", note: "Weight, sleep, cardio, water" },
      spending: { label: "Spending awareness", note: "Where the money actually goes" },
      stacks: { label: "Habit stacking", note: "Attach new habits to old ones" },
      review: { label: "Weekly review", note: "Close the week, set next week's focus" },
    },
    preferences: "Preferences",
    appearance: "Appearance",
    appearanceHint: "Follows your choice, not the system",
    light: "Light",
    dark: "Dark",
    weightedScore: "Weighted score",
    weightedHint: "High-priority habits count for more",
    on: "On",
    off: "Off",
    language: "Language",
    languageHint: "Changes the app, and the coach answers in it too",
    account: "Account",
    memberSince: "Member since",
    activeHabits: "Active habits",
    daysRecorded: "Days recorded",
    adminLink: "Product analytics",
    adminNote: "Admin only",
    signInMethods: "Sign-in methods",
    googleConnectedAs: (email: string) => `Google — connected as ${email}`,
    googleConnectedPlain: "Google — connected",
    googleNotConnected: "Google — not connected",
    connectGoogle: "Connect Google",
    googleJustConnected: "Google is connected.",
    googleNotYours: "That Google account belongs to a different RichHabit account, so it was not connected.",
    passwordSet: "Password — set",
    passwordNotSet: "Password — not set. Use “Forgot password?” on the sign-in screen to create one.",
    changePassword: "Change password",
    changePasswordNote: "Choose a new one for signing in",
    username: "Username",
    /* Said explicitly because a rename looks risky from the outside: people
       hesitate over anything that might cost them their streak. */
    usernameHint: "The only name shown on Community Progress. Changing it keeps all your habits, history and ranking.",
    usernameSave: "Save",
    usernameSaved: "Username updated.",
    yourData: "Your data",
    yourDataHint: "A full copy of everything in this account, as JSON.",
    exportJson: "Export JSON",
    signOut: "Sign out",
    signOutHint: "Ends this session on this device.",
    /**
     * The confirmation exists to say what sign-out does *not* do. People
     * hesitate over it because they half-expect to lose their history.
     */
    signOutTitle: "Sign out?",
    signOutBody: "Your habits, history and notes stay exactly as they are. Sign back in any time with the same email.",
    signOutConfirm: "Sign out",
    signingOut: "Signing out…",
    signOutFailed: "Couldn't sign out — check your connection and try again.",
    footer: "Awareness → grade → select → track → review.",
    footerTwo: "Missing a day is data, not failure.",
  },

  /**
   * §Community. Company, not competition — the wording stays away from
   * winning, beating and losing, and nobody is ever described relative to
   * the person above them.
   */
  /**
   * §20. The Today rail's two views: your own month, and the board.
   *
   * Three percentages exist within a screen of each other and each measures
   * something different, so each says which span it covers rather than leaving
   * the reader to assume they should agree.
   */
  progress: {
    /* Habits and accomplishments, side by side and never combined. */
    habitsLabel: "habits",
    accomplishedLabel: "accomplishments",
    /* The chart's legend, which is also the reading for the chosen day. */
    legendHabits: "Habits",
    legendAccomplishments: "Accomplishments",
    chartLabel: (month: string) => `Habits and accomplishments by day, ${month}. Use the arrow keys to read each day.`,
    /** The headline figure and the chart under it. */
    monthToDate: "This month so far",
    thisMonth: (month: string) => `${month} · day by day`,
    noneYet: "Tick a few habits and your month will start drawing itself here.",
    tooEarly: "One more day and a line appears here.",
    /* Says the span, because this is the whole month — today alone is the
       dial at the top of Insights. Two different numbers, both correct, so
       the reader is told which is which. */
    explain: "Each day this month: the line is habit completion on a 0–100% scale, and the columns count priorities completed that day, on their own scale. Today alone is the dial above.",
    scheduledNone: "Nothing was scheduled on the greyed days.",
    /* Shown only when the two figures in this card can actually differ —
       i.e. when the reader weights their own habits by priority and the
       board does not. Silent otherwise, because then there is nothing to
       reconcile. */
    weightedNote: "Yours counts priority weighting. The board measures everyone unweighted.",

    /** The privacy control, in the card and in settings. */
    showMe: "Show me in Community ranking",
    showMeHint: "Off means your name, percentage and rank are not shown to anyone else, and you are not counted in the participants. Your own habits, history and progress are unaffected.",
    hidden: "You are not shown on the board.",
    hiddenHint: "Turn the setting above back on whenever you like — nothing is lost while you are hidden.",
  },

  community: {
    /* Two rankings, never combined: habits are consistency, accomplishments are
       what got done. Each has its own list, rank and eligibility, and nothing
       adds them together. Plain words, no medals or "top performer". */
    /** The two embedded boards' names — Rich Habits' and Priority Compass's. */
    boardHabitsMonthly: "Monthly Habit Accomplishments",
    boardPrioritiesMonthly: "Monthly Priority Accomplishments",
    habitRanking: "Habit Ranking",
    accomplishmentRanking: "Accomplishment Ranking",
    /** The shorter names the 300px rail's switch uses. */
    accomplishmentsThisMonth: "Accomplishments this month",
    thisMonth: "This month",
    accomplishmentsCount: (n: number) => `${n} ${n === 1 ? "accomplishment" : "accomplishments"}`,
    accomplishmentsUnit: (n: number): string => (n === 1 ? "accomplishment" : "accomplishments"),
    accomplishmentBasis: "Priorities completed so far this month, counted on the day each was completed. Every quadrant counts the same",
    accomplishmentPrivacy: "Only the number is shared, never what the priorities were",
    separateRankings: "Each ranking stands on its own. There is no combined score.",
    accomplishmentNotRanked: "Complete a priority this month and you will appear here.",
    accomplishmentEmpty: "No one has completed a priority this month yet.",
    title: "Community Progress",
    /* Named "live" because it is: the board is recomputed from habit records
       on every visit, so it moves as people tick things off during the day
       and starts fresh on the 1st. */
    liveRanking: "Live Ranking",
    /** The rail's way through to the full board. */
    monthNames: ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"],
    /* Says the window in the label itself. Today's dial (Insights) and this
       figure are different measurements over different spans, and a month's
       number read beside a day's looks like a stale copy of it unless the
       label rules that out. */
    myCompleteness: "Month-to-date completeness",
    /** The same thing, short enough for the 300px rail on Today. */
    monthToDate: "Month to date",
    myRank: "My ranking",
    activeUsers: "Active users",
    /* Appended to the real username rather than replacing it, so you can see
       how you appear to everyone else while still finding your own row. */
    youTag: "(You)",
    month: "Month",
    updated: "Last updated",
    /** Under "Today" on the habit card when nothing is scheduled today. */
    noneToday: "None scheduled",
    /** Short enough for a third of a 300px rail card. */
    rankOf: (rank: number, total: number) => `#${rank} of ${total}`,
    basis: "Completed check-ins out of those scheduled so far this month — not today's score",
    /* Said plainly because the number can differ from the weighted one on
       their own screens, and an unexplained discrepancy reads as a bug. */
    unweightedNote: "Everyone is measured unweighted, so the comparison is like for like",
    noneScheduled: "You have no scheduled check-ins yet this month, so there is nothing to compare yet. Add or schedule a habit and you will appear here.",
    empty: "No one has scheduled check-ins this month yet.",
    unavailable: "Community progress is unavailable right now.",
  },

  goals: {
    intro: "A habit you can't attach to a goal is usually a habit you'll drop.",
    noneTitle: "No goals yet",
    noneBody: "Name the outcome first, then decide which habits actually serve it.",
    thirtyDay: "30-day",
    noHabitsYet: "No habits point at this goal yet.",
    editGoal: "Edit goal",
    newGoal: "New goal",
    addAHabit: "Add a habit",
    saveGoal: "Save goal",
    notLinked: "Not linked to a goal",
    fieldGoal: "Goal",
    goalPlaceholder: "Career growth",
    fieldArea: "Area",
    fieldWhy: "Why it matters",
    whyHint: "You'll read this on the days you don't feel like it.",
  },

  metrics: {
    logFor: "Log for",
    weight: "Weight",
    calories: "Calories",
    sleep: "Sleep",
    water: "Water",
    cardio: "Cardio",
    unitKcal: UNIT.kcal,
    unitHours: UNIT.hours,
    unitGlasses: UNIT.glasses,
    unitMinutes: UNIT.minutes,
    gymDay: "Gym day",
    cardioDay: "Cardio day",
    trends: "Trends",
    spanWeek: "Week",
    spanMonth: "Month",
    spanYear: "Year",
    noEntries: "no entries",
    avg: (value: string, unit: UnitKey) => `avg ${value} ${UNIT[unit]}`.trim(),
    gymDays: "Gym days",
    cardioDays: "Cardio days",
    goalWeight: "Goal weight",
    goalWeightHint: "Used only to show the gap — no targets, no nagging.",
    latest: (value: string, gap: string) => `Latest ${value} · ${gap} from goal`,
  },

  awareness: {
    stepOne: "Step one",
    heading: "Write down the day you actually have",
    intro: "Log an ordinary day hour by hour before judging any of it. Then mark each activity as good, bad, or neutral. The ones you mark become the raw material for the habits you keep and the ones you drop.",
    logged: (n: number) => `${n} logged`,
    goodCount: (n: number) => `${n} good`,
    badCount: (n: number) => `${n} bad`,
    neutralCount: (n: number) => `${n} neutral`,
    addActivity: "Add an activity",
    activityPlaceholder: "Checked email",
    durationPlaceholder: "20 min",
    contextPlaceholder: "Where / with whom",
    addToLog: "Add to log",
    emptyTitle: "The log is empty",
    emptyBody: "Start with when you woke up. Add the rest as the day goes — accuracy matters more than completeness.",
    good: "Good",
    bad: "Bad",
    makeHabit: "Make a habit",
  },

  stacks: {
    intro: "Attach something new to something you already do without thinking.",
    noneTitle: "No stacks yet",
    noneBody: "Example: after I pour my morning coffee, I read for ten minutes.",
    sentence: (trigger: string, next: string) => ({ trigger, next }),
    afterI: "After I",
    iWill: ", I will",
    period: ".",
    title: "Habit stack",
    saveStack: "Save stack",
    fieldTrigger: "Trigger — something you already do",
    writeInstead: "Write it in instead",
    triggerPlaceholder: "Pour my morning coffee",
    fieldNew: "New habit",
    newPlaceholder: "Read for ten minutes",
    fieldTime: "Time",
    fieldPlace: "Place",
    placePlaceholder: "Kitchen table",
  },

  review: {
    weekOf: "Week of",
    consistency: "Consistency",
    completed: "Completed",
    bestHabit: "Best habit",
    mostMissed: "Most missed",
    longestStreak: "Longest streak",
    perfectDays: "Perfect days",
    questions: {
      wentWell: { label: "What went well?", hint: "The habits that held, and why." },
      gotInWay: { label: "What got in the way?", hint: "Be specific — time, energy, other people, the setup." },
      focus: { label: "Which habit gets the focus next week?", hint: "One is enough." },
      modify: { label: "Should any habit change?", hint: "Smaller, earlier, different day." },
      add: { label: "Anything to add or drop?", hint: "Only if the current set is holding." },
    },
    savedForWeek: "Saved for this week",
    notSaved: "Not saved yet",
    updateReview: "Update review",
    saveReview: "Save review",
    pastReviews: "Past reviews",
    focusPrefix: (focus: string) => `Focus: ${focus}`,
  },

  login: {
    continueAction: "Continue",
    continueWithGoogle: "Continue with Google",
    orWithEmail: "or with email",
    googleCancelled: "Google sign-in was cancelled. Nothing was changed.",
    googleFailed: "Google sign-in didn't complete. Please try again.",
    googleLinkIntro: (email: string) =>
      `A RichHabit account already uses ${email}. Sign in with your password once, and Google will be connected to it.`,
    googleLinked: "Google is connected. Next time, one tap signs you in.",
    googleFinishTitle: "Finish creating your account",
    googleFinishIntro: (email: string) => `You're joining with Google as ${email}. Choose your public username to finish.`,
    welcomeBack: "Welcome back",
    createAccount: "Create your account",
    tagline: "Your habits, your data, only yours.",
    /** One field, either kind of account — the server works out which. */
    identifier: "Email or username",
    identifierPlaceholder: "Enter your email or username",
    email: "Email",
    emailPlaceholder: "you@example.com",
    firstName: "First name",
    lastName: "Last name",
    username: "Username",
    usernameHint: "3–30 characters: letters, digits, and dots, hyphens or underscores between them.",
    confirmPassword: "Confirm password",
    passwordMismatch: "The passwords do not match.",
    password: "Password",
    showPassword: "Show password",
    hidePassword: "Hide password",

    passwordPlaceholder: "At least 8 characters",
    signIn: "Sign in",
    createButton: "Create account",
    working: "Working…",
    signInInstead: "Sign in instead",
    createInstead: "Create an account",
    genericError: "Something went wrong. Try again.",
  },

  setup: {
    title: "Set your password",
    body: "This link was created for you by an administrator. Choose a password and the account is yours.",
    choosePassword: "New password",
    finish: "Continue",
    changeTitle: "Choose a new password",
    changeBody: "Signed in as",
    changeForced: "An administrator issued you a temporary password. Choose your own to carry on —",
    currentPassword: "Current password",
    newPassword: "New password",
    confirmPassword: "Confirm new password",
    /* Checked in the browser only. The server never needs the confirmation —
       it exists to catch a typo before it becomes a password nobody knows,
       which is an interface job rather than an API contract. */
    mismatch: "The two new passwords do not match.",
    changed: "Password changed.",
    backToSettings: "Back to Settings",
  },
  /** §Feedback. From a user of Rich Habits, to whoever runs it, about the app. */
  feedback: {
    open: "Feedback",
    title: "Send feedback",
    intro: "This goes to the RichHabit team to help improve the app. It is not part of your habit tracking, and nothing from your habits, goals, notes or spending is attached.",
    typeLabel: "What kind of feedback?",
    types: {
      bug: "Bug",
      feature: "Feature request",
      suggestion: "Suggestion",
      general: "General feedback",
    },
    bodyLabel: "Your feedback",
    bodyPlaceholder: "What happened, or what would make this better?",
    ratingLabel: "How is the app working for you?",
    ratingHint: "Optional",
    screenshotLabel: "Screenshot",
    screenshotHint: "Optional. Only what you attach is sent.",
    screenshotAdd: "Attach a screenshot",
    screenshotRemove: "Remove",
    contextTitle: "Sent with your feedback",
    contextBody: (page: string, version: string, locale: string) =>
      `The page you were on (${page}), the app version (${version}) and your language (${locale}). Nothing else.`,
    send: "Send feedback",
    sending: "Sending…",
    thanks: "Thank you. Your feedback has been sent to the RichHabit team.",
    another: "Send more",
    failed: "That didn't send. Try again in a moment.",
    tooLong: "That is longer than the form allows.",
  },
  /** The gratitude journal: a day's entry, and the monthly review of it. */
  journal: {
    title: "Gratitude journal",
    prompt: "What is worth being grateful for today?",
    placeholder: "Someone, something, a moment",
    itemLabel: (n: number) => `Gratitude ${n}`,
    removeItem: (n: number) => `Remove entry ${n}`,
    addItem: "Add one",
    reflectionLabel: "Today's reflection",
    reflectionPlaceholder: "Anything else worth remembering about today.",
    autosaves: "Saved as you type.",
    savedCount: (n: number) => (n === 1 ? "1 entry, saved as you type." : `${n} entries, saved as you type.`),

    monthlyTitle: "Monthly gratitude review",
    daysJournaled: "Days journaled",
    entries: "Gratitude entries",
    ofDays: (done: number, total: number) => `${done} / ${total} days`,
    empty: "Nothing written this month yet.",
    emptyBody: "Whatever you write on Today will gather here.",
    expand: "Show the day",
    collapse: "Hide",
    previousMonth: "Previous month",
    nextMonth: "Next month",

    reflectTitle: "My monthly reflection",
    reflectIntro: "Read back over the month, then write what you notice.",
    prompts: [
      "What was most worth being grateful for this month?",
      "Who keeps appearing in these entries?",
      "What brought the most contentment?",
      "Which moment is worth remembering?",
      "What would you like to notice more of next month?",
    ],
    reflectPlaceholder: "In your own words.",
  },
  /** The day's post-it. A sticky note, not a to-do application. */
  priorities: {
    /* Asked only for a completed priority: it is history now, and deleting it
       is permanent. An open line keeps its one-click remove. */
    deleteDoneTitle: "Delete this accomplishment?",
    deleteDoneBody: "This permanently removes this completed priority from your history and your accomplishment totals.",
    deleteDoneConfirm: "Delete",
    /* Rewording a line in place. The words are the user's; only these
       controls around them are translated. */
    editTitle: (text: string) => `Edit "${text}"`,
    editField: "Priority wording",
    editEmpty: "A priority needs some words.",
    editFailed: "That wasn't saved. Your wording is still here, so you can try again.",
    title: "Today's priorities",
    empty: "The few things that matter most today.",
    placeholder: "Finish the project review",
    add: "Add",
    unsortedTitle: "Unsorted",
    unsortedSubtitle: "Sort this into the right box",
    count: (done: number, total: number) =>
      `${done} completed · ${total} ${total === 1 ? "priority" : "priorities"}`,
    check: (text: string) => `Mark "${text}" done`,
    uncheck: (text: string) => `Mark "${text}" not done`,
    remove: (text: string) => `Remove "${text}"`,
    moveUp: (n: number) => `Move item ${n} up`,
    moveDown: (n: number) => `Move item ${n} down`,
    carriedFrom: (date: string) => `from ${date}`,
    /*
     * `short` is the word the card itself wears. The full title belongs to the
     * box, which already says it once above the list — repeating "Important &
     * Not Urgent" on every line would bury the priority in its own label. One
     * or two words is enough to identify a quadrant you are already looking at,
     * and it is what keeps the control smaller than the text it annotates.
     */
    quadrants: {
      unsorted: { title: "Not Urgent & Important", subtitle: "Plan & protect", short: "Protect" },
      urgent_important: { title: "Urgent & Important", subtitle: "Do now", short: "Do now" },
      important_not_urgent: { title: "Not Urgent & Important", subtitle: "Plan & protect", short: "Protect" },
      urgent_not_important: { title: "Urgent & Not Important", subtitle: "Delegate or reduce", short: "Delegate" },
      not_important_not_urgent: { title: "Not Urgent & Not Important", subtitle: "Limit or eliminate", short: "Limit" },
    },
    /*
     * The composer's second step: the four quadrants as one question. Never
     * guessed and never defaulted — the app has no way to know whether
     * something matters to you.
     */
    chooseQuadrant: "Add to",
    addedTo: (text: string, quadrant: string) => `"${text}" added to ${quadrant}.`,
    /* The same two answers, still asked by Clarify Your Intention's drafts. */
    askImportant: "Important?",
    askUrgent: "Urgent?",
    yes: "Yes",
    no: "No",
    /* Covey's Q2 question, and the only scheduling this screen does. */
    plan: "Plan",
    planHeading: "When will you do this?",
    planClear: "Clear",
    planFor: (text: string) => `Plan a day for "${text}"`,
    plannedFor: (text: string, date: string) => `"${text}" is planned for ${date}. Change it`,
    /*
     * One line under the heading, and only ever one. Every string here is a
     * count of what is on screen now; nothing claims a trend, because a
     * mutable category cannot evidence one.
     */
    insight: {
      protect: (n: number) =>
        `${n} important priorities aren't urgent yet. Consider protecting time for the most important ones.`,
      mostlyUrgent: () =>
        "Most of today's priorities are urgent. Consider what could be planned earlier next week.",
    },
    /* Questions, not verdicts. Rest and recreation can be worth the time. */
    nudge: {
      urgent_important: "Could this have been planned earlier?",
      urgent_not_important: "Does this require you?",
      not_important_not_urgent: "Is this worth your time?",
    } as Record<string, string>,
    dismiss: "Dismiss",
    drag: (text: string) => `Drag "${text}" to a new quadrant`,
    /** The category control, which is the way in without a mouse. */
    setCategory: (text: string, current: string) => `Quadrant for "${text}": ${current}. Change it`,
    categoryHeading: "Move to",
    /** Announced, not drawn: a move made from the keyboard is silent otherwise. */
    movedTo: (text: string, quadrant: string) => `"${text}" moved to ${quadrant}`,
    emptyQuadrant: "Nothing here",
    dropHere: "Drop here",
    /*
     * Adding straight into a box. Choosing the box IS the classification, so
     * this path never asks Important? or Urgent? — the global row is the one
     * for "I have a thing and do not know where it goes".
     *
     * Three wordings, because a collapsed box is in one of three states: it has
     * cards, it is empty, or it is holding words someone started and left. The
     * third never shows the words themselves.
     */
    addHere: "+ Add here",
    addFirstHere: "＋ Add a priority here",
    continueAdding: "Continue adding…",
    addTo: (quadrant: string) => `Add a priority to ${quadrant}`,
    continueIn: (quadrant: string) => `Continue the priority you started in ${quadrant}`,
    none: "Nothing here yet.",
    /*
     * Guidance, not a rule. Shown once the list has grown, and phrased so that
     * a long list reads as something to work with rather than a mistake — the
     * lines are there because they were not finished, which is information, not
     * a failure.
     */
    focusHint: "Longer than a post-it. Move the two or three that really matter to the top — the rest will keep.",
    /**
     * The details panel: everything beyond a line's words is optional, lives
     * here, and autosaves. Attachment wording doubles as the API's refusals.
     */
    details: {
      title: "Priority details",
      open: (text: string) => `Open details for "${text}"`,
      hasDetails: "Has notes, links or files",
      notesLabel: "Notes",
      notesPlaceholder: "Anything that helps: context, steps, what done looks like…",
      linksLabel: "Links",
      linkUrlPlaceholder: "https://…",
      linkLabelPlaceholder: "Label (optional)",
      addLink: "Add",
      linkInvalid: "Links must be complete web addresses (http or https).",
      removeLink: (label: string) => `Remove the link ${label}`,
      openLink: (label: string) => `Open ${label} in a new tab`,
      filesLabel: "Files",
      addFile: "Attach a file",
      fileRules: (each: string, count: number) => `Up to ${count} files, ${each} each — images, PDF or plain text.`,
      uploading: "Uploading…",
      removeFile: (name: string) => `Remove ${name}`,
      deleteFileConfirm: (name: string) => `Remove the file “${name}”? This cannot be undone.`,
      fileTooLarge: (max: string) => `That file is too large — the limit is ${max}.`,
      fileEmpty: "That file is empty.",
      fileUnsupported: "Images (PNG, JPEG, GIF, WebP), PDFs and plain-text files can be attached.",
      tooManyFiles: (n: number) => `A priority can hold up to ${n} files. Remove one first.`,
      storageFull: (max: string) => `Your attachments have reached ${max} in all. Remove something first.`,
      categoryLabel: "Quadrant",
      markDone: "Mark done",
      reopen: "Reopen",
      written: (date: string) => `Written ${date}`,
    },
  },
  /**
   * The language control in the app header. The options are written in their
   * own languages and never translated (see LanguageMenu), so this is only the
   * control's own label.
   */
  language: {
    label: "Language",
  },

  /**
   * Together — shared boards, kept apart from everything private. "People" are
   * the accounts you share a board with; nothing here ever names an email
   * address except the one an inviter typed.
   */
  together: {
    title: "Together",
    tagline: "Shared spaces for keeping promises to each other. Your own RichHabit stays private.",
    boards: "Spaces",
    archivedBoards: (n: number) => `Archived spaces (${n})`,
    noBoards: "No shared spaces yet. Start one, then invite the people you're working with.",
    emptyTitle: "Start your first shared space",
    emptyBody: "A space is a small shared place for something you are doing together. Invite people once it is ready.",
    openBoardDetail: (name: string, people: number, owner: boolean, archived = false) => `Open ${name}, ${people === 1 ? "1 person" : `${people} people`}${owner ? ", you own it" : ""}${archived ? ", archived" : ""}`,
    newBoard: "New space",
    memberCount: (n: number) => (n === 1 ? "1 person" : `${n} people`),
    people: "People",
    noPeople: "People you share a space with appear here, ready to invite to another one.",
    /* Global collaborators: connect once, invite to any space afterwards. */
    collaborators: "My Collaborators",
    collaboratorsNote: "Connect once; invite to any space afterwards. Connecting shares only display names — every space is still shared one at a time, by its own invitation.",
    inviteCollaborator: "Invite collaborator",
    noCollaborators: "Nobody yet. Invite someone by email or username; they appear here when they accept.",
    collabSheetTitle: "Invite a collaborator",
    collabSheetNote: "They receive a request with Accept and Decline. Nothing is shared until they accept — and even then, only your display names.",
    collabRequested: (who: string) => `Request sent to ${who}. You'll be connected when they accept.`,
    collabRequestedEmail: (email: string) => `Request sent to ${email}.`,
    collabConnected: (who: string) => `You're now connected with ${who}.`,
    collabNothing: "Nothing new to send: you're already connected, or your request is already waiting.",
    collabWaiting: "Waiting for an answer",
    removeCollaborator: (name: string) => `Remove ${name} from your collaborators`,
    confirmRemoveCollaborator: (name: string) => `Remove ${name} from your collaborators? Any spaces you already share stay exactly as they are — you only stop appearing in each other's lists.`,
    collabRequestCard: (inviter: string) => `${inviter} wants to collaborate with you.`,
    collabPrivacyLine: "Connecting shares only your display names. No space is shared until you accept its own invitation.",
    addMembers: "Add members",
    addMembersIntro: "Invite people to this space. They join when they accept.",
    searchByNameOrUsername: "Search by name or username",
    pickCollaborators: "My collaborators",
    pickOtherSpaces: "From your other spaces",
    invitationPending: "Invitation pending",
    inviteN: (n: number) => (n === 0 ? "Invite" : n === 1 ? "Invite 1 person" : `Invite ${n} people`),
    nSelected: (n: number) => (n === 1 ? "1 person selected" : `${n} people selected`),
    noCollaboratorsYet: "No collaborators yet. Connect with people on the Together overview, or invite someone by email or username below.",
    noSearchMatch: "No one matches that search.",
    manageMembers: "Manage members",
    seeMembers: "See members",
    ownerInvitesOnly: "Only the Space owner can invite people here. Ask the owner to invite someone.",
    searchPeople: "Search people…",
    collaboratorTag: "Collaborator",
    boardName: "Space name",
    boardNamePlaceholder: "Headband Business",
    addPeople: "Invite people",
    // Overview → Invite people, when there is more than one space: an invitation is always to one space.
    inviteChoose: "Invite to which space?",
    inviteChooseNote: "People you invite join only the space you choose, once they accept.",
    noPeopleToAdd: "Nobody yet.",
    inviteAfterCreate: "People you pick are invited inside Together, and join when they accept.",
    inviteByEmailToggle: "+ Invite someone by email",
    addEmail: "Add",
    removeEmail: (email: string) => `Remove ${email}`,
    createdPartly: (list: string) => `The space was created, but these invitations could not be sent: ${list}. You can invite them again from the space's Members page.`,
    goToBoard: "Open space",
    create: "Create space",
    members: "Members",
    owner: "Owner",
    member: "Member",
    you: "you",
    inviteByEmail: "Invite someone by email",
    inviteEmailPlaceholder: "name@example.com",
    invite: "Invite",
    inviteSent: (email: string) => `Invitation sent to ${email}.`,
    inviteByEmailOrUsername: "Invite by email or username",
    inviteWhoPlaceholder: "name@example.com or username",
    /** Stated as what the product does, never as a fact about one address. */
    inviteHow: "An email address gets an email invitation; if it belongs to a RichHabit account, it also appears in the app. A username is invited inside the app, with no email.",
    inviteSentInApp: (name: string) => `Invitation sent to ${name} in Together. They join when they accept.`,
    pendingInvitations: "Pending invitations",
    otherPending: (n: number) => (n === 1 ? "1 more pending from another member" : `${n} more pending from other members`),
    // Takes the timestamp, so bilingual mode formats each half in its own language.
    expires: (iso: string) => `Expires ${new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
    invitedBy: (name: string) => `Invited by ${name}`,
    withdraw: "Withdraw",
    rename: "Rename",
    renameSpace: "Rename space",
    archive: "Archive space",
    unarchive: "Restore space",
    archivedNote: "This space is archived. It's read-only until the owner restores it.",
    confirmArchive: "Archive this space? It becomes read-only for everyone until you restore it.",
    leave: "Leave space",
    confirmLeave: "Leave this space? You will lose access until someone invites you again and you accept.",
    left: (name: string) => `You left “${name}”.`,
    /** Deleting a space: the owner only, confirmed by typing its name. */
    deleteSpace: "Delete space",
    deleteTitle: "Delete this space?",
    deleteBody: (name: string) =>
      `“${name}” and everything in it will be permanently deleted: its board, tasks, backlog, history, groups, pending invitations and memberships. Everyone in it loses access.`,
    deleteKeeps: "Nobody's personal habits, journals or other spaces are affected.",
    deleteIrreversible: "This can't be undone.",
    deleteTypePrompt: "To confirm, type the space's name exactly:",
    deleteConfirm: "Delete space",
    deleting: "Deleting…",
    deleted: (name: string) => `“${name}” was deleted.`,
    remove: "Remove",
    confirmRemove: (name: string) => `Remove ${name} from this space?`,
    confirmRemoveAssigned: (name: string, n: number) => `Remove ${name} from this space? ${n === 1 ? "They hold 1 open task" : `They hold ${n} open tasks`}; the work stays, without them.`,
    addFromPeople: "Invite from People",
    add: "Invite",
    peopleInvited: (n: number) => (n === 1 ? "Invitation sent. They join when they accept." : `${n} invitations sent. People join when they accept.`),
    nothingToInvite: "No new invitations: they are already in this space, already invited, or recently declined.",
    inTogether: "invited in Together",
    invitations: "Invitations",
    accept: "Accept",
    decline: "Decline",
    waitingIndicator: (n: number) => (n === 1 ? "1 invitation waiting" : `${n} invitations waiting`),
    invitedOnly: "You are here by invitation. Spaces you are invited to appear here; starting your own is part of the Together preview.",
    loadFailed: "This couldn't be loaded. Check your connection and try again.",
    retry: "Try again",
    invitePage: {
      title: "Together invitation",
      checking: "Checking your invitation…",
      invitedYou: (inviter: string, board: string) => `${inviter} invited you to “${board}”.`,
      privacy: "Joining shares only this space. Your habits, priorities, journal and calendar stay private.",
      accept: "Accept invitation",
      notNow: "Not now",
      signIn: "Sign in to accept",
      createAccount: "Create an account",
      invalid: "This invitation is no longer valid. Ask the person who invited you for a new one.",
      wrongAccount: "This invitation was sent to a different email address. Sign in with that address to accept it.",
      forAddress: (to: string) => `This invitation is for ${to}.`,
      otherAccount: "You are signed in with a different RichHabit account.",
      signOutContinue: "Sign out & continue",
      missing: "Open the invitation link from your email to continue. If you have just verified your email address, open the link again to accept.",
    },
    /**
     * V1B — a space's shared work. "Board" is the work board (看板); the
     * container is a "space" (空间). The Backlog holds what "we might" do, the
     * board what "we will". Task titles, descriptions, group and space names are
     * the members' own words and are never translated.
     */
    work: {
      board: "Board",
      backlog: "Backlog",
      stages: WORK_STAGES as Record<WorkStage, string>,
      stagePicker: "Board stages",
      stageTab: (stage: WorkStage, n: number) => `${WORK_STAGES[stage]}, ${n === 1 ? "1 task" : `${n} tasks`}`,
      add: "Add",
      addTo: (stage: WorkStage) => `Add to ${WORK_STAGES[stage]}`,
      addPlaceholder: "What will you do?",
      addHint: "Press Enter to add. Esc to finish.",
      captureLabel: "Capture something for the Backlog",
      capturePlaceholder: "Add an idea…",
      backlogIntro: "Things we might do. Nothing here is a promise yet — commit it to the board when you're ready.",
      commit: "Commit",
      commitAria: (title: string) => `Commit “${title}” to To do`,
      commitTo: "Commit to…",
      moveTo: "Move to…",
      moveTask: (title: string) => `Move “${title}” to…`,
      backToBacklog: "Back to Backlog",
      currentStage: "Current",
      movedTo: (stage: WorkStage) => `Moved to ${WORK_STAGES[stage]}`,
      undo: "Undo",
      show: "Show",
      added: "Added",
      deletedToast: "Task deleted",
      restoredToast: "Task restored",
      empty: {
        todo: "Nothing committed yet. Add what you'll do together, or commit something from the Backlog.",
        doing: "Nothing underway right now.",
        waiting: "Nothing is waiting on anyone.",
        done: "Finished work stays here for a day, then moves to History.",
        backlogTitle: "Nothing captured yet",
        backlog: "Write down ideas here before anyone commits to them. Nothing in the Backlog is a promise.",
      },
      showOlder: (n: number) => `Show older (${n})`,
      // History — Done for more than 24 hours. Not a stage: completed work kept for reference.
      history: "History",
      historyCount: (n: number) => (n === 1 ? "1 completed" : `${n} completed`),
      historyEmpty: "Work finished more than a day ago is kept here.",
      yesterday: "Yesterday",
      historyDay: (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-US",
        new Date(`${date}T12:00:00`).getFullYear() === new Date().getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" }),
      reopen: "Reopen",
      reopenIn: "Reopen in…",
      reopenTask: (title: string) => `Reopen “${title}” in…`,
      reopened: (stage: WorkStage) => `Reopened in ${WORK_STAGES[stage]}`,
      // Position — the same moves as dragging, for a keyboard or a phone.
      position: "Position",
      toTop: "Move to top",
      up: "Move up",
      down: "Move down",
      toBottom: "Move to bottom",
      movedAnnounce: (stage: WorkStage, position: number, total: number) => `Moved to ${WORK_STAGES[stage]}, position ${position} of ${total}`,
      dragHint: "Drag a card to move it, or use Move to….",
      openTask: (title: string) => `Open ${title}`,
      assignedTo: (names: string) => `Assigned to ${names}`,
      nobodyYet: "Nobody has taken this on yet",
      effortValue: (n: number) => `Effort ${n}`,
      due: {
        later: (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        soon: (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" }),
        tomorrow: "Tomorrow",
        today: "Today",
        overdue: (date: string) => `Was due ${new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      },
      // The sheet
      task: "Task",
      titleLabel: "Title",
      description: "Description",
      descriptionPlaceholder: "Add details, links or notes…",
      stage: "Stage",
      assignees: "Assignees",
      group: "Group",
      noGroup: "No group",
      findOrCreateGroup: "Find or create a group",
      createGroup: (name: string) => `Create “${name}”`,
      effort: "Effort",
      clear: "Clear",
      dueDate: "Due date",
      nextWeek: "Next week",
      // A null name is a former member; `you` marks the reader. Resolved here, per language.
      addedBy: (name: string | null, at: string, you = false) => `Added by ${name === null ? "a former member" : you ? `${name} (you)` : name} · ${new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
      editedAt: (at: string) => `Edited ${new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      formerMember: "Former member",
      you: "you",
      saved: "Saved",
      delete: "Delete",
      confirmDelete: (space: string) => `Delete this task for everyone in ${space}?`,
      confirmDeleteNote: "Anyone in the space can restore it from Recently deleted.",
      conflict: (name: string | null) => `${name ?? "Someone"} changed this while you were editing.`,
      theirVersion: "Their version",
      keepMine: "Keep mine",
      useTheirs: "Use theirs",
      deletedNotice: (name: string | null) => `${name ?? "A former member"} deleted this task.`,
      restore: "Restore",
      readOnly: "This space is archived, so its work is read-only.",
      // The header
      more: "More",
      membersOf: (names: string) => `Members: ${names}`,
      groups: "Groups",
      groupsIntro: "Groups are simple labels for organising this space's work. Everyone in the space sees everything.",
      newGroup: "New group",
      groupName: "Group name",
      deleteGroup: "Delete group",
      confirmDeleteGroup: (name: string) => `Delete the group “${name}”? Its tasks stay, without a group.`,
      noGroups: "No groups yet. Create one here, or from any task.",
      recentlyDeleted: "Recently deleted",
      nothingDeleted: "Nothing has been deleted.",
      deletedBy: (name: string | null, at: string) => `Deleted by ${name ?? "a former member"} · ${new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      refresh: "Refresh",
      backToWork: "Back to the work",
    },
    errors: {
      notFound: "That space isn't available.",
      ownerOnly: "Only the space's owner can do that.",
      archived: "This space is archived, so it can't be changed.",
      nameRequired: "Give the space a name.",
      nameTooLong: "Keep the name to 80 characters or fewer.",
      emailInvalid: "That doesn't look like an email address.",
      tooManyInvites: "You've sent a lot of invitations today. Try again tomorrow.",
      tooManyOpenInvites: "This space has many open invitations. Withdraw some first.",
      sendFailed: "We couldn't send that invitation, so it can't be used. Try again in a moment.",
      invitationInvalid: "This invitation is no longer valid. Ask for a new one.",
      wrongAccount: "This invitation was sent to a different email address.",
      ownerCannotLeave: "As the owner you can't leave this space. You can archive it instead.",
      confirmMismatch: "Type the space's name exactly as it appears to delete it.",
      cannotRemoveSelf: "You can't remove yourself.",
      notInPeople: "You can pick from your collaborators and the people you already share a space with. Invite anyone else by username or email.",
      usernameUnknown: "No RichHabit account has that username. Check the spelling, or invite them by email.",
      tooManyConnections: "You've reached the collaborator limit. Remove someone first.",
      tooManyPeople: "That is more invitations than can be sent at once.",
      tooManyBoards: "You already own the maximum number of spaces.",
      previewOnly: "Inviting people is not available on your account yet.",
      conflict: "Something in this space changed while you were doing that. Please try again.",
      taskMissing: "That task isn't available any more.",
      titleRequired: "Give the task a title.",
      titleTooLong: "Keep the title to 200 characters or fewer.",
      descriptionTooLong: "That description is too long (10,000 characters at most).",
      stageInvalid: "That isn't one of the board's stages.",
      effortInvalid: "Choose an effort of 1, 2, 3, 5 or 8.",
      dueInvalid: "That isn't a valid date.",
      notAMember: "Only current members of this space can be assigned.",
      tooManyAssignees: "That's more people than one task can have.",
      tooManyTasks: "This space has a lot of open work. Finish or delete some first.",
      taskDeleted: "This task was deleted. You can restore it.",
      textConflict: "Someone changed this while you were editing.",
      groupNameRequired: "Give the group a name.",
      groupNameTooLong: "Keep group names to 40 characters or fewer.",
      groupExists: "This space already has a group with that name.",
      groupMissing: "That group no longer exists.",
      tooManyGroups: "A space can have up to 30 groups.",
    },
  },

  /**
   * The header's notification bell: Together invitations waiting for this
   * account, with Accept and Decline right there. Together-only today; if the
   * app ever notifies about anything else, it belongs here too.
   */
  notifications: {
    label: "Notifications",
    title: "Notifications",
    open: "Notifications",
    openWithCount: (n: number) => `Notifications, ${n === 1 ? "1 invitation" : `${n} invitations`} waiting`,
    empty: "Nothing waiting. Invitations to shared spaces appear here.",
    openTogether: "Open Together",
  },

  /**
   * What's New — the release history. Release wording is keyed by the stable
   * ids in lib/releases.ts; a new release adds one entry here and one in zh.ts.
   * Benefit-first and plain: no model names, providers or version numbers.
   */
  whatsNew: {
    title: "What's New",
    open: "What's New",
    /** The trigger's accessible name while something is unread. */
    openUnread: "What's New, new updates",
    newTag: "New",
    /** Shown to admins on releases they see only as a preview. */
    shownTo: {
      grandfatheredPro: "Shown to Grandfathered Pro members",
    },
    notDeployed:
      "What's New can't remember what you've read yet — the database update hasn't been applied. Nothing else is affected.",
    releases: {
      "life-calendar": {
        title: "A smarter Life Calendar",
        body: "Add times, repeat birthdays and anniversaries, and see each day at a glance in the new Day Agenda.",
        cta: "Explore Important Dates",
      },
      "richhabit-pro": {
        title: "RichHabit Pro is here",
        body: "As an early member, you have Grandfathered Pro: unlimited active habits and unlimited new priorities in Priority Compass.",
      },
      "ai-refresh": {
        title: "A refreshed AI experience",
        body: "AI Coach and habit recommendations have been upgraded to help turn reflection and intention into practical next steps.",
      },
    },
  },

  /**
   * §26. The small calendar in Today's rail. System wording only — an event's
   * title and note are the user's own words and are never touched.
   */
  importantDates: {
    title: "Important dates",
    /** The two-month window, and the way back to it. */
    previousMonth: "Previous month",
    nextMonth: "Next month",
    backToNow: "Today",
    monthGrid: (month: string) => `${month}, calendar`,
    dayLabel: (date: string, n: number) =>
      (n === 0 ? date : `${date}, ${n} ${n === 1 ? "event" : "events"}`),
    /** More events on one day than the grid can draw. */
    moreOnDay: (n: number) => `+${n}`,

    empty: "Nothing marked yet. Pick a day to note a trip, a deadline or an occasion.",
    unavailable:
      "Important dates aren't switched on yet — this account's database is still being updated. Nothing else is affected.",
    /** The window between deploying longer notes and migrating the column. */
    noteNotWidened:
      "Longer notes aren't switched on yet — the database update hasn't been applied. Nothing was saved and nothing was cut; shorten the note for now, or try again shortly.",

    upcoming: "Upcoming",
    nothingUpcoming: "Nothing coming up.",
    showMore: (n: number) => `Show ${n} more`,
    showFewer: "Show fewer",
    onNow: "On now",
    todayTag: "Today",

    dayTitle: (date: string) => date,
    newTitle: "New important date",
    editTitle: "Important date",
    add: "Add an event",
    addOn: (date: string) => `Add an event on ${date}`,
    open: (title: string) => `Open "${title}"`,

    eventTitle: "What is it?",
    titlePlaceholder: "Battery Show — Detroit",
    start: "Starts",
    end: "Ends",
    spansDays: "Runs over several days",
    length: (n: number) => (n === 1 ? "1 day" : `${n} days`),
    colour: "Colour",
    colourNamed: (name: string) => `Colour: ${name}`,
    customColour: "Custom colour",
    kind: "Type",
    kinds: {
      none: "None",
      birthday: "Birthday",
      anniversary: "Anniversary",
      holiday: "Holiday",
      travel: "Travel",
      work: "Work",
      personal: "Personal",
      deadline: "Deadline",
    },
    colours: {
      teal: "Teal",
      blue: "Blue",
      violet: "Violet",
      rose: "Rose",
      amber: "Amber",
      clay: "Clay",
      green: "Green",
      slate: "Slate",
    },
    note: "Note",
    notePlaceholder: "Flight at 07:40, hotel booked. Paste an agenda, an address, anything you'll want on the day.",
    /** Only shown as the limit comes into view. */
    noteLength: (n: number, max: number) => `${n.toLocaleString()} / ${max.toLocaleString()}`,
    /** In a list, so you can tell which event has the details in it. */
    hasNote: "Note",
    deleteEvent: "Delete",
    confirmDelete: "Delete this event? This cannot be undone.",

    /** Times. Optional; an event is all day unless somebody says otherwise. */
    allDay: "All day",
    startTime: "Start time",
    endTime: "End time",
    noEndTime: "No end time",
    addEndTime: "Add end time",
    removeEndTime: "Remove end time",
    endsNextDay: "Ends the next day",
    /** Shown when the event's times were set in a zone other than this device's. */
    timesIn: (zone: string) => `Times are in ${zone}`,
    timeRange: (from: string, to: string) => `${from} – ${to}`,
    /** The time as written, beside the reader's own: "6:30 PM Central Time". */
    zoneTime: (time: string, zone: string) => `${time} ${zone}`,

    /** Repeating. One row of choices; Custom reveals the rest. */
    repeat: "Repeat",
    repeatOptions: {
      none: "Does not repeat",
      year: "Every year",
      month: "Every month",
      week: "Every week",
      custom: "Custom",
    },
    every: "Every",
    units: {
      week: (n: number): string => (n === 1 ? "week" : "weeks"),
      month: (n: number): string => (n === 1 ? "month" : "months"),
      year: (n: number): string => (n === 1 ? "year" : "years"),
    },
    intervalLabel: "How many",
    unitLabel: "Repeat unit",
    repeatEnds: "Ends",
    endsNever: "Never",
    endsOn: "On a date",
    repeatEndDate: "Last date",
    /** "Every 2 weeks", "Every year" — beside an event, and above it in the editor. */
    repeatSummary: {
      week: (n: number) => (n === 1 ? "Every week" : `Every ${n} weeks`),
      month: (n: number) => (n === 1 ? "Every month" : `Every ${n} months`),
      year: (n: number) => (n === 1 ? "Every year" : `Every ${n} years`),
    },
    repeatUntil: (date: string) => `until ${date}`,
    /** Over the editor of a repeating event: what Save is about to change. */
    editsAll: "Changes apply to every repeat",
    deleteWhich: "Delete which?",
    deleteThisOnly: (date: string) => `Only ${date}`,
    deleteAll: "All repeats",
    timesUnavailable:
      "Times and repeating dates aren't switched on yet — the database update hasn't been applied. Nothing was saved; try again shortly.",
    reloadToEdit:
      "This event has a time or a repeat this page doesn't know about yet. Reload the page to edit it — nothing was changed.",
    tooManyDeleted:
      "This repeating event already has as many single dates removed as it can hold. Nothing was changed.",

    /** The Day Agenda: what tapping a date opens. */
    agendaAllDay: "All day",
    nothingPlanned: "Nothing planned for this day.",
    previousDay: "Previous day",
    nextDay: "Next day",
    dayOf: (n: number, of: number) => `Day ${n} of ${of}`,
    untilTime: (time: string) => `Until ${time}`,
    continues: "Continues",

    /** Mirrors `eventProblem` in lib/importantDates — one rule, two languages. */
    problems: {
      titleRequired: "Give it a name so you know what it is.",
      endBeforeStart: "The end date can't be before the start date.",
      tooLong: "That's longer than a year — worth splitting into separate dates.",
      noteTooLong: "That note is longer than the field can hold. Nothing has been cut — shorten it and it will save.",
      endTimeBeforeStart: "The end time has to be after the start time.",
      repeatTooShort: "Each repeat has to finish before the next one starts — shorten the event or repeat less often.",
      untilBeforeStart: "The repeat can't end before the event starts.",
      intervalRange: "Choose a number from 1 to 99.",
    },
  },

  /**
   * The free early-access notice. Shown on the sign-in card so it is read
   * before anyone is inside, and accepted explicitly when creating an account.
   */
  earlyAccess: {
    title: "Free Early Access",
    body: "RichHabit is currently free while it is in early access. To keep the service fair and reliable, we reserve the right to limit, suspend, or delete accounts in cases of excessive or abusive usage, misuse, attempts to exploit the service, or other activity that may negatively affect the platform or its users. Free access may also change as RichHabit evolves.",
    /**
     * Shown only if a sign-up limit is switched back on and reached. There is no
     * limit by default, so this is dormant — and it deliberately names no
     * number, because the number is configuration.
     */
    fullTitle: "RichHabit Early Access Is Full",
    fullBody: "Thank you for your interest in RichHabit. Sign-ups are paused for now, because the free programme has reached the number of accounts it can support.\n\nWe are working on the next version of RichHabit and future access options. Please check back later.",
    learnMore: "Learn more",
    agree: "I agree to the Free Early Access terms.",
    mustAgree: "Please accept the Free Early Access terms to create an account.",
    termsTitle: "Free Early Access terms",
    back: "Back to sign in",
    /** Plain statements of what the app already does, not new promises. */
    factsTitle: "What this means in practice",
    facts: [
      "Your habits, notes, journal and spending records are yours. Nothing you write is read by an administrator.",
      "You can export everything as JSON at any time, from More → Your data.",
      "You can ask for your account to be deleted, which removes it and everything it owns.",
      "Free access is available while RichHabit is in early access, and may change later.",
      "If you ask for suggestions in Clarify Your Intention, your intention, why and vision are securely sent to Claude, Anthropic's AI model, to generate them. Nothing else is sent. Suggestions are optional, and nothing is added unless you choose to add it.",
    ],
  },

  /** Confirming an email address: the page, and the screen shown after signing up. */
  verify: {
    title: "Confirm your email",
    intro: "Press the button below to confirm this address and activate your account.",
    confirm: "Confirm my email",
    confirming: "Confirming…",
    doneTitle: "Email confirmed",
    problemTitle: "This link didn't work",
    ok: "Your email is confirmed and your account is active. You can sign in now.",
    already: "This address is already confirmed. You can sign in.",
    expired: "This link has expired. Sign in with your email and password and we'll send a new one.",
    invalid: "This link is not valid. It may already have been used, or the address may have been confirmed another way.",
    fullStillValid: "Your link is still valid — press confirm again and it will work as soon as a spot opens up.",
    signIn: "Sign in",
    backToSignIn: "Back to sign in",
    tryAgain: "Try again",
    // A link confirming an administrator's requested change of sign-in email.
    changeTitle: "Confirm your new email",
    changeIntro: "Press the button below to make this your sign-in email. Until you do, nothing about how you sign in changes.",
    changeConfirm: "Confirm this email",
    changeDoneTitle: "New email confirmed",
    changeOk: "Your new sign-in email is confirmed. Use it the next time you sign in.",
    taken: "This address is now used by another RichHabit account, so it can't be added to yours. Ask the person who manages your account for help.",

    // The screen that replaces the sign-up form once an account is pending.
    sentTitle: "Check your email",
    sentBody: "We sent a verification link to your email. Verify your email to activate your RichHabit account.",
    sentHint: "The link works for 24 hours. If it isn't there, check your spam folder.",
    sendFailed: "We couldn't send the confirmation email just now. Try sending it again.",
    resend: "Send it again",
    resending: "Sending…",
    resendSent: "If that account is waiting to be confirmed, a new link is on its way.",
  },

  /**
   * Verifying the address the account already has, so it can be used to get
   * back in later. Offered, never demanded: an account that was grandfathered
   * in stays grandfathered whether or not it ever presses this.
   */
  protect: {
    title: "Protect your account",
    body: "Verify your email so you can get back in if you forget your password.",
    action: "Verify Email",
    sending: "Sending…",
    sent: "Check your email for the verification link.",
    verified: "Email verified",
    noAddress: "This account has no email address yet.",
  },

  /**
   * Getting back in. One page asks who you are, one page sets the new password,
   * and the sentence between them is deliberately the same whatever the truth
   * is — see src/app/api/auth/forgot/route.ts.
   */
  forgot: {
    link: "Forgot password?",
    title: "Reset your password",
    intro: "Enter your email or username and we'll send you a link.",
    identifier: "Email or username",
    send: "Send reset link",
    sending: "Sending…",
    /* Said to everyone: unknown account, no address, an address nobody proved,
       a disabled account, a live one. */
    sentTitle: "Check your email",
    sentBody: "If we can verify an account with those details, we'll send password-reset instructions.",
    sentHint: (m: number) => `The link works for ${m} minutes and can be used once.`,
    backToSignIn: "Back to sign in",

    chooseTitle: "Choose a new password",
    newPassword: "New password",
    confirmPassword: "Confirm new password",
    save: "Set new password",
    saving: "Saving…",
    linkInvalid: "This link is no longer valid. Request a new one.",
    linkExpired: "This link has expired. Request a new one.",
    requestAnother: "Request a new link",

    doneTitle: "Password changed",
    doneBody: "You've been signed out on your other devices. Sign in with your new password.",
    signIn: "Sign in",
  },

  errors: {
    nameRequired: "Enter your first and last name.",
    verifyPending: "Confirm your email address before signing in — check your inbox for the link.",
    passwordTooSimple: "That password is too easy to guess — choose another.",

    serviceUnavailable: "The service can't reach its database right now. Try again in a moment.",
    setupLinkInvalid: "This setup link is not valid any more. Ask for a new one.",
    accountDisabled: "This account has been disabled. Contact whoever administers it.",
    notSignedIn: "You're not signed in.",
    saveFailed: "Something went wrong saving that.",
    invalidEmail: "Enter a valid email address.",
    emailTooLong: "That email address is too long.",
    emailTaken: "That email is already registered.",
    passwordTooShort: (n: number) => `Password must be at least ${n} characters.`,
    passwordTooLong: (n: number) => `Password must be under ${n} characters.`,
    // Deliberately says nothing about whether the account exists.
    wrongCredentials: "Invalid username/email or password.",
    invalidUsername: "A username is 3-30 characters: letters, digits, and dots, hyphens or underscores in between.",
    usernameTaken: "That username is already taken.",
    googleLinkInvalid: "That Google connection expired or belongs to a different account. Start again with Continue with Google.",
    googleExpired: "That Google sign-in expired. Please start again.",
    needIdentifier: "Enter an email address or a username.",
    tooManyAttempts: "Too many attempts. Wait a few minutes and try again.",
    coachUnavailable: "The AI coach isn't switched on for this app yet.",
    coachEmpty: "The coach didn't return anything. Try asking again.",
    /* A provider failure, said in our own words. The provider's message is
       never shown: this string is rendered straight onto the screen. */
    coachFailed: "The coach didn't answer. Please try again in a moment.",
    questionTooLong: "That question is too long.",
    /* The coach's safety limit. Says what happened and when it lifts, without
       scolding and without implying anything is wrong with the account. */
    coachHourlyLimit: "You've asked the coach a lot in the past hour. Give it a little while and ask again.",
    coachDailyLimit: "You've reached today's limit for coach questions. It lifts within a day — your habits and history are unaffected.",
    coachLimitUnavailable: "We couldn't check your coach usage just now. Please try again in a moment.",
    /*
     * A plan allowance, not a failure. Each leads with the state, then the way
     * forward, then the reassurance — and names no price, because there is
     * currently nowhere to pay and a nudge towards a door that does not exist
     * would be worse than the limit itself. The number comes from the entitlement,
     * never from the copy.
     */
    activeHabitLimit: (n: number) =>
      `You're tracking ${n} active habits, which is the most your current plan includes. `
      + "Pause one to make room — nothing is deleted.",
    newPriorityLimit: (n: number) =>
      `That's all ${n} new priorities for today. Unfinished ones keep rolling forward, `
      + "and you can add more tomorrow.",
    /* An account that would not load, said plainly. Never "no habits yet":
       the whole point is that a failure must not read as an empty account. */
    loadFailedReason: "The server could not read your account from the database.",
    loadFailedRetry: "Try again",
    loadFailedTitle: "We couldn't load your account",
    loadFailedBody: "Your habits and history are safe — this device just couldn't read them. This is usually temporary. Try again, and if it keeps happening please send feedback.",
  },

  /**
   * Clarify Your Intention.
   *
   * Every prompt here is RichHabit's own wording. The experience is inspired by
   * Dr. James R. Doty's work on intention and attention; none of his exercises
   * or text is reproduced, and the attribution at the foot of the page says so
   * without implying that he endorsed or was involved in any of this.
   *
   * The questions are deliberately short and end in a question mark, which is
   * what makes the bilingual dictionary join them with a space rather than a
   * middot. The screen goes further and sets the two languages on their own
   * lines — see `Ask` in screens/Intention.tsx.
   */
  intention: {
    /** The name of the experience, above the question. */
    eyebrow: "Clarify your intention",
    startTitle: "What do you truly want?",
    startBody: "Five short steps and a few quiet questions. Stop whenever you like; it will be here when you come back.",
    start: "Begin",
    resume: "Continue where you left off",
    /** The subtle progress treatment: one word per step. */
    steps: {
      what: "What",
      why: "Why",
      truth: "Truth",
      vision: "Vision",
      action: "Action",
    },
    /** Only a screen reader hears this; the ticks carry it visually. */
    progress: (step: number, total: number) => `Step ${step} of ${total}`,
    back: "Back",
    continue: "Continue",

    what: {
      question: "What is something you genuinely want to create, change, become, or experience?",
      placeholder: "In your own words.",
    },

    why: {
      /* Three rungs, each revealed only once the one above has an answer. */
      question: "Why does this matter to you?",
      deeper: "And why is that important?",
      deepest: "And underneath that?",
      goDeeper: "Go deeper",
      placeholder: "There is no right answer here.",
      /** Marks the rung above, kept in view while the next one is written. */
      earlier: "You wrote",
    },

    truth: {
      question: "Is this really yours?",
      note: "Some of what we want comes from us, and some of it arrives from elsewhere. Both are worth noticing.",
      choices: {
        mine: "This feels genuinely mine",
        outside: "Some of it may come from outside expectations",
        unsure: "I'm still figuring that out",
      },
      /* One follow-up, chosen by the answer. Never a verdict on it. */
      prompts: {
        mine: "What tells you it's yours?",
        outside: "Which part might belong to someone else?",
        unsure: "What would help you know?",
      },
    },

    vision: {
      question: "Imagine it has become real.",
      prompts: {
        different: "What would actually be different?",
        doing: "What would you be doing?",
        day: "What would an ordinary day look like?",
        feeling: "How would it feel?",
      },
      next: "Next question",
    },

    action: {
      question: "What will you actually do?",
      note: "An intention becomes real through what you repeat, and through what you give your attention to next.",
      habitsTitle: "Habits I'm building",
      habitsHint: "Each one is an ordinary habit on your sheet, tracked like any other. Add as many as feel right.",
      habitPlaceholder: "A behaviour you could repeat",
      addHabit: "Add to Rich Habits",
      habitAdded: "On your habit sheet",
      openHabit: (name: string) => `Open "${name}" in the habit editor`,
      priorityTitle: "My priorities",
      priorityHint: "Things that deserve your attention. Each stays on the compass until you finish it.",
      priorityPlaceholder: "Something you'll do next",
      addPriority: "Add to Priority Compass",
      priorityAdded: "On your compass",
      /* The matrix asks these of every new line and never guesses. Asked here
         for the same reason: nothing may decide what matters to someone. */
      askImportant: "Important?",
      askUrgent: "Urgent?",
      finish: "Finish",
      whenTitle: "When?",
    },

    card: {
      intention: "My intention",
      why: "Why it matters",
      habits: "Habits I'm building",
      priorities: "My priorities",
      /** The earlier rungs and the vision, folded away. The deepest why is what is shown. */
      fullWhy: "The whole chain",
      vision: "What it will look like",
      revisit: "Revisit",
      noHabits: "No habits linked yet.",
      noPriorities: "No priorities linked yet.",
      done: "Done",
      importantDates: "Important dates",
      importantDatesHint: "Planned days from your priorities",
    },

    /** Adding, linking and unlinking the ordinary records an intention points to. */
    links: {
      add: "Add",
      linkExisting: "Link existing",
      suggest: "Suggest with AI",
      showAll: (n: number) => `Show all (${n})`,
      showFewer: "Show fewer",
      options: (name: string) => `Options for "${name}"`,
      remove: "Remove from intention",
      removeNote: "Removes the link only. Nothing is deleted.",
      openCompass: (text: string) => `Open "${text}" in Priority Compass`,
      linkHabitsTitle: "Link existing habits",
      linkPrioritiesTitle: "Link existing priorities",
      search: "Search",
      nothingToLink: "Everything you have is already linked.",
      noMatch: "Nothing matches that search.",
      linkCount: (n: number) => (n === 0 ? "Link" : `Link ${n}`),
      completed: "Completed",
      cancel: "Cancel",
    },

    /**
     * Suggestions. Claude recommends; the person decides. Drafts are temporary
     * and nothing is added until the person chooses to add it.
     */
    ai: {
      disclosure: "To generate suggestions, your intention, why, and vision are securely sent to Claude. Suggestions are optional and you decide what to add.",
      title: "Suggestions",
      loading: "Thinking of ideas…",
      edit: "Edit",
      doneEditing: "Done",
      field: "Suggestion",
      addHabit: "Add habit",
      addPriority: "Add priority",
      dismiss: (text: string) => `Dismiss "${text}"`,
      more: "Suggest more",
      close: "Close suggestions",
      none: "No new ideas this time. Try again, or add your own.",
      failed: "Suggestions didn't load. Please try again in a moment.",
      unavailable: "Suggestions aren't available right now.",
      limited: "You've reached the suggestion limit for now. Please try again later.",
      busy: "Still working on your last request.",
      needsIntention: "Write what you want first, then ask for suggestions.",
    },

    /**
     * Verified before it shipped: Dr. James R. Doty was a neurosurgeon on the
     * faculty of Stanford University School of Medicine and the founder and
     * director of Stanford's Center for Compassion and Altruism Research and
     * Education. Nothing here is quoted, and the second sentence is what keeps
     * an acknowledgement from reading as a claim of endorsement.
     */
    attribution: "Inspired by the work of Dr. James R. Doty on intention, attention, and clarifying what truly matters. Created independently by RichHabit.",

    /* Said when the table is not there yet, rather than offering a writing
       surface over a write that cannot land. See api/intention/route.ts. */
    /* Two tabs, both starting an intention. The first one won; reloading
       shows it, and nothing the person wrote in either is lost. */
    alreadyStarted: "You already have an intention in progress. Reload this page to carry on with it.",
    unavailableTitle: "Not switched on yet",
    unavailableBody: "Clarify Your Intention isn't available on this account yet. Nothing written here would be saved, so the page is holding back rather than risking your words.",
  },

  /*
   * The admin-only AI Workspace. The chrome follows the reader's language; what
   * an admin writes, names and uploads is always shown exactly as entered.
   */
  aiWorkspace: {
    name: "AI Workspace",
    open: "Open AI Workspace",
    launcher: "Ask AI",
    close: "Close",
    expand: "Expand",
    collapse: "Shrink",
    newChat: "New chat",
    history: "Chats and projects",
    projects: "Projects",
    newProject: "New project",
    recent: "Recent",
    archived: "Archived",
    showArchived: "Show archived",
    hideArchived: "Hide archived",
    noConversations: "Your conversations will appear here.",
    untitled: "New conversation",
    inProject: (name: string) => `In ${name}`,
    emptyTitle: "What can I help with?",
    emptyBody: "Ask anything: write, research, code, brainstorm, translate, or ask about a file you attach. This workspace can't see anyone's RichHabit data.",
    starters: [
      "Explain a concept in simple terms",
      "Draft a clear, friendly email",
      "Review this code for bugs",
      "Translate a paragraph into Chinese",
    ],
    imageStarter: "Create an image of a cozy reading nook",
    placeholder: "Message AI…",
    model: "Model",
    chooseModel: "Choose a model",
    creatingImage: "Creating image…",
    generatedImage: "Generated image",
    openImage: "Open full size",
    imageStorageFull: "There wasn't enough storage to keep this image. Delete some files, then try again.",
    send: "Send",
    stop: "Stop",
    attach: "Attach",
    uploadFromDevice: "Upload from device",
    fromProjectFiles: "Choose from project files",
    dropFiles: "Drop files to attach",
    thinking: "Thinking…",
    stopped: "Stopped",
    continue: "Continue",
    retry: "Retry",
    regenerate: "Regenerate",
    copy: "Copy",
    copied: "Copied",
    copyCode: "Copy code",
    lengthLimit: "This reply reached the length limit.",
    refusal: "The model chose not to continue this reply.",
    contextWindow: "This conversation is too long to continue here. Start a new chat to keep going.",
    failures: {
      rate_limited: "The AI service is busy. Try again in a minute.",
      overloaded: "The AI service is overloaded right now. Try again shortly.",
      timeout: "The reply took too long.",
      context_too_long: "This conversation and its files are too long for one reply. Start a new chat or attach fewer files.",
      unreadable_file: "An attached file couldn't be read.",
      malformed_response: "The reply came back incomplete.",
      provider_error: "The AI service returned an error.",
      network: "The connection to the AI service was lost.",
      interrupted: "This reply was interrupted.",
      quota_unavailable: "This model isn't available for the current AI configuration.",
      provider_config: "This model isn't set up correctly in the current AI configuration.",
    },
    imageRefusal: "The image model declined to create this image.",
    imageFailures: {
      rate_limited: "Image generation is temporarily rate-limited. Please try again shortly.",
      overloaded: "Image generation is temporarily unavailable. Please try again later.",
      timeout: "Creating the image took too long. Please try again.",
      context_too_long: "This request is too long to create an image from.",
      unreadable_file: "An attached image couldn't be used.",
      malformed_response: "The image couldn't be created. Please try again.",
      provider_error: "The image couldn't be created. Please try again.",
      network: "The connection to the image service was lost.",
      interrupted: "Creating this image was interrupted.",
      quota_unavailable: "Image generation isn't available for the current Google AI configuration.",
      provider_config: "Image generation isn't set up correctly in the current Google AI configuration.",
    },
    showEarlier: "Show earlier messages",
    fileRemoved: "File removed",
    uploading: "Uploading…",
    removeAttachment: (name: string) => `Remove ${name}`,
    attachmentCount: (count: number, max: number) => `${count} of ${max} files`,
    storageUsed: (used: string, total: string) => `${used} of ${total} used`,
    fileLimits: (pdf: string, image: string, text: string) => `PDF up to ${pdf} · images up to ${image} · text up to ${text}`,
    rename: "Rename",
    archive: "Archive",
    restore: "Restore",
    delete: "Delete",
    cancel: "Cancel",
    save: "Save",
    saved: "Saved",
    moreActions: "More actions",
    titleLabel: "Conversation title",
    deleteConversationTitle: "Delete this conversation?",
    deleteConversationBody: "Its messages and the files uploaded into it are deleted permanently. Project files stay.",
    archivedConversation: "This conversation is archived. Restore it to keep chatting.",
    archivedProject: "This project is archived. Restore it to start chats or add files.",
    unavailable: "AI replies aren't available right now. Your conversations are still here.",
    project: {
      nameLabel: "Name",
      namePlaceholder: "Launch plan",
      instructionsLabel: "Instructions",
      instructionsHint: "Sent with every message in this project's chats.",
      instructionsPlaceholder: "For example: answer as a product strategist, and keep replies brief.",
      files: "Project files",
      filesHint: "A project file is sent only when you attach it to a message.",
      noFiles: "No files yet.",
      upload: "Upload files",
      conversations: "Chats",
      noConversations: "No chats in this project yet.",
      newChat: "New chat in project",
      create: "Create project",
      settings: "Project settings",
      allProjects: "All projects",
      deleteTitle: "Delete this project permanently?",
      deleteBody: (chats: number, files: number) => `This deletes ${chats} chats and ${files} files. It can't be undone.`,
      deleteConfirm: (name: string) => `Type ${name} to confirm`,
      deleteForever: "Delete permanently",
      deleteFile: (name: string) => `Delete ${name}`,
    },
    disclosure: {
      title: "Before you upload",
      body: [
        "Files you upload are stored in RichHabit. When you attach one to a message, it is sent to the company behind the model that answers, so the model can read it: Anthropic for Claude, or Google for Gemini and image generation.",
        "Anthropic keeps uploaded files until they are deleted, and they are not covered by zero data retention. Google receives a file with each request that uses it, under Google's API terms.",
        "Upload only what you are comfortable sharing with these companies, and never other people's private information.",
      ],
      accept: "Upload and continue",
      decline: "Not now",
    },
    errors: {
      generic: "Something went wrong. Please try again.",
      notFound: "That couldn't be found.",
      restoreConversation: "Restore this conversation to continue it.",
      restoreProject: "Restore this project to add files.",
      busy: "A reply is still being written. Stop it or wait for it to finish.",
      hourLimit: "You've reached this hour's limit for AI replies. Please try again later.",
      dayLimit: "You've reached today's limit for AI replies. Please try again tomorrow.",
      unavailable: "AI replies aren't available right now.",
      duplicateSend: "That message was already sent in another conversation.",
      fileRemoved: "A file you attached has been removed.",
      fileNotEligible: "That file can't be attached to this conversation.",
      emptyMessage: "Write a message or attach a file first.",
      tooManyFiles: (max: number) => `Attach up to ${max} files to one message.`,
      duplicateAttachment: "That file is already attached.",
      messageTooLong: "That message is too long.",
      storageFull: (left: string, total: string) => `Not enough storage: ${left} left of ${total}.`,
      fileTooLarge: (limit: string) => `That file is larger than the ${limit} limit.`,
      fileEmpty: "That file is empty.",
      unsupportedFile: "Only PDF, PNG, JPEG, GIF, WebP and plain text files are supported.",
      disclosureRequired: "Review the upload notice before uploading files.",
      confirmName: "Type the project's name exactly to delete it.",
      cannotContinue: "This reply can't be continued.",
      cannotRetry: "This reply can't be retried.",
      projectNameRequired: "Give the project a name.",
      projectNameTooLong: "That project name is too long.",
      instructionsTooLong: "Those instructions are too long.",
      titleRequired: "Give the conversation a title.",
      titleTooLong: "That title is too long.",
      uploadFailed: (name: string) => `${name} couldn't be uploaded.`,
      offline: "Couldn't reach RichHabit. Check your connection.",
    },
  },

  ui: {
    habitScore: "Habit score",
    less: "Less",
    more: "More",
    sparkEmpty: "Two entries and a line appears here.",
  },
};

export type Dict = typeof en;
