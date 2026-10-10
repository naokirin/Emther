import { Link } from "@/router";
import { useWorldModel } from "../../lib/queries";

export function WorldModelRefs({ ids }: { ids: string[] }) {
  const { elements } = useWorldModel();
  const byId = new Map(elements.map((e) => [e.id, e]));
  return (
    <div style={{ marginBottom: 14 }}>
      <strong style={{ fontSize: "0.85rem" }}>🗺 参照した組織モデル</strong>
      <ul style={{ margin: "6px 0 0 18px", fontSize: "0.875rem", lineHeight: 1.55 }}>
        {ids.map((id) => (
          <li key={id}>
            <Link to="/world-model">{byId.get(id)?.title ?? "（組織モデルの要素）"}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
