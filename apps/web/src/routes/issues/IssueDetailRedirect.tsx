import { Navigate, useParams } from "react-router";

export function IssueDetailRedirect() {
  const { id } = useParams();
  return <Navigate to={`/suggestions/${id}`} replace />;
}
