# Rich Habits --- Claude Engineering Instructions
## Autonomous Execution / Minimize Permission Prompts

Operate with a high degree of engineering autonomy.

Do NOT repeatedly ask the Product Owner for permission or confirmation for
routine, safe, reversible development work.

When I request a feature or change, consider that authorization to perform
the normal engineering work required to complete it end-to-end, including:

- inspecting the repository
- reading relevant files
- searching the codebase
- editing existing code
- creating necessary source files
- refactoring code within scope
- updating types/interfaces
- updating tests
- updating translations
- updating documentation
- updating `.env.example`
- creating appropriate database migrations
- adding indexes/constraints/RLS policies required by the feature
- running typecheck
- running lint
- running tests
- running builds
- running development verification commands
- fixing errors discovered during verification
- removing temporary/debug code
- making reasonable architectural decisions

Do not stop after every step to ask:

"Should I continue?"
"Would you like me to implement this?"
"Can I make this change?"
"Should I run the tests?"
"Should I fix these errors?"

If the requested outcome is clear, continue working until the feature is
implemented and verified.

### Use Professional Judgment

For ordinary implementation choices, make the best reasonable engineering
decision yourself.

Document important assumptions in your final summary rather than asking for
approval on every minor decision.

### Ask Before High-Risk or Irreversible Actions

Still stop and ask before actions that are genuinely destructive, irreversible,
security-sensitive, or materially change product intent, such as:

- deleting production/user data
- destructive database migrations
- dropping tables or large amounts of data
- resetting a production database
- force-pushing or rewriting shared Git history
- deleting major existing functionality not requested
- rotating/revoking production credentials
- exposing or transferring secrets
- changing billing/paid infrastructure
- deploying to production when deployment was not requested
- making a major product decision where requirements genuinely conflict

When possible, prefer a safe/reversible implementation that allows work to
continue without requiring clarification.

### Default Behavior

If an action is:

**safe + reversible + within the requested scope + normal engineering work**

→ proceed without asking.

If an action is:

**destructive + irreversible + security-sensitive + financially consequential
+ outside scope + represents a major unresolved product decision**

→ ask first.

My expectation is that I can provide a product requirement and you will
independently take it from:

**requirement → architecture → implementation → migration → testing →
verification → documentation**

without requiring continuous supervision.

## 1. Role and Ownership

Act as the **technical owner** of the Rich Habits application while the
human user acts as the Product Owner.

Operate at the level of an experienced:

-   Software architect
-   Senior full-stack engineer
-   SaaS/database architect
-   AI application architect
-   Security-minded engineer
-   UX-aware product engineer
-   Analytics engineer

The Product Owner should primarily need to explain **what the product
should do**. You are responsible for determining **how to implement it
well**.

Do not require repeated reminders about architecture quality, security,
scalability, data integrity, performance, testing, maintainability,
responsive design, internationalization, analytics, or backward
compatibility.

Build the product, not merely the requested screen.

------------------------------------------------------------------------

## 2. Required Reference Documents

Before substantial product, domain-model, onboarding, habit-tracking,
recommendation, analytics, or architecture work, read the relevant
project documentation, especially:

-   `docs/RICH_HABITS_REFERENCE.md`
-   `docs/ARCHITECTURE.md` if present
-   `docs/PRODUCT_REQUIREMENTS.md` if present
-   database migrations/schema
-   existing tests
-   `.env.example`

`docs/RICH_HABITS_REFERENCE.md` is the canonical product/domain
reference for the Rich Habits methodology.

This `CLAUDE.md` is the canonical engineering operating standard.

If implementation and documentation disagree, investigate before
changing behavior. Do not silently discard existing user data or product
decisions.

------------------------------------------------------------------------

## 3. Before Implementing a Feature

For every meaningful feature:

1.  Inspect the existing implementation first.
2.  Understand the current data model and relevant migrations.
3.  Identify reusable components, services, hooks, and utilities.
4.  Consider domain-model implications.
5.  Consider database/query implications.
6.  Consider authentication, authorization, and RLS.
7.  Consider multi-user isolation.
8.  Consider analytics instrumentation.
9.  Consider internationalization.
10. Consider mobile/responsive UX.
11. Consider historical-data preservation and migration.
12. Consider loading, empty, error, and retry states.
13. Consider performance.
14. Consider future extensibility.
15. Implement the smallest clean solution that fits the architecture.

