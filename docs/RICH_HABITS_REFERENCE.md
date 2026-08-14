# Rich Habits --- Product & Book Reference

## Purpose

This document consolidates the Rich Habits concepts supplied by the
Product Owner from photographed book pages and subsequent product
decisions.

It is the canonical domain/product reference for implementing the Rich
Habits application.

The book material should be used as **behavior-design inspiration**, not
as proof that particular habits cause wealth, success, health, or any
other outcome.

The product should improve upon the paper workbook by making the process
personalized, measurable, editable, multilingual, and adaptive.

------------------------------------------------------------------------

# 1. Product Vision

Rich Habits should help a person answer:

1.  What am I doing today?
2.  Which behaviors support the life I want?
3.  Which behaviors get in the way?
4.  What should I change first?
5.  What better behavior could replace the old one?
6.  How can I make that behavior easier?
7.  Am I actually following through?
8.  Is the change helping?
9.  What should I keep, modify, add, pause, or retire next?

The app is not merely a checklist.

It is a **personal behavior-awareness, habit-design, tracking, and
continuous-improvement system**.

------------------------------------------------------------------------

# 2. Canonical Product Loop

**Future Mirror / Ideal Life** → **Dreams / Desired Outcomes** →
**Goals** → **Required Actions / Capabilities** → **Starter Habit
Sheet** → **Habit Awareness** → **Habit Audit / Grading** → **Behaviors
the User Wants to Change** → **AI Recommendations** → **Optional Habit
Library** → **Select High-Leverage Changes** → **Design Each Habit** →
**Morning Phase** → **Daytime Phase** → **Nighttime Phase** →
**Consolidated Personalized Habit Sheet** → **Daily Tracking** →
**Weekly Review** → **AI Coach** → **Maintain / Optimize** → repeat

The system should be useful immediately but become increasingly
personalized.

------------------------------------------------------------------------

# 3. Starter Habit Experience

The app should begin with a **small, high-quality starter set** so a new
user is not confronted with a blank screen.

Starter habits are examples, not universal prescriptions.

A reasonable starter set may include:

## Morning

-   Plan today's priorities
-   Exercise / move
-   Read / learn
-   Begin the day intentionally

## Daytime

-   Work on important goals
-   Drink enough water
-   Take movement breaks

## Nighttime

-   Read / learn
-   Prepare for tomorrow
-   Follow an intentional bedtime routine

Keep the starter list small.

The personalization survey then helps the user:

-   keep starter habits
-   remove them
-   edit them
-   change targets/frequency
-   add AI recommendations
-   add their own habits
-   add optional library habits

The result becomes **My Habit Sheet**.

------------------------------------------------------------------------

# 4. Habit Awareness --- Start With Real Life

The book's strongest foundational idea is awareness.

Before deciding what to change, users should be able to record what they
actually do during a typical day.

Example:

-   Wake up
-   Check phone
-   Drink coffee
-   Check email
-   Work
-   Eat lunch
-   Scroll social media
-   Exercise
-   Shop online
-   Watch television
-   Read
-   Go to bed

These are observations, not automatically good or bad habits.

Potential awareness fields:

-   time
-   activity/behavior
-   duration
-   context/location
-   trigger
-   notes

Preserve the user's own wording.

------------------------------------------------------------------------

# 5. User-Provided Behaviors to Change

Every user should have the opportunity to answer:

> **What habits or behaviors would you like to change?**

Allow free text and multiple entries.

Examples include:

-   I sit for hours without standing.
-   I start working without planning my day.
-   I forget important tasks.
-   I check my phone too much.
-   I shop without understanding where my money goes.
-   I don't exercise as consistently as I want.
-   I stay up later than I intend.
-   I procrastinate on important work.

These should initially be **change candidates / awareness records**, not
automatically active habits.

Users should be able to:

-   add
-   edit
-   delete
-   reorder
-   revisit later

------------------------------------------------------------------------

# 6. Habit Grading / Audit

