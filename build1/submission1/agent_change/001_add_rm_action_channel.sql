-- Migration 001 — add outreach channel + follow-up tracking to app.rm_actions
--
-- Authored by an AI coding agent (Claude Code / ucode) working on the Lakebase
-- `development` branch (off `production`), validated there, then promoted to
-- `production`. This is the Build-1 agentic-development step: the agent evolves
-- the operational schema on an isolated branch so production is never at risk
-- until the change is verified.
--
-- Author: Claude Code (AI coding agent), on behalf of kanishk.jadhav@databricks.com
-- Co-authored-by: Isaac <no-reply@databricks.com>
--
-- Change: relationship managers need to record HOW an approved action was
-- delivered (call/email/branch/mobile) and whether a follow-up is due, so the
-- RM desk can drive a contact cadence. Additive-only (safe, backward compatible).

ALTER TABLE app.rm_actions
    ADD COLUMN IF NOT EXISTS outreach_channel TEXT
        CHECK (outreach_channel IN ('call','email','branch','mobile')),
    ADD COLUMN IF NOT EXISTS followup_due_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS rm_actions_followup_idx
    ON app.rm_actions (followup_due_at)
    WHERE followup_due_at IS NOT NULL;

-- Backfill: default an outreach channel for already-approved retention offers
-- (a phone call is the default play for a maturing-CD save) and set a 3-day
-- follow-up on approved actions.
UPDATE app.rm_actions
   SET outreach_channel = COALESCE(outreach_channel, 'call'),
       followup_due_at  = COALESCE(followup_due_at, decided_at + INTERVAL '3 days')
 WHERE status = 'approved';
