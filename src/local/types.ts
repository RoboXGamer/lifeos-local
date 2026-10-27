export type Id<T extends string> = string & { readonly __table?: T };

export type ItemType = "Task" | "Note" | "Event" | "Expense" | "Income";
export type ItemStatus = "Todo" | "In Progress" | "Done";
export type FinancialState = "Planned" | "Spent" | "Expected" | "Received";

export interface ProfileDoc {
  _id: Id<"profiles">;
  _creationTime: number;
  authUserId: string;
  username?: string;
  normalizedUsername?: string;
  email?: string;
  isAnonymous: boolean;
  role: "user" | "admin";
  suspended: boolean;
  activeWorkspaceId?: Id<"workspaces">;
  usernameChangedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceDoc {
  _id: Id<"workspaces">;
  _creationTime: number;
  ownerId?: Id<"profiles">;
  name: string;
  archived?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AreaDoc {
  _id: Id<"areas">;
  _creationTime: number;
  workspaceId: Id<"workspaces">;
  name: string;
  icon: string;
  color: string;
  description?: string;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ItemDoc {
  _id: Id<"items">;
  _creationTime: number;
  workspaceId: Id<"workspaces">;
  title: string;
  areaId: Id<"areas"> | null;
  type?: ItemType;
  status?: ItemStatus;
  priority?: 1 | 2 | 3;
  dueDate?: string;
  amount?: number;
  financialState?: FinancialState;
  description?: string;
  parentId: Id<"items"> | null;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ItemView extends ItemDoc {
  tags: string[];
}

export interface TagDoc {
  _id: Id<"tags">;
  _creationTime: number;
  workspaceId: Id<"workspaces">;
  name: string;
  normalizedName: string;
  createdAt: number;
}

export interface ItemTagDoc {
  _id: Id<"itemTags">;
  _creationTime: number;
  workspaceId: Id<"workspaces">;
  itemId: Id<"items">;
  tagId: Id<"tags">;
  createdAt: number;
}

export interface DataModel {
  profiles: ProfileDoc;
  workspaces: WorkspaceDoc;
  areas: AreaDoc;
  items: ItemDoc;
  tags: TagDoc;
  itemTags: ItemTagDoc;
}

export type Doc<T extends keyof DataModel> = DataModel[T];

export interface ProfileSummary {
  id: Id<"profiles">;
  username: string | null;
  email: string | null;
  isAnonymous: boolean;
  role: "user" | "admin";
  activeWorkspaceId: Id<"workspaces"> | null;
  usernameChangedAt: number | null;
}

export interface WorkspaceSummary {
  id: Id<"workspaces">;
  name: string;
  createdAt: number;
  updatedAt: number;
}
