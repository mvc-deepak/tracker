# An ASP.NET Core request pipeline

Middleware processes an HTTP request in order and can short-circuit or pass control onward.

## Key ideas

- Identify the responsibility of each component.
- Keep interfaces and ownership boundaries explicit.
- Consider failure handling, security, and operational trade-offs.

![Incoming request to Middleware pipeline to Endpoint response](images/concept.svg)

Use this overview as a starting point for revision. Follow the links and examples in your own project documentation when applying the concept.
