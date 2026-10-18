# Records and type choices

C# records provide value-based equality and concise syntax for data-oriented models.

## Interview notes

- A `record class` is a reference type.
- A `record struct` is a value type.
- A `with` expression creates a copy with selected values changed.
- Records are not deeply immutable automatically.

```csharp
public record Point(int X, int Y);

var origin = new Point(0, 0);
var next = origin with { X = 1 };
```

Choose classes when identity and lifecycle are central; choose a value-like type when values are compared by their data.