The photographed workbook uses a positive/negative grading concept.

Software should preserve that simple idea while making it more useful.

## Grade

-   `+` Positive / supportive
-   `−` Obstructive / works against the user's intended direction
-   `Neutral / Observe`

## Weight / Importance

Suggested editable scale:

-   Low = 1
-   Medium = 2
-   High = 3
-   Critical = 4

Example:

  ------------------------------------------------------------------------
  Existing         Grade                           Weight Possible Reason
  Behavior                                                
  ---------------- ---------------- --------------------- ----------------
  Exercise         \+                                   3 Supports
                                                          selected health
                                                          goal

  Read             \+                                   2 Supports
                                                          learning

  Start work       −                                    3 May interfere
  without planning                                        with
                                                          prioritization

  Long passive     −                                    3 Competes with a
  scrolling                                               selected goal

  Call family      \+                                   3 Supports
                                                          relationship
                                                          goal
  ------------------------------------------------------------------------

AI may recommend grades/weights, but users decide.

Do not treat a behavior as universally good or bad.

------------------------------------------------------------------------

# 7. Habit Audit Decisions

After awareness/grading, allow behaviors to be organized into:

## KEEP

Existing positive behaviors worth maintaining.

## BUILD

New behaviors the user wants to introduce.

## REDUCE

Behaviors the user wants in moderation but currently does more than
intended.

## REPLACE

Behaviors where a better alternative may meet the same need.

## REMOVE

Behaviors the user explicitly wants to eliminate.

## OBSERVE

Behaviors where the user wants more data before deciding.

Do not automatically delete negative behaviors.

------------------------------------------------------------------------

# 8. AI Recommendations

For each user-provided behavior, AI should recommend a **small set of
possible better behaviors**, not one mandatory answer.

Example:

User: \> I sit for hours while working.

Possible recommendations:

-   Stand/move every 60 minutes.
-   Take a 5-minute walking break every 90 minutes.
-   Walk during selected phone calls.
-   Stretch after a focus block.

User: \> I don't plan my day.

Possible recommendations:

-   Select Top 3 priorities before starting focused work.
-   Review the calendar each morning.
-   Capture tasks in one trusted list.
-   Spend five minutes planning before opening email.

User controls:

-   Add recommendation
-   Edit recommendation
-   Reject recommendation
-   Ask for alternatives
-   Create own replacement

Recommendations should consider the user's goals when available.

------------------------------------------------------------------------

# 9. Bad Habit → Better Habit Relationship

Preserve the relationship between an obstructive behavior and the
selected replacement.

Recommended conceptual model:

**Trigger → Current Behavior → Reward/Need → Friction Intervention →
Replacement Behavior**

Example:

Evening boredom → passive scrolling → relaxation/stimulation → phone
outside reach / app limit → reading, walking, conversation, or another
user-selected alternative

The goal is not merely suppression.

When possible, preserve the underlying need while changing the behavior.

------------------------------------------------------------------------

# 10. Optional Rich Habits Library

The library is **inspiration**, not the user's primary habit list.

Users may browse and add habits beyond direct AI replacements.

Library templates should be searchable and categorized.

Selecting a library item should open a pre-filled habit form. The user
can edit everything before adding it.

Nothing should be added silently.

## Morning Examples

-   Wake at an intentional/consistent time
-   Read for learning
-   Exercise
-   Plan today's priorities
-   Work on a personal goal
-   Listen to educational content during commute
-   Avoid repeatedly checking email first thing
-   Avoid unwanted morning food choices
-   Complete selected goal-related actions

## Daytime Examples

-   Read/learn during lunch or downtime
-   Work on goal-related tasks
-   Avoid gossip if the user wants to change that behavior
-   Avoid unwanted snacking/junk food
-   Check email/communications intentionally rather than continuously
-   Drink water
-   Listen to educational content during commute
-   Make relationship-building calls
-   Complete selected goal-related actions
-   Take intentional breaks

