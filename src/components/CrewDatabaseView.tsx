import React, { useMemo, useState } from 'react';
import { Download, Plus, Search, Trash2, Edit3, X } from 'lucide-react';
import { downloadCSV } from '../utils/pdfGenerator';
import {
  BranchName,
  Employee,
  EmploymentStatus,
  UserRole,
} from '../types/hc';
import { formatDateID, formatWorkTenure } from '../utils/calculations';

interface CrewDatabaseViewProps {
  employees: Employee[];
  readOnly?: boolean;
  hideSalaryColumns?: boolean;
  onSaveEmployees: (next: Employee[]) => Promise<void>;
  onOpenEmployeeTraining?: (employeeId: string) => void;
  onOpenEmployeePayroll?: (employeeId: string) => void;
}

const BRANCHES: BranchName[] = [
  'Abdesir',
  'Agus Salim',
  'Djemma',
  'Holding',
  'Perintis',
  'Tamalate',
];

const STATUSES: EmploymentStatus[] = ['Aktif', 'Onboarding', 'Probation', 'Non-Aktif'];

const POSITION_OPTIONS = [
  'Barista Junior',
  'Barista Senior',
  'Staf Junior',
  'Staf Senior',
];

const EMPTY_FORM: Omit<Employee, 'id'> = {
  code: '',
  name: '',
  email: '',
  phone: '',
  branch: 'Abdesir',
  position: 'Barista Junior',
  role: 'Barista',
  status: 'Onboarding',
  startDate: new Date().toISOString().slice(0, 10),
  trainingCompletedDate: '',
  certifications: [],
  baseSalary: 1400000,
  dailyRate: 54000,
  trainingRatePerDay: 15000,
  payMode: 'bulanan',
  bankAccount: '',
  bankName: 'MANDIRI',
};

