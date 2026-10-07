---
name: write-adr
description: Writes one Architecture Decision Record for this repository. Use when a service, orchestration, or storage choice is being made.
---

# Write an ADR

Create `docs/explanation/architecture-decision-records/NNNN-short-title.md`. Use the next free number. One decision only.

```markdown
# NNNN. Title

## Status

Proposed

## Context

What forced the choice.

## Decision

The choice, in one paragraph.

## Alternatives

- Option considered, and why it lost.

## Trade-off

What this makes worse or leaves until later.

## Cost

The pricing unit. What stays off to avoid a standing charge.

## Failure

What the caller sees when this part fails, and where that is recorded.
```

Do not invent numbers, prices, or regional availability. Check with the AWS docs before naming a price or a region limit.