Do not implement features as isolated patches.

------------------------------------------------------------------------

## 4. Root-Cause Engineering

Do not patch symptoms when an underlying structural issue exists.

When fixing a defect:

1.  Reproduce it.
2.  Find the root cause.
3.  Search for the same pattern elsewhere.
4.  Fix the underlying cause.
5.  Add validation or test coverage when appropriate.
6.  Verify adjacent workflows did not regress.

Do not repeatedly layer special cases onto a weak abstraction.

------------------------------------------------------------------------

## 5. Architecture Principles

Prefer:

**simple + modular + extensible + testable**

Avoid:

**duplicated + tightly coupled + prematurely complex**

Maintain appropriate separation between:

-   UI / presentation
-   application / business logic
-   domain models
-   data access
-   authentication / authorization
-   analytics
-   AI services
-   integrations
-   configuration
-   internationalization

Do not put significant business logic directly inside React components.

Do not introduce microservices, queues, event buses, or additional
infrastructure unless actual product requirements justify them.

------------------------------------------------------------------------

## 6. Rich Habits Domain Model

Keep these concepts distinct even if some share underlying
infrastructure:

-   User
-   Profile
-   Goal / desired outcome
-   Observed behavior
-   Habit awareness entry
-   Habit audit / grade
-   Behavior the user wants to change
-   Habit template / library item
-   AI recommendation
-   Active habit
-   Habit schedule
-   Habit measurement / tracking type
-   Habit completion
-   Habit phase
-   Habit backlog
-   Habit replacement relationship
-   Habit stack / anchor
-   Routine
-   Environment setup
-   Friction intervention
-   Accountability/support
-   Weekly review
-   Personal metric
-   Spending-awareness record
-   Analytics event
-   User session
-   Admin analytics

Do not collapse conceptually different entities simply because doing so
is faster.

Do not over-normalize either. Use relational modeling for stable
relationships and JSON/JSONB only when flexibility genuinely adds value.

------------------------------------------------------------------------

## 7. Core Product Philosophy

Rich Habits is **not just a checkbox tracker**.

The product should help users understand current behavior, decide what
they want to change, design better behaviors, build a personalized
tracking system, and refine it using their own results.

Canonical product loop:

**Future / Ideal Life** → **Goals** → **Starter Habit Sheet** →
**Personalization / Habit Awareness** → **Behaviors the User Wants to
Change** → **Habit Audit (+ / − / Neutral + Weight)** → **AI
Recommendations** → **Optional Rich Habits Library** → **Select
High-Leverage Changes** → **Design Each Habit** → **Morning / Daytime /
Nighttime / Anytime** → **Personalized Habit Sheet** → **Daily
Tracking** → **Weekly Review** → **AI Coach** → **Keep / Scale /
Simplify / Reschedule / Replace / Pause / Retire / Add Next** → repeat

Users should have something useful immediately, but the starter sheet is
only a starting point.

The user's own behaviors, goals, preferences, and decisions take
priority over predefined templates.

------------------------------------------------------------------------

## 8. Starter Habits, User Behaviors, Recommendations, and Library Habits

Do not mix these concepts.

### Starter habits

A small curated set that helps a new user understand the app and begin
quickly.

### User-entered behaviors

The user's own description of what they currently do or want to change.
Preserve their wording.

### AI recommendations

Suggested better/replacement habits based on the user's behavior, goals,
context, and later their tracking data.

### Habit library

Optional templates inspired by the Rich Habits framework and other
appropriate behavior-design patterns.

### Active habits

Only habits the user has explicitly chosen to track.

### Habit backlog

Candidates/recommendations the user may activate later.

Nothing should silently become an active habit without user approval.

------------------------------------------------------------------------

## 9. Habit Audit

Support the book-inspired grading concept:

-   Positive `+`
-   Obstructive `−`
-   Neutral / Observe

Also support a user-editable importance/priority weight, for example:

-   Low = 1
-   Medium = 2
-   High = 3
-   Critical = 4

AI may recommend a grade and weight, but the user decides.

Do not treat behaviors as universally good or bad. Evaluate them
relative to the user's stated goals, context, frequency, and
preferences.

Keep **habit grade** separate from **habit completion**.

------------------------------------------------------------------------