## Nighttime Examples

-   Limit recreational television
-   Limit recreational internet/social media
-   Read for self-education
-   Work on a meaningful goal
-   Develop a marketable skill
-   Work on a personal project/business
-   Participate in networking/community groups
-   Help, coach, or mentor others
-   Spend intentional time with family/relationships
-   Prepare tomorrow's priorities
-   Follow an intentional bedtime/sleep routine

## General Habit-Design Examples

-   Drink more water
-   Reduce passive screen time
-   Spend more time learning
-   Schedule focused work
-   Attach a new behavior to an existing routine
-   Prepare the environment for a habit
-   Add friction to an unwanted behavior
-   Add a replacement behavior
-   Add an accountability partner/community

Templates should remain editable and multilingual.

------------------------------------------------------------------------

# 11. Habit Library Metadata

A template may provide suggested defaults such as:

-   title translation key
-   description translation key
-   time category
-   life category
-   suggested frequency
-   suggested tracking type
-   suggested minimum version
-   suggested target version
-   suggested unit
-   suggested time/window
-   optional habit-design suggestions

Example:

## Read for learning

-   Time: Morning or user-selected
-   Minimum: 2 pages
-   Target: 30 minutes
-   Tracking: duration or quantity

## Exercise

-   Minimum: 5--10 minutes
-   Target: user-selected
-   Frequency: user-selected
-   Tracking: duration/frequency

## Work on meaningful goal

-   Minimum: 5 minutes
-   Target: 45--60 minutes
-   Tracking: duration or Boolean

Defaults are suggestions only.

------------------------------------------------------------------------

# 12. Personalized Habit Selection Workspace

After recommendations/library exploration, provide a workspace such as:

## Behaviors I Want to Change

The user's original change candidates.

## Recommended Habits

AI-generated possibilities.

## Library Habits I Added

Optional templates the user selected.

## My Focus Habits

The manageable set the user chooses to activate now.

Nothing becomes active without user approval.

------------------------------------------------------------------------

# 13. Prioritize Gradual Change

If a user enters many behaviors, do not automatically activate all
recommended replacements.

AI can suggest a manageable starting set based on:

-   user priority
-   goal alignment
-   likely impact
-   effort
-   dependencies
-   whether one change may support several others

Example:

> You identified 12 behaviors you would like to change. Consider
> starting with these four.

The user may override the recommendation.

Unused candidates remain in the Habit Backlog.

------------------------------------------------------------------------

# 14. Habit Backlog and Lifecycle

Suggested statuses:

-   Candidate
-   Recommended
-   Planned
-   Active
-   Paused
-   Established
-   Retired

A user should be able to:

-   activate
-   pause
-   edit
-   replace
-   retire
-   reactivate

without losing history.

------------------------------------------------------------------------

# 15. Phased Habit Building From the Book

The photographed pages organize new habits into:

1.  Morning
2.  Daytime
3.  Nighttime
4.  Consolidated checklist

The app should preserve this useful progression.

## Phase 1 --- Morning

Introduce a manageable set of morning changes.

## Phase 2 --- Daytime

Keep appropriate morning habits and add selected daytime changes.

## Phase 3 --- Nighttime

Continue prior habits and add selected nighttime changes.

## Phase 4 --- Consolidated Habit Sheet

Merge the user's chosen ongoing habits into one personalized long-term
tracker.

Phases should guide rather than rigidly constrain the user.

------------------------------------------------------------------------

# 16. Weekly Checklist

The paper workbook uses a weekly checklist structure:

  Habit   Sun   Mon   Tue   Wed   Thu   Fri   Sat
  ------- ----- ----- ----- ----- ----- ----- -----

The app should improve this by showing:

-   scheduled vs. unscheduled days
-   completion
-   minimum completion
-   target completion
-   completion %
-   current streak
-   longest streak
-   best/strongest habit
-   repeatedly missed habit
-   weekly notes/review

