// Standing Background: 組織の長期背景事実＋いまの判断への含意。

export type OrgBackgroundScope = "always" | "tagged";
export type OrgBackgroundStatus = "active" | "archived";

export type OrgBackgroundEntry = {
  id: string;
  title: string;
  fact: string;
  implication: string;
  occurredOn?: string;
  tags: string[];
  scope: OrgBackgroundScope;
  status: OrgBackgroundStatus;
  createdAt: number;
  updatedAt: number;
};

export type NewOrgBackgroundInput = {
  title: string;
  fact: string;
  implication?: string;
  occurredOn?: string;
  tags?: string[];
  scope?: OrgBackgroundScope;
  status?: OrgBackgroundStatus;
};
