import { IdLinkedText } from "../IdLinkedText";
import type { RethinkItem } from "@emther/core/types";

export function RethinkItemsList({ items }: { items: RethinkItem[] }) {
  return (
    <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}>
      {items.map((item, i) => (
        <li
          key={i}
          style={{
            marginBottom: 8,
            padding: "8px 10px",
            backgroundColor: "var(--surface)",
            borderRadius: 6,
            border: "1px solid var(--border)",
          }}
        >
          {item.category ? (
            <div
              style={{
                display: "inline-block",
                fontSize: "0.6875rem",
                fontWeight: 600,
                color: "var(--accent, #2563eb)",
                background: "color-mix(in srgb, var(--accent, #2563eb) 12%, transparent)",
                padding: "2px 8px",
                borderRadius: 4,
                marginBottom: 4,
              }}
            >
              {item.category}
            </div>
          ) : null}
          <p style={{ fontSize: "0.875rem", lineHeight: 1.55, margin: item.category ? "4px 0 0" : 0 }}>
            <IdLinkedText text={item.text} />
          </p>
        </li>
      ))}
    </ul>
  );
}