Do not punish users visually for missed days.

------------------------------------------------------------------------

# 17. Consolidated Personalized Habit Sheet

After personalization/phased onboarding, the user should have one main
tracking view.

Example:

## Morning

-   Brush teeth
-   Wash face
-   Exercise when scheduled
-   Plan Top 3 priorities

## Daytime

-   Stand/move periodically
-   Complete selected priorities
-   Drink water

## Nighttime

-   Brush teeth
-   Read
-   Prepare tomorrow
-   Follow bedtime routine

## Anytime

-   Record spending
-   Relationship/community action
-   Other user-selected habits

Every user's sheet can be different.

This personalized sheet is the long-term daily tracking system.

------------------------------------------------------------------------

# 18. Habit Categories

Use two dimensions when helpful.

## Time Category

-   Morning
-   Daytime
-   Nighttime
-   Anytime

## Life Domain

-   Health & Fitness
-   Personal Care
-   Productivity
-   Career / Work
-   Learning
-   Financial
-   Relationships / Community
-   Personal Growth
-   Sleep
-   Recreation / Digital Wellness
-   Other

Examples:

  Habit                Time              Life Domain
  -------------------- ----------------- ------------------
  Brush teeth          Morning + Night   Personal Care
  Plan Top 3           Morning           Productivity
  Stand periodically   Daytime           Health & Fitness
  Record spending      Anytime           Financial
  Read                 User-selected     Learning

AI may suggest categories. User decides.

------------------------------------------------------------------------

# 19. Habit Tracking Types

Not every habit is a checkbox.

Support:

## Boolean

Example: Wash face.

## Count

Example: Brush teeth `2/2`.

## Duration

Example: Read `25/30 min`.

## Quantity

Example: Water `6/8 glasses`.

## Frequency

Example: Exercise `3/4 days this week`.

## Interval

Example: Stand/move every 60 minutes.

## Time

Example: Bedtime `10:42 PM`, goal `10:30 PM`.

## Maximum / Reduction

Example: Recreational screen time `52/≤60 min`.

## Avoidance

Example: No unnecessary email checking before planning.

## Financial

Example: record amount/category/planned-vs-unplanned.

## Routine

Example: complete selected components of morning routine.

The Today experience should adapt to tracking type.

------------------------------------------------------------------------

# 20. Minimum Version and Target Version

Each habit may have:

## Minimum

The smallest version that still counts as meaningful progress.

## Target

The intended full version.

Examples:

Read: - Minimum: 2 pages - Target: 30 minutes

Meaningful goal work: - Minimum: 5 minutes - Target: 45 minutes

Track minimum and target separately.

A minimum win should count without falsely showing that the full target
was achieved.

------------------------------------------------------------------------

# 21. Habit Stacking / Merging

One of the behavior-change techniques in the supplied material is
attaching a new behavior to an existing routine.

Model:

**Existing anchor/cue → New behavior → Location/context → Frequency →
Linked goal → Completion history**

UI pattern:

> After I \_\_\_\_\_\_, I will \_\_\_\_\_\_.

Examples:

-   After morning coffee → drink water.
-   After sitting down at the desk → review priorities.
-   During commute → listen to learning content.

AI may suggest anchors from Habit Awareness data.

User chooses/edits.

------------------------------------------------------------------------

# 22. Environment Design

Environment design works in both directions.

## Reduce friction for desired habits

Examples:

-   prepare materials
-   place cues in sight
-   preconfigure tools/apps
-   choose convenient locations
-   prepare workout clothing
-   place a book where it will be used

## Increase friction for unwanted habits

Examples:

-   remove cues
-   move tempting items/apps
-   disable notifications
-   log out
-   use app limits
-   change default placement
-   put a device outside reach
-   substitute a preferred alternative

Each habit may have an optional **Environment Setup** checklist.

------------------------------------------------------------------------

# 23. Start Small

Do not imply that users must perform the ideal behavior perfectly
immediately.

