# Example: Code Review Clash

Use the team to write and review code, then debate the approach.

## Workflow

```
> Implement a rate limiter using the token bucket algorithm in TypeScript
```

The coder writes the implementation, the reviewer checks it.
Then use the clash engine:

```
> /consensus 5 Is this rate limiter implementation production-ready? Consider thread safety, memory leaks, and edge cases.
```

The 5-round deep dive will surface issues the initial review missed.
