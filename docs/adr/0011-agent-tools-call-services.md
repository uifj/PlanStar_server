# 0011. Keep agent tools on services and scope chats to a space

Status: accepted
Date: 2026-10-13

## Context

src/modules/agent/tools.ts currently reaches into Prisma directly for van and booking reads, which breaks the repository rule and will not survive the object core. The Genkit setup itself is deliberate: beta instance, provider chosen by AGENT_MODEL, Prisma-backed session store, and offline tests driven by mockModel.

## Decision

Agent tools become thin wrappers over the same service functions the HTTP routes expose, so a tool and an endpoint cannot disagree. AgentChat gains spaceId, and the service asserts membership before each turn. Provider selection, the session store and the offline mock-model tests stay unchanged.

## Consequences

Tools inherit the service layer's validation and authorisation instead of duplicating them, and the offline tests keep running without an API key. The direct Prisma access in the current tools is fixed as part of this migration rather than left as a known wart.
