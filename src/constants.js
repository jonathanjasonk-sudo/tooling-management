// Status tooling (per baris stok)
const STATUSES = [
  { key: 'TERSEDIA', label: 'Tersedia', color: '#16a34a' },
  { key: 'DIPAKAI', label: 'Sedang Dipakai', color: '#2563eb' },
  { key: 'MAINTENANCE', label: 'Maintenance', color: '#d97706' },
  { key: 'INCOMPLETE', label: 'Kurang Komponen', color: '#ea580c' },
  { key: 'RUSAK', label: 'Rusak', color: '#dc2626' },
];
// Status request tooling
const REQUEST_STATUSES = [
  { key: 'DIAJUKAN', label: 'Diajukan' },
  { key: 'DIPROSES', label: 'Dalam Pembuatan' },
  { key: 'SIAP', label: 'Siap Diambil' },
  { key: 'DITERIMA', label: 'Diterima (masuk stok)' },
  { key: 'DIBATALKAN', label: 'Dibatalkan' },
];
const DEFAULT_TYPES = ['Cutting Dies', 'Cutting Dies Sewing', 'Pallet', 'Mould Assembly'];
const DEFAULT_LOCATIONS = ['Gedung D', 'Gedung E', 'Gedung F', 'Gedung H', 'Gedung I'];
module.exports = { STATUSES, REQUEST_STATUSES, DEFAULT_TYPES, DEFAULT_LOCATIONS };
