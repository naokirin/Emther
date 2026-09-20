import { Navigate, useParams } from "react-router";

// web/src/app/issues/[id]/page.tsx からの移植（フェーズ3.5 tier1）。
export function IssueDetailRedirect() {
  const { id } = useParams();
  return <Navigate to={`/suggestions/${id}`} replace />;
}