Support small, repeatable starting versions.

The AI Coach may recommend simplifying a repeatedly missed habit rather
than treating the user as failing.

------------------------------------------------------------------------

# 24. Scheduling and Accountability

Habits may optionally have:

-   specific time
-   time window
-   routine position
-   calendar/task cue
-   days of week
-   accountability partner/community

The habit tracker should complement task/calendar systems rather than
assume users will remember everything.

If a habit is repeatedly missed, AI may recommend:

-   different time
-   different cue
-   smaller minimum
-   environment change
-   replacement
-   pause

------------------------------------------------------------------------

# 25. Social Support

Optional fields/features may include:

-   accountability partner
-   community/group
-   private check-in
-   shared challenge
-   weekly accountability summary

Participation must be opt-in and privacy-conscious.

Do not frame social support as judging or abandoning other people.

Focus on adding supportive contexts and managing triggers.

------------------------------------------------------------------------

# 26. Personal Behaviors Identified by the Product Owner

The following examples are useful for validating the product model. They
are **not universal defaults for all users**.

## Long uninterrupted sitting

Current behavior: - Sometimes works for hours without standing.

Potential design: - Interval-based movement habit. - Example: stand/move
every selected number of minutes. - Could use focus blocks, calls,
coffee, or meetings as anchors.

## Poor daily planning/prioritization

Current behavior: - Sometimes begins working immediately without
planning. - Important tasks may be forgotten.

Potential design: - Choose Top 3 priorities before focused work. -
Capture other tasks/things to remember. - Review unfinished priorities
later.

## Personal-care consistency

Examples: - Wash face according to intended routine. - Shower according
to user-selected frequency. - Brush teeth morning and night.

Do not assume every personal-care behavior must occur daily unless the
user chooses that target.

Brushing twice daily is naturally represented as a count or
morning/night routine rather than one Boolean checkbox.

## Exercise consistency

Allow user-selected: - days/week - duration - type - minimum - target

Do not automatically require exercise every day.

## Starting work too quickly

Treat "start work" as a transition/cue that may crowd out the intended
morning routine.

Potential sequence:

**Morning routine → Start work**

## Spending awareness

Current problem: - Spending/shopping may occur without understanding
category percentages.

Potential solution: - spending-awareness records - category totals -
planned/unplanned - need/want - percentage of tracked spending - monthly
comparison

These examples demonstrate why the app needs multiple tracking types and
personalized behavior design.

------------------------------------------------------------------------

# 27. Spending Awareness Module

Potential fields:

-   date
-   amount
-   merchant/description
-   category
-   need vs. want
-   planned vs. unplanned
-   notes

Suggested categories:

-   Housing
-   Food
-   Shopping
-   Transportation
-   Travel
-   Entertainment
-   Personal Care
-   Education
-   Gifts
-   Other

Useful metrics:

-   total tracked spending
-   spending by category
-   category percentage
-   planned vs. unplanned
-   month-over-month comparison

Formula:

**Category % = Category Spending / Total Tracked Spending × 100**

The purpose is awareness, not shame.

------------------------------------------------------------------------

# 28. Goals

Habits may connect to larger goals such as:

-   Health
-   Career
-   Learning
-   Relationships
-   Financial
-   Personal project
-   Sleep
-   Fitness
-   Other user-created goals

Useful relationship:

**Goal → Supporting Habits → Progress**

The app should help users understand not only whether they completed a
habit, but why they chose it.

------------------------------------------------------------------------

# 29. Habit Score

Keep scoring simple and interpretable.

Basic completion score:

**completed scheduled habits / total scheduled habits × 100**

Optional weighted score:

**sum(completed habit weights) / sum(scheduled habit weights) × 100**

Do not confuse:

-   audit grade (+/−/neutral)
-   importance weight
-   daily completion
-   minimum completion
-   target completion

Avoid excessive gamification.

------------------------------------------------------------------------

# 30. Weekly Review

Every week, summarize:

-   scheduled habits
-   completed habits
-   consistency
-   strongest habit
-   most frequently missed habit
-   longest streak
-   minimum vs. target performance where applicable

Ask reflective questions such as:

-   What went well?
-   What got in the way?
-   Which habit should I focus on next?
-   Should anything be simplified?
-   Should anything be rescheduled?
-   Should anything be replaced?
-   Is it time to add a backlog habit?

Store reviews for longitudinal analysis.

------------------------------------------------------------------------

# 31. AI Coach Maintenance Decisions

Over time, the AI Coach may recommend:

-   Keep
-   Scale
-   Simplify
-   Reschedule
-   Change anchor
-   Change environment
-   Add friction
-   Replace
-   Pause
-   Retire
-   Introduce next backlog habit

Recommendations should use:

-   user goals
-   adherence
-   minimum/target performance
-   time patterns
-   habit relationships
-   user feedback
-   observed outcomes

Do not make unsupported causal claims.

------------------------------------------------------------------------

# 32. Evidence-Based Personal Insights

The AI may eventually say things such as:

> You tend to miss selected morning habits on days when you start work
> immediately.

or:

> On days when you complete planning, you also complete more of your
> selected high-priority tasks.

or:

> Shopping represented 24% of your tracked discretionary spending this
> month versus 16% last month.

Only say these when underlying data supports them.

Use cautious language for correlation.

------------------------------------------------------------------------

# 33. Multilingual Product Behavior

System-provided content must use translation keys.

Examples:

-   starter habits
-   habit-library templates
-   categories
-   system descriptions
-   UI labels

Example keys:

-   `templates.read_learning.title`
-   `templates.exercise.title`
-   `templates.plan_priorities.title`

English/Chinese examples:

  English                           Chinese
  --------------------------------- --------------------
  Read for learning                 阅读学习
  Exercise                          锻炼
  Plan today's priorities           规划今日优先事项
  Work on a personal goal           推进个人目标
  Avoid repeatedly checking email   避免频繁查看邮件
  Drink enough water                喝足够的水
  Avoid junk food                   避免垃圾食品
  Limit recreational TV             限制娱乐性电视时间
  Limit recreational internet       限制娱乐性上网时间
  Read for self-education           自我学习阅读
  Work on a meaningful goal         推进有意义的目标
  Prepare tomorrow's priorities     准备明日优先事项
  Go to bed on time                 按时睡觉

User-created text should remain exactly as entered unless the user
explicitly asks to translate it.

------------------------------------------------------------------------

# 34. Admin Analytics Product Requirement

The app is multi-user.

An admin-only analytics area should help the Product Owner understand
adoption and engagement without unnecessarily exposing private habit
content.

Important metrics:

-   total users
-   new users
-   DAU
-   WAU
-   MAU
-   DAU/MAU
-   returning users
-   activation
-   Day 1 / Day 7 / Day 30 retention
-   sessions
-   feature adoption
-   funnel conversion
-   day/hour usage patterns
-   aggregate habit engagement

Potential activation definition:

> User creates/selects at least one habit and records habit activity on
> at least three different days during the first seven days.

Keep thresholds configurable.

------------------------------------------------------------------------

# 35. Admin Usage-Time Analytics

Track when users use the product.

Useful views:

-   activity by hour
-   activity by day of week
-   Day-of-Week × Hour heatmap
-   sessions per user
-   average/median session duration
-   events per session

Store event timestamps in UTC and derive local reporting time
appropriately.

------------------------------------------------------------------------

# 36. Product Funnel

Useful funnel:

**Registered** → **Created/selected first habit** → **Completed first
habit** → **Returned next day** → **Tracked on multiple days** →
**Completed weekly review** → **Active after 30 days**

Show both counts and conversion percentages.

------------------------------------------------------------------------

# 37. Privacy Principle

The user's habit sheet can contain highly personal behavioral
information.

Admin analytics should primarily answer:

