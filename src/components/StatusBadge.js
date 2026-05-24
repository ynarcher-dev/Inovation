import { getStatusLabel, getStatusTone } from "../status.js";

export function StatusBadge(status) {
  return `<span class="badge badge-${getStatusTone(status)}">${getStatusLabel(status)}</span>`;
}

