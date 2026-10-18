-- A WithApprove invite creates a pending join request rather than an active membership. The request
-- rides on the same SpaceMember row (one row per space+user, so a re-request after removal is an
-- idempotent transition) with status 'joining', which the participant subscription projects as
-- ParticipantStatus.Joining (0) for the members sheet's Request tab and SpaceRequestApprove /
-- SpaceRequestDecline resolve. ALTER TYPE ... ADD VALUE is transaction-safe on PG12+ because this
-- migration only adds the label and never uses it in the same transaction.
ALTER TYPE "SpaceMemberStatus" ADD VALUE 'joining';