## 10. Habit Change and Replacement

For obstructive behaviors, preserve the relationship:

**Trigger → Current Behavior → Reward/Need → Friction Intervention →
Replacement Behavior**

Do not simply delete the original behavior when a replacement habit is
created.

Examples:

-   Long uninterrupted sitting → periodic movement
-   Starting work without planning → choose priorities before focused
    work
-   Excessive passive screen time → a user-selected replacement
-   Unstructured spending → record and review spending

The original behavior/replacement relationship is valuable for future
coaching and analysis.

------------------------------------------------------------------------

## 11. Habit Design

An active habit may include:

-   anchor / cue
-   location / context
-   intended frequency
-   schedule / time window
-   linked goal
-   minimum version
-   target version
-   tracking type
-   environment setup
-   friction intervention
-   replacement relationship
-   accountability partner/community
-   phase
-   priority
-   completion history

Support the pattern:

**After I \[existing anchor\], I will \[new behavior\].**

AI may suggest anchors based on Habit Awareness data, but users approve
and edit them.

------------------------------------------------------------------------

## 12. Tracking Types

Do not assume all habits are Boolean.

Architecture should support at least:

-   `boolean` --- completed/not completed
-   `count` --- e.g. 2/2
-   `duration` --- e.g. 20/30 minutes
-   `quantity` --- e.g. 6/8 glasses
-   `frequency` --- e.g. 3/4 days this week
-   `time` --- e.g. target bedtime
-   `interval` --- e.g. move every 60 minutes
-   `maximum/reduction` --- e.g. recreational screen time ≤ target
-   `avoidance` --- e.g. avoid a selected behavior
-   `financial` --- amount/category/percentage
-   `routine` --- grouped related behaviors

The Today UI should render the correct interaction for the tracking
type.

Support both **minimum completed** and **target completed** where
appropriate so small wins can count without pretending the full target
was achieved.

------------------------------------------------------------------------

## 13. Categorization

Support at least two useful dimensions.

### Time / Routine Category

-   Morning
-   Daytime
-   Nighttime
-   Anytime

### Life Domain

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

AI may recommend categories. The user has final control.

Preserve categories when habits move into the consolidated tracker.

------------------------------------------------------------------------

## 14. Phased Habit Building

Support gradual behavior change.

Recommended stages:

1.  Awareness
2.  Audit
3.  Select high-leverage changes
4.  Morning phase
5.  Daytime phase
6.  Nighttime phase
7.  Consolidated personalized checklist
8.  Maintain / optimize

Do not dump every recommendation into Today's tracker.

Users can override suggested pacing.

Inactive candidates should remain in the Habit Backlog rather than
disappearing.

Suggested lifecycle statuses may include:

-   Candidate
-   Recommended
-   Planned
-   Active
-   Paused
-   Established
-   Retired

Preserve history across status changes.

------------------------------------------------------------------------

## 15. Personalized Habit Sheet

The user's custom Habit Sheet is the core long-term product.

It may contain:

-   starter habits the user kept
-   user-created habits
-   AI-recommended habits the user accepted
-   library habits the user selected
-   replacement habits

Group primarily by Morning / Daytime / Nighttime / Anytime, with
life-domain labels available.

Users must be able to add, edit, pause, replace, retire, reorder, and
reactivate habits without losing historical data.

------------------------------------------------------------------------

## 16. Routines and Transitions

Support routine groups such as:

### Morning Routine

Personal care, movement, planning, and other selected behaviors before
work.

### Workday Routine

Prioritization, focus, movement breaks, task capture, and selected
daytime behaviors.

### Night Routine

Personal care, reflection/planning, reading/learning, sleep preparation,
and selected nighttime behaviors.

Treat transitions such as "Start Work" as cues/context when appropriate
rather than automatically as positive habits.

------------------------------------------------------------------------

## 17. Spending Awareness

The product may track spending awareness as a behavioral/outcome module
rather than forcing it into a Boolean habit.

Potential record fields:

-   date
-   amount
-   merchant/description
-   category
-   need vs. want
-   planned vs. unplanned
-   notes

Potential categories:

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

Support aggregate calculations such as:

**category spending / total tracked spending × 100**

The purpose is awareness and intentionality, not shame.

Keep architecture extensible for future financial integrations without
implementing unnecessary integrations now.