export const CrewDatabaseView: React.FC<CrewDatabaseViewProps> = ({
  employees,
  readOnly = false,
  hideSalaryColumns = false,
  onSaveEmployees,
  onOpenEmployeeTraining,
  onOpenEmployeePayroll,
}) => {
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Employee, 'id'>>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((emp) => {
      if (branchFilter !== 'ALL' && emp.branch !== branchFilter) return false;
      if (statusFilter !== 'ALL' && emp.status !== statusFilter) return false;
      if (!q) return true;
      return (
        emp.name.toLowerCase().includes(q) ||
        emp.code.toLowerCase().includes(q) ||
        emp.email.toLowerCase().includes(q) ||
        emp.phone.toLowerCase().includes(q) ||
        emp.position.toLowerCase().includes(q) ||
        emp.branch.toLowerCase().includes(q)
      );
    });
  }, [employees, search, branchFilter, statusFilter]);

  const branchCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of BRANCHES) map[b] = 0;
    for (const e of employees) {
      map[e.branch] = (map[e.branch] || 0) + 1;
    }
    return map;
  }, [employees]);

  const summary = useMemo(() => {
    const total = employees.length;
    const aktif = employees.filter((e) => e.status === 'Aktif').length;
    const onboarding = employees.filter((e) => e.status === 'Onboarding').length;
    const probation = employees.filter((e) => e.status === 'Probation').length;
    return { total, aktif, onboarding, probation };
  }, [employees]);

  const openCreate = () => {
    const nextNo = employees.length + 1;
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      code: `TKT-${String(nextNo).padStart(3, '0')}`,
    });
    setModalOpen(true);
  };

  const openEdit = (emp: Employee) => {
    setEditingId(emp.id);
    const { id: _id, ...rest } = emp;
    setForm(rest);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    setSaving(true);
    try {
      const payload: Employee = {
        id: editingId || `emp-${Date.now()}`,
        ...form,
      };

      const nextList = editingId
        ? employees.map((item) => (item.id === editingId ? payload : item))
        : [...employees, payload];

      await onSaveEmployees(nextList);
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (emp: Employee) => {
    if (readOnly) return;
    const nextList = employees.filter((item) => item.id !== emp.id);
    await onSaveEmployees(nextList);
  };

  const handleExportExcel = () => {
    const headers = [
      'No',
      'Kode',
      'Nama',
      'Email',
      'Cabang',
      'Jabatan',
      'Role',
      'Status',
      'Tanggal Masuk',
      'Masa Kerja',
      'Nomor Telepon',
      ...(hideSalaryColumns ? [] : ['Rekening', 'Bank']),
    ];
    const rows = filtered.map((e, i) => [
      i + 1,
      e.code,
      e.name,
      e.email,
      e.branch,
      e.position,
      e.role,
      e.status,
      e.startDate,
      formatWorkTenure(e.startDate),
      e.phone,
      ...(hideSalaryColumns ? [] : [e.bankAccount, e.bankName]),
    ]);
    downloadCSV('Database_Kru_Staf_Kopi_Tuju.csv', headers, rows);
  };

  return (
    <div className="space-y-6">
      {readOnly && (
        <div className="px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs text-slate-700">
          <span className="font-semibold text-slate-900">Mode Hanya Lihat:</span> Anda dapat melihat
          direktori kru dan mengekspor CSV, namun penambahan, perubahan, atau penghapusan data hanya
          dapat dilakukan oleh Admin / Manager HC.
        </div>
      )}
      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Total Kru &amp; Staf</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {summary.total}
          </p>
          <p className="mt-1 text-xs text-slate-500">Seluruh 6 cabang &amp; holding</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Status Aktif</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-700">
            {summary.aktif}
          </p>
          <p className="mt-1 text-xs text-slate-500">Operasional reguler outlet</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Dalam Onboarding</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-amber-700">
            {summary.onboarding}
          </p>
          <p className="mt-1 text-xs text-slate-500">Training 14 hari berjalan</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Masa Probation</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-800">
            {summary.probation}
          </p>
          <p className="mt-1 text-xs text-slate-500">Evaluasi lanjutan cabang</p>
        </div>
      </div>

      {/* Branch Distribution Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setBranchFilter('ALL')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                branchFilter === 'ALL'
                  ? 'bg-[#0F172A] text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Semua Cabang ({employees.length})
            </button>
            {BRANCHES.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBranchFilter(b)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                  branchFilter === b
                    ? 'bg-[#0B4EA2] text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {b} · <span className="font-mono tabular-nums">{branchCounts[b] || 0}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportExcel}
              className="h-9 px-3.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV (Excel)</span>
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={openCreate}
                className="h-9 px-3.5 text-xs font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah Kru / Staf</span>
              </button>
            )}
          </div>
        </div>

        {/* Search & Status Filter */}
        <div className="mt-4 pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama, kode, email, jabatan, atau cabang..."
              className="w-full h-9 pl-9 pr-3 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-[#0B4EA2]"
            />
          </div>

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
            {(['ALL', ...STATUSES] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  statusFilter === st
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st === 'ALL' ? 'Semua Status' : st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Directory Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-3 whitespace-nowrap">Kode</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Nama &amp; Email</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Cabang</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Jabatan</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Status</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Masa Kerja</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Nomor Telepon</th>
                {!hideSalaryColumns && (
                  <th className="py-2.5 px-3 whitespace-nowrap">Rekening Bank</th>
                )}
                {!readOnly && <th className="py-2.5 px-3 text-right whitespace-nowrap">Aksi</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={7 + (hideSalaryColumns ? 0 : 1) + (readOnly ? 0 : 1)}
                    className="py-10 text-center text-slate-500"
                  >
                    Tidak ada data kru atau staf yang sesuai filter pencarian.
                  </td>
                </tr>
              ) : (
                filtered.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 px-3 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {emp.code}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-900">{emp.name}</div>
                      <div className="text-[11px] text-slate-500">{emp.email}</div>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="font-medium text-slate-900">{emp.branch}</div>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="font-medium text-slate-900">{emp.position}</div>
                      <div className="text-[11px] text-slate-500">{emp.role}</div>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span
                        className={`font-semibold ${
                          emp.status === 'Aktif'
                            ? 'text-emerald-700'
                            : emp.status === 'Onboarding'
                            ? 'text-amber-700'
                            : emp.status === 'Probation'
                            ? 'text-slate-700'
                            : 'text-red-700'
                        }`}
                      >
                        {emp.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="font-medium text-slate-900">
                        {formatWorkTenure(emp.startDate)}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                        Sejak {formatDateID(emp.startDate)}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {emp.phone || '—'}
                    </td>
                    {!hideSalaryColumns && (
                      <td className="py-2.5 px-3 whitespace-nowrap text-[11px] text-slate-600">
                        <span className="font-semibold text-slate-800">{emp.bankName}</span> ·{' '}
                        <span className="font-mono tabular-nums">{emp.bankAccount || '—'}</span>
                      </td>
                    )}
                    {!readOnly && (
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {onOpenEmployeeTraining && (
                            <button
                              type="button"
                              onClick={() => onOpenEmployeeTraining(emp.id)}
                              className="px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded"
                            >
                              Training
                            </button>
                          )}
                          {onOpenEmployeePayroll && (
                            <button
                              type="button"
                              onClick={() => onOpenEmployeePayroll(emp.id)}
                              className="px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded"
                            >
                              Slip
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openEdit(emp)}
                            title="Ubah data"
                            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(emp)}
                            title="Hapus"
                            className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <h3 className="text-lg font-bold text-slate-900">
                {editingId ? 'Perbarui Data Kru / Staf' : 'Tambah Kru / Staf Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-5 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kode Karyawan</label>
                  <input
                    type="text"
                    required
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    className="w-full h-9 px-3 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">Nama Lengkap</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full h-9 px-3 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Email Terdaftar (Untuk Slip Gaji &amp; Login)
                  </label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full h-9 px-3 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">No. HP / WhatsApp</label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full h-9 px-3 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Cabang</label>
                  <select
                    value={form.branch}
                    onChange={(e) => setForm({ ...form, branch: e.target.value as BranchName })}
                    className="w-full h-9 px-2.5 border border-slate-300 rounded-lg bg-white"
                  >
                    {BRANCHES.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Jabatan</label>
                  <select
                    required
                    value={form.position}
                    onChange={(e) => setForm({ ...form, position: e.target.value })}
                    className="w-full h-9 px-2.5 border border-slate-300 rounded-lg bg-white"
                  >
                    {!POSITION_OPTIONS.includes(form.position) && form.position && (
                      <option value={form.position}>{form.position}</option>
                    )}
                    {POSITION_OPTIONS.map((pos) => (
                      <option key={pos} value={pos}>
                        {pos}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Peran Portal</label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
                    className="w-full h-9 px-2.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Barista">Barista</option>
                    <option value="Supervisor">Supervisor</option>
                    <option value="Staf HC">Staf HC</option>
                    <option value="Staf Admin Operasional">Staf Admin Operasional</option>
                    <option value="Staf Marketing">Staf Marketing</option>
                    <option value="Staf Akunting">Staf Akunting</option>
                    <option value="Staf General Affair">Staf General Affair</option>
                    <option value="Staf Bisnis Development">Staf Bisnis Development</option>
                    <option value="Staf Gudang">Staf Gudang</option>
                    <option value="Manager Operasional">Manager Operasional</option>
                    <option value="Manager Marketing">Manager Marketing</option>
                    <option value="Manager Akunting & Finance">
                      Manager Akunting &amp; Finance
                    </option>
                    <option value="Manager SCM">Manager SCM</option>
                    <option value="HR Manager">Manager HC (Owner)</option>
                    <option value="Admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm({ ...form, status: e.target.value as EmploymentStatus })
                    }
                    className="w-full h-9 px-2.5 border border-slate-300 rounded-lg bg-white"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tanggal Masuk</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    className="w-full h-9 px-3 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Bank</label>
                  <input
                    type="text"
                    value={form.bankName}
                    onChange={(e) => setForm({ ...form, bankName: e.target.value.toUpperCase() })}
                    className="w-full h-9 px-3 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Nomor Rekening</label>
                  <input
                    type="text"
                    value={form.bankAccount}
                    onChange={(e) => setForm({ ...form, bankAccount: e.target.value })}
                    className="w-full h-9 px-3 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="h-9 px-4 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="h-9 px-5 text-xs font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] rounded-lg disabled:opacity-60"
                >
                  {saving ? 'Menyimpan...' : 'Simpan Data'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
