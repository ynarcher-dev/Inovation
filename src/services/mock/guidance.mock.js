// Mock 안내자료(guidance) CRUD.
import { STORAGE_KEYS, load, save, uuid } from "./storage.mock.js";

// ----------------------------------------------------
// Mock Guidance / Instruction Functions
// ----------------------------------------------------
export function mockGetGuidanceItems(programId) {
  const items = load(STORAGE_KEYS.GUIDANCE, []);
  if (programId) return items.filter((i) => i.support_program_id === programId && i.active !== false);
  return items.filter((i) => !i.support_program_id && i.active !== false);
}

export function mockCreateGuidanceItem(input, adminUserId) {
  const items = load(STORAGE_KEYS.GUIDANCE, []);
  const newItem = {
    id: uuid(),
    title: input.title,
    content: input.content || null,
    link_url: input.link_url || null,
    sort_order: Number(input.sort_order || 0),
    active: true,
    support_program_id: input.support_program_id || null,
    created_by: adminUserId,
    created_at: new Date().toISOString(),
  };
  items.push(newItem);
  save(STORAGE_KEYS.GUIDANCE, items);
  return newItem;
}

export function mockUpdateGuidanceItem(id, input) {
  const items = load(STORAGE_KEYS.GUIDANCE, []);
  const idx = items.findIndex((i) => i.id === id);
  if (idx !== -1) {
    items[idx] = { ...items[idx], ...input };
    save(STORAGE_KEYS.GUIDANCE, items);
    return items[idx];
  }
  throw new Error("안내 항목을 찾을 수 없습니다.");
}

export function mockDeleteGuidanceItem(id) {
  let items = load(STORAGE_KEYS.GUIDANCE, []);
  items = items.filter((i) => i.id !== id);
  save(STORAGE_KEYS.GUIDANCE, items);
  return { ok: true };
}