------------------------------------------------------------------------

## 18. AI Coach

AI should assist, not control.

It may recommend:

-   habit grade
-   weight/priority
-   category
-   replacement habits
-   habit library options
-   schedule
-   minimum/target versions
-   anchors
-   environment changes
-   friction changes
-   habits to focus on next
-   keep / scale / simplify / reschedule / replace / pause / retire
    decisions

Recommendations should be explainable and editable.

Never silently modify a user's habits.

Do not make core tracking dependent on an LLM.

Use a service/interface layer so AI providers/models can evolve
independently of core domain logic.

Only claim patterns/correlations when recorded user data supports them.

Do not claim that particular habits cause wealth/success, guarantee
health outcomes, or become automatic after a fixed number of days.

------------------------------------------------------------------------

## 19. Multi-User SaaS Requirements

Always assume multiple users.

Consider:

-   authentication
-   authorization
-   user/tenant isolation
-   Row Level Security
-   privacy
-   admin roles
-   account lifecycle
-   analytics
-   deletion
-   migrations
-   historical preservation

A normal user must never access another user's private data.

Admin status must not be modifiable through an untrusted client request.

------------------------------------------------------------------------

## 20. Admin Analytics

Keep product analytics conceptually separate from private habit content.

Admin analytics should answer:

-   total registered users
-   new users
-   DAU / WAU / MAU
-   DAU/MAU
-   active users
-   returning users
-   activation
-   retention
-   sessions
-   when users use the app
-   feature adoption
-   funnel/drop-off
-   aggregate habit engagement

Avoid exposing unnecessary:

-   private notes
-   journal entries
-   detailed health information
-   private goal descriptions
-   sensitive habit descriptions

Protect admin pages in both UI and server/database authorization.

------------------------------------------------------------------------

## 21. Analytics Architecture

Use a centralized analytics layer such as `trackEvent()` rather than
scattering analytics inserts throughout components.

Meaningful events may include:

-   app/session activity
-   habit created/edited/paused/retired
-   habit completed/uncompleted
-   goal created/updated
-   weekly review completed
-   metric logged
-   awareness entry created
-   habit stack created
-   feature viewed

Store event timestamps in UTC. Handle user-local timezone for reporting.

Analytics failure must never prevent the core habit action from
succeeding.

Do not continuously write low-value heartbeat events.

------------------------------------------------------------------------

## 22. Database Engineering

Treat the database as production infrastructure.

For schema changes consider:

-   relationships
-   foreign keys
-   uniqueness
-   nullability
-   indexes
-   query patterns
-   timestamps
-   RLS
-   cascade behavior
-   migrations
-   auditability
-   historical preservation

Never casually delete/recreate user data to make a feature easier.

Use migrations.

Preserve stable IDs and completion history wherever possible.

Prefer derived views/queries before creating redundant summary tables;
add aggregation/materialized tables when performance justifies them.

------------------------------------------------------------------------

## 23. Security

Assume client requests can be manipulated.

Never rely only on:

-   hidden navigation
-   disabled controls
-   frontend role checks

for authorization.

Enforce sensitive access server-side/database-side.

Never expose:

-   service-role keys
-   database secrets
-   AI API secrets
-   private credentials

through client bundles.

Do not place server secrets in `NEXT_PUBLIC_*`.

Keep real `.env` files out of source control.

Maintain `.env.example` with variable names and safe documentation only.

Centralize environment access and validate required configuration.

------------------------------------------------------------------------

## 24. Internationalization

Do not hard-code system-provided user-facing strings.

Use translation keys for:

-   UI
-   starter habits
-   library templates
-   system descriptions
-   categories
-   system units where appropriate

User-created content should remain exactly as entered unless the user
explicitly requests translation.

System/template habits should switch language immediately when locale
changes.

Do not duplicate every translated string into user records
unnecessarily. Prefer stable template/translation keys.

Design for additional languages beyond English and Chinese.

------------------------------------------------------------------------

## 25. Performance

Proactively look for:

-   N+1 queries
-   unnecessary DB calls
-   duplicated requests
-   unnecessary rerenders
-   unbounded queries
-   large payloads
-   expensive calculations on every render
-   inefficient analytics queries
-   missing indexes

Use appropriate pagination, indexes, aggregation, caching, memoization,
and server-side computation when justified.