-   Is the product being used?
-   How frequently?
-   Which features?
-   When?
-   Are users returning?
-   Where do users drop off?

Do not expose private notes, journal entries, detailed health
information, private goals, or sensitive habit descriptions by default.

------------------------------------------------------------------------

# 38. Product UX Principles

The product should feel:

-   premium
-   calm
-   simple
-   modern
-   executive
-   supportive
-   mobile-first
-   not childish
-   not shame-based
-   not excessively gamified

The most common daily action---tracking today's habits---should be
extremely fast.

Use clear empty/loading/error states.

Missed habits should not trigger punitive messaging.

A useful tone is:

> Start again today.

------------------------------------------------------------------------

# 39. Key Product Distinctions

Keep these separate:

## Habit Grade

Whether an observed behavior currently supports or obstructs the user's
goals.

## Habit Weight

How important/high-leverage the behavior is to the user.

## Habit Status

Candidate, planned, active, paused, etc.

## Habit Completion

Whether the intended behavior occurred on a scheduled occasion.

## Minimum Completion

Whether the minimum version occurred.

## Target Completion

Whether the target version occurred.

## Outcome Metric

A separate measurable result such as spending, weight, sleep, or another
user-selected metric.

These concepts should not be overloaded into one field.

------------------------------------------------------------------------

# 40. Recommended Onboarding

A strong onboarding sequence:

### Step 1 --- Immediate Value

Show a small starter Habit Sheet.

### Step 2 --- Desired Direction

Ask about goals / what the user wants to improve.

### Step 3 --- What Would You Like to Change?

Collect user-provided bad habits/behaviors.

### Step 4 --- Habit Audit

Allow + / − / neutral and importance.

### Step 5 --- AI Suggestions

Offer several possible better/replacement habits.

### Step 6 --- Explore Library

Optional curated habits.

### Step 7 --- Choose Focus

Select a manageable starting set.

### Step 8 --- Customize

For each habit choose/edit: - category - frequency - schedule - tracking
type - minimum - target - anchor - environment - friction - priority -
goal

### Step 9 --- Preview

Show the personalized Habit Sheet.

### Step 10 --- Start Tracking

Enter the Today experience.

The user should be able to skip/refine onboarding and revisit **Refine
My Habits** later.

------------------------------------------------------------------------

# 41. Long-Term Maintenance

Personalization is not a one-time survey.

Users should be able to revisit:

**Refine My Habits**

Life circumstances and goals change.

The system should allow the personalized sheet to evolve without losing
history.

------------------------------------------------------------------------

# 42. What the Product Must Not Do

Do not:

-   claim specific habits create wealth
-   claim correlations prove causation
-   promise automatic habit formation after a fixed number of days/weeks
-   automatically label all behaviors as universally good/bad
-   automatically activate every AI recommendation
-   erase the original obstructive behavior after replacement
-   lose history when habits change
-   force every habit into a Boolean checkbox
-   expose private habit content unnecessarily to administrators
-   shame users for missed habits
-   make core tracking dependent on AI availability

------------------------------------------------------------------------

# 43. Canonical Product Statement

The experience should feel like:

> **Tell me what you want your life to look like and what is getting in
> the way. I will help you understand your current behaviors, choose a
> few high-value changes, design habits that fit your life, build your
> own tracking sheet, and improve it over time based on what actually
> works for you.**

It should **not** feel like:

> Here is a universal list of habits successful people supposedly
> follow. Check them all.

------------------------------------------------------------------------

# 44. Implementation North Star

The product combines:

**Starter Guidance** + **User's Real Behaviors** + **Goals** + **AI
Recommendations** + **Optional Habit Library** + **Habit Design** +
**Personalized Tracking** + **Weekly Reflection** + **Evidence From the
User's Own History**

to create an evolving, individualized Rich Habits system.

The long-term value is not the predefined habit list.

The long-term value is the user's **personalized Habit Sheet and the
learning loop around it**.
