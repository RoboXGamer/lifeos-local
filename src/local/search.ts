type SearchArea = { _id: string; workspaceId: string; name: string; archived: boolean };
type SearchItem = {
  workspaceId: string;
  title: string;
  description?: string;
  type?: string;
  tags: string[];
  areaId: string | null;
  archived: boolean;
};

export function searchItems<T extends SearchItem>(items: T[], areas: SearchArea[], workspaceId: string, input: string, limit: number, type?: string): T[] {
  const term = input.trim().toLowerCase();
  if (!term) return [];
  const visibleAreas = new Map(areas.filter(area => area.workspaceId === workspaceId && !area.archived).map(area => [area._id, area.name]));
  return items.filter(item => {
    if (item.workspaceId !== workspaceId || item.archived || (type && item.type !== type)) return false;
    if (item.areaId !== null && !visibleAreas.has(item.areaId)) return false;
    const area = item.areaId === null ? 'Inbox' : visibleAreas.get(item.areaId) ?? '';
    return [item.title, item.description ?? '', item.type ?? '', ...item.tags, area].some(value => value.toLowerCase().includes(term));
  }).slice(0, limit);
}