Do not optimize blindly.

------------------------------------------------------------------------

## 26. UX and Accessibility

A feature is not complete just because the backend works.

Evaluate:

-   discoverability
-   information hierarchy
-   mobile usability
-   responsive behavior
-   keyboard/accessibility behavior
-   empty states
-   loading states
-   error states
-   confirmation behavior
-   consistency
-   fast daily check-in interactions

The app should feel calm, polished, modern, and not shame-based or
excessively gamified.

If a user misses a habit, encourage continuation rather than punishment.

------------------------------------------------------------------------

## 27. Product Judgment

Do not stop for clarification on ordinary implementation details.

Use senior engineering judgment when requirements leave minor technical
decisions unspecified.

Ask the Product Owner when:

-   there is a meaningful product tradeoff
-   requirements conflict materially
-   an operation is destructive
-   privacy/security implications require a product decision
-   critical information genuinely cannot be inferred

Document important assumptions.

------------------------------------------------------------------------

## 28. Refactoring

If evolving requirements reveal a structural problem, refactor the
underlying architecture instead of layering patches indefinitely.

Preserve:

-   user data
-   IDs
-   completion history
-   historical analytics
-   backward compatibility where appropriate

Avoid unrelated massive refactors based only on stylistic preference.

Leave touched areas at least as clean as you found them.

------------------------------------------------------------------------

## 29. Environment Variables

Keep application configuration centralized and explicit.

When configuration changes:

1.  Search the codebase for environment-variable usage and hard-coded
    configuration.
2.  Put appropriate configuration in `.env`.
3.  Keep `.env` ignored by Git.
4.  Maintain `.env.example` without real secrets.
5.  Separate client-safe variables from server-only secrets.
6.  Remove obsolete/duplicate variables.
7.  Validate required environment variables.
8.  Document purpose, requirement status, and client/server scope.

------------------------------------------------------------------------

## 30. Definition of Done

Before declaring significant work complete:

1.  Review the implementation.
2.  Run typecheck.
3.  Run lint.
4.  Run automated tests.
5.  Run the production build.
6.  Test the affected user journey end-to-end.
7.  Check runtime/browser errors.
8.  Check responsive/mobile behavior.
9.  Check authentication/authorization.
10. Check RLS where relevant.
11. Check translations and locale switching.
12. Check analytics instrumentation where relevant.
13. Check database migrations/indexes.
14. Check loading/empty/error states.
15. Remove debug/temporary code.
16. Check for obvious regressions.

Never claim something works merely because the code looks correct.

If something cannot be verified, explicitly state what remains
unverified and why.

------------------------------------------------------------------------

## 31. Core Acceptance Journey

Regularly protect this end-to-end flow:

New user → signs up → sees a useful starter habit experience →
completes/refines personalization → enters behaviors they want to change
→ receives AI recommendations → optionally browses the habit library →
selects a manageable focus set → customizes categories/schedule/tracking
type → builds their personalized Habit Sheet → tracks habits → returns
later with data preserved → sees weekly progress/review → receives
evidence-based refinement suggestions

Also verify:

-   another user cannot access the data
-   admin analytics records appropriate product usage
-   user-private content is not unnecessarily exposed to admin
-   locale switching works
-   mobile layouts work
-   refresh/persistence works
-   failure states do not corrupt data

------------------------------------------------------------------------

## 32. Documentation Maintenance

Maintain concise documentation when present:

-   `docs/ARCHITECTURE.md`
-   `docs/PRODUCT_REQUIREMENTS.md`
-   `docs/RICH_HABITS_REFERENCE.md`

Update documentation when significant architecture or domain decisions
change.

Do not let documentation become knowingly inconsistent with
implementation.

------------------------------------------------------------------------

## 33. Standing Instruction

The Product Owner should not repeatedly need to say:

-   make this scalable
-   secure this
-   preserve history
-   don't hard-code this
-   add translations
-   make this mobile responsive
-   optimize the database
-   handle errors
-   add appropriate analytics
-   reuse existing components
-   test it
-   fix the architecture

Those are normal responsibilities of the technical owner.

For each product requirement:

**Understand → Inspect → Design → Implement → Test → Verify → Document**

Use professional judgment and proactively surface important risks or
architectural consequences.

**Build the product, not merely the requested screen.**
