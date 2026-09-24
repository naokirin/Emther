import { Navigate, useParams } from "@/router";

export function IssueDetailRedirect() {
  const { id } = useParams();
  return <Navigate to={`/suggestions/${id}`} replace />;
}
