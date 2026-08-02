export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatPpm(value) {
  if (value === null || value === undefined) return '—';
  return `${Number(value).toFixed(2)} ppm`;
}

export function titleCaseSample(value) {
  if (!value) return '—';
  return value.charAt(0).toUpperCase() + value.slice(1);
}
