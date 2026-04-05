# Example: Architecture Debate

Use ClashCode to evaluate architectural decisions.

## Setup

```sh
export XAI_API_KEY="your-key"
clashcode
```

## Run the debate

```
> /consensus Should we use a microservices architecture or a modular monolith for a team of 5 engineers building a B2B SaaS product?
```

This triggers a 4-round debate between pragmatist, security-maximalist,
performance-extremist, and future-architect. Each persona analyzes the
question from their perspective, challenges others' assumptions, evaluates
evidence, and converges on a synthesis.

Expected output: a coherence-scored report with specific, actionable
recommendations grounded in the team's constraints.
