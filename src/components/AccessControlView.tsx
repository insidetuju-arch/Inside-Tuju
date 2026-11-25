import React, { useMemo, useState } from 'react';
import {
  Briefcase,
  CheckCircle2,
  Coffee,
  KeyRound,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type {
  ConfigurableRole,
  Employee,
  FeaturePermissions,
  RoleFeatureAccess,
  UserAccount,
  UserRole,
} from '../types/hc';

interface AccessControlViewProps {
  currentUser: UserAccount;
  users: UserAccount[];
  employees: Employee[];
  permissions: FeaturePermissions;
  authToken: string;
  onUpdatePermissions: (next: FeaturePermissions) => Promise<void>;
  onRefreshState: () => Promise<void>;
}

const DEFAULT_ROLE_FEATURES: Record<ConfigurableRole, RoleFeatureAccess> = {
  'Manager Operasional': {
    canAccessCrew: true,
    canAccessOnboarding: true,
    canAccessPayroll: false,
    canAccessAttendance: true,
    canAccessLiveAttendance: true,
    canAccessKpi: true,
    canAccessAccessControl: false,
    canViewOwnPayslip: true,
    canDownloadOwnPayslip: true,
  },
  'Manager Marketing': {
    canAccessCrew: false,
    canAccessOnboarding: false,
    canAccessPayroll: false,
    canAccessAttendance: false,
    canAccessLiveAttendance: true,
    canAccessKpi: true,
    canAccessAccessControl: false,
    canViewOwnPayslip: true,
    canDownloadOwnPayslip: true,
  },
  'Manager Akunting & Finance': {
    canAccessCrew: true,
    canAccessOnboarding: false,
    canAccessPayroll: true,
    canAccessAttendance: true,
    canAccessLiveAttendance: true,
    canAccessKpi: true,
    canAccessAccessControl: false,
    canViewOwnPayslip: true,
    canDownloadOwnPayslip: true,
  },
  'Manager SCM': {
    canAccessCrew: false,
    canAccessOnboarding: false,
    canAccessPayroll: false,
    canAccessAttendance: false,
    canAccessLiveAttendance: true,
    canAccessKpi: true,
    canAccessAccessControl: false,
    canViewOwnPayslip: true,
    canDownloadOwnPayslip: true,
  },
  'Staf HC': {
    canAccessCrew: true,
    canAccessOnboarding: true,
    canAccessPayroll: false,
    canAccessAttendance: true,
    canAccessLiveAttendance: true,
    canAccessKpi: true,
    canAccessAccessControl: false,
    canViewOwnPayslip: true,
    canDownloadOwnPayslip: true,
  },
  'Staf Admin Operasional': {
    canAccessCrew: true,
    canAccessOnboarding: false,
    canAccessPayroll: false,
    canAccessAttendance: true,
    canAccessLiveAttendance: true,
    canAccessKpi: true,
    canAccessAccessControl: false,
    canViewOwnPayslip: true,
    canDownloadOwnPayslip: true,
  },
  'Staf Marketing': {
    canAccessCrew: false,
    canAccessOnboarding: false,
    canAccessPayroll: false,
    canAccessAttendance: false,
    canAccessLiveAttendance: true,
    canAccessKpi: true,
    canAccessAccessControl: false,
    canViewOwnPayslip: true,
    canDownloadOwnPayslip: true,
  },
  'Staf Akunting': {
    canAccessCrew: false,
    canAccessOnboarding: false,
    canAccessPayroll: true,
    canAccessAttendance: true,
    canAccessLiveAttendance: true,
    canAccessKpi: true,
    canAccessAccessControl: false,
    canViewOwnPayslip: true,
    canDownloadOwnPayslip: true,
  },
  'Staf General Affair': {
    canAccessCrew: true,
    canAccessOnboarding: false,
    canAccessPayroll: false,
    canAccessAttendance: false,
    canAccessLiveAttendance: true,
    canAccessKpi: false,
    canAccessAccessControl: false,
    canViewOwnPayslip: true,
    canDownloadOwnPayslip: true,
  },
  'Staf Bisnis Development': {
    canAccessCrew: false,
    canAccessOnboarding: false,
    canAccessPayroll: false,
    canAccessAttendance: false,
    canAccessLiveAttendance: true,
    canAccessKpi: true,
    canAccessAccessControl: false,
    canViewOwnPayslip: true,
    canDownloadOwnPayslip: true,
  },
  'Staf Gudang': {
    canAccessCrew: false,
    canAccessOnboarding: false,
    canAccessPayroll: false,
    canAccessAttendance: false,
    canAccessLiveAttendance: true,
    canAccessKpi: false,
    canAccessAccessControl: false,
    canViewOwnPayslip: true,
    canDownloadOwnPayslip: true,
  },
  Supervisor: {
    canAccessCrew: true,
    canAccessOnboarding: true,
    canAccessPayroll: false,
    canAccessAttendance: true,
    canAccessLiveAttendance: true,
    canAccessKpi: true,
    canAccessAccessControl: false,
    canViewOwnPayslip: true,
    canDownloadOwnPayslip: true,
  },
};

const MANAGER_LEVEL_COLUMNS: Array<{
  role: ConfigurableRole;
  line1: string;
  line2: string;
}> = [
  { role: 'Manager Operasional', line1: 'Manager', line2: 'Operasional' },
  { role: 'Manager Marketing', line1: 'Manager', line2: 'Marketing' },
  { role: 'Manager Akunting & Finance', line1: 'Manager', line2: 'Akunting & Finance' },
  { role: 'Manager SCM', line1: 'Manager', line2: 'SCM' },
];

const STAFF_LEVEL_COLUMNS: Array<{
  role: ConfigurableRole;
  line1: string;
  line2: string;
}> = [
  { role: 'Staf HC', line1: 'Staf', line2: 'HC' },
  { role: 'Staf Admin Operasional', line1: 'Staf Admin', line2: 'Operasional' },
  { role: 'Staf Marketing', line1: 'Staf', line2: 'Marketing' },
  { role: 'Staf Akunting', line1: 'Staf', line2: 'Akunting' },
  { role: 'Staf General Affair', line1: 'Staf', line2: 'General Affair' },
  { role: 'Staf Bisnis Development', line1: 'Staf Bisnis', line2: 'Development' },
  { role: 'Staf Gudang', line1: 'Staf', line2: 'Gudang' },
  { role: 'Supervisor', line1: 'Supervisor', line2: 'Cabang / Holding' },
];

const MANAGEMENT_FEATURE_ITEMS: Array<{
  key: keyof RoleFeatureAccess;
  title: string;
  desc: string;
}> = [
  {
    key: 'canAccessCrew',
    title: 'Database Kru & Staf (Hanya Lihat)',
    desc: 'Hanya melihat direktori kru, jabatan, cabang, masa kerja & ekspor CSV (tidak dapat tambah, edit, atau hapus).',
  },
  {
    key: 'canAccessOnboarding',
    title: 'Onboarding & Training 14 Hari',
    desc: 'Kelola batch training, jadwal 14 hari, absensi H/I/S/A, skor 28 indikator & rapor PDF.',
  },
  {
    key: 'canAccessPayroll',
    title: 'Payroll & Slip Gaji (Hanya Lihat)',
    desc: 'Hanya melihat rekap payroll, insentif holding, pratinjau/unduh PDF & ekspor CSV (tidak dapat edit, buat periode, finalisasi, atau kirim email).',
  },
  {
    key: 'canViewOwnPayslip',
    title: 'Lihat Slip Gaji Pribadi',
    desc: 'Izinkan posisi terkait melihat rincian slip gaji & insentif miliknya sendiri.',
  },
  {
    key: 'canDownloadOwnPayslip',
    title: 'Download PDF Slip Gaji Pribadi',
    desc: 'Izinkan posisi terkait mengunduh berkas PDF Slip Gaji pribadinya langsung dari portal.',
  },
  {
    key: 'canAccessLiveAttendance',
    title: 'Absensi Kehadiran (Validasi Maps)',
    desc: 'Akses fitur Absen Datang & Pulang wajib lokasi GPS (tanpa akses melihat riwayat absensi).',
  },
  {
    key: 'canAccessAttendance',
    title: 'Denda Kehadiran & Rekap Absensi',
    desc: 'Unggah file absensi (.xlsx / .csv), kelola aturan shift & keterlambatan, dan sinkron payroll.',
  },
  {
    key: 'canAccessKpi',
    title: 'Evaluasi KPI (5 Divisi)',
    desc: 'Kelola Job Description dan penilaian KPI Staf Admin Ops, Marketing, Supervisor, Akunting & Kepala Outlet.',
  },
  {
    key: 'canAccessAccessControl',
    title: 'Akun & Hak Akses Portal',
    desc: 'Buat akun kru & atur visibilitas fitur Barista pada portal.',
  },
];

type BaristaPermissionKey = Exclude<
  keyof FeaturePermissions,
  'managerFeatures' | 'supervisorFeatures' | 'roleFeatures'
>;

const BARISTA_PERMISSION_ITEMS: Array<{
  key: BaristaPermissionKey;
  title: string;
  desc: string;
}> = [
  {
    key: 'baristaCanUseLiveAttendance',
    title: 'Absensi Kehadiran (Validasi Maps Outlet)',
    desc: 'Kru/barista dapat melakukan Absen Datang & Pulang dengan verifikasi lokasi GPS di outlet (tidak dapat melihat riwayat absensi).',
  },
  {
    key: 'baristaCanViewOwnPayslip',
    title: 'Lihat Slip Gaji Pribadi',
    desc: 'Kru/barista dapat melihat rincian gaji pokok, lembur, training, dan potongan miliknya sendiri.',
  },
  {
    key: 'baristaCanDownloadPayslip',
    title: 'Download PDF Slip Gaji',
    desc: 'Kru/barista dapat mengunduh berkas PDF Slip Gaji resmi langsung dari portalnya.',
  },
  {
    key: 'baristaCanViewOwnTraining',
    title: 'Lihat Progres & Nilai Onboarding Pribadi',
    desc: 'Kru/barista dapat melihat kehadiran, nilai per aspek, sertifikasi, dan catatan trainer miliknya.',
  },
  {
    key: 'baristaCanViewTrainingSchedule',
    title: 'Lihat Jadwal Training 14 Hari',
    desc: 'Kru/barista dapat mengakses daftar materi dan tanggal jadwal training batch yang diikutinya.',
  },
  {
    key: 'baristaCanViewCrewDirectory',
    title: 'Lihat Direktori Kontak Kru & Cabang',
    desc: 'Kru/barista dapat melihat nama dan cabang rekan kerja (tanpa akses ke data gaji & rekening rekan).',
  },
  {
    key: 'baristaCanViewIncentiveSummary',
    title: 'Lihat Rincian Insentif Holding/Staf Pribadi',
    desc: 'Staf holding dapat melihat rincian KPI, transport, dan bonus miliknya sendiri.',
  },
  {
    key: 'baristaCanEditOwnContact',
    title: 'Ubah Kontak Pribadi (Email & No. HP)',
    desc: 'Kru/barista dapat memperbarui email penerima slip gaji dan nomor WhatsApp miliknya sendiri.',
  },
];

export const AccessControlView: React.FC<AccessControlViewProps> = ({
  currentUser,
  users,
  employees,
  permissions,
  authToken,
  onUpdatePermissions,
  onRefreshState,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('Barista');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Reset password modal
  const [resetTarget, setResetTarget] = useState<UserAccount | null>(null);
  const [resetPass, setResetPass] = useState('');

  // Bulk provision modal
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkDefaultPassword, setBulkDefaultPassword] = useState('Keluargatuju');
  const [bulkRunning, setBulkRunning] = useState(false);

  // Account filters
  const [userSearch, setUserSearch] = useState('');
  const [userLevelFilter, setUserLevelFilter] = useState<'ALL' | 'MANAGER' | 'STAFF' | 'BARISTA'>('ALL');

  const isAdmin = currentUser.role === 'Admin';
  const isOwner = isAdmin || currentUser.role === 'HR Manager';

  const roleFeaturesMap: Record<ConfigurableRole, RoleFeatureAccess> = {
    'Manager Operasional': {
      ...DEFAULT_ROLE_FEATURES['Manager Operasional'],
      ...(permissions.roleFeatures?.['Manager Operasional'] || {}),
    },
    'Manager Marketing': {
      ...DEFAULT_ROLE_FEATURES['Manager Marketing'],
      ...(permissions.roleFeatures?.['Manager Marketing'] || {}),
    },
    'Manager Akunting & Finance': {
      ...DEFAULT_ROLE_FEATURES['Manager Akunting & Finance'],
      ...(permissions.roleFeatures?.['Manager Akunting & Finance'] || {}),
    },
    'Manager SCM': {
      ...DEFAULT_ROLE_FEATURES['Manager SCM'],
      ...(permissions.roleFeatures?.['Manager SCM'] || {}),
    },
    'Staf HC': {
      ...DEFAULT_ROLE_FEATURES['Staf HC'],
      ...(permissions.roleFeatures?.['Staf HC'] || {}),
    },
    'Staf Admin Operasional': {
      ...DEFAULT_ROLE_FEATURES['Staf Admin Operasional'],
      ...(permissions.roleFeatures?.['Staf Admin Operasional'] || {}),
    },
    'Staf Marketing': {
      ...DEFAULT_ROLE_FEATURES['Staf Marketing'],
      ...(permissions.roleFeatures?.['Staf Marketing'] || {}),
    },
    'Staf Akunting': {
      ...DEFAULT_ROLE_FEATURES['Staf Akunting'],
      ...(permissions.roleFeatures?.['Staf Akunting'] || {}),
    },
    'Staf General Affair': {
      ...DEFAULT_ROLE_FEATURES['Staf General Affair'],
      ...(permissions.roleFeatures?.['Staf General Affair'] || {}),
    },
    'Staf Bisnis Development': {
      ...DEFAULT_ROLE_FEATURES['Staf Bisnis Development'],
      ...(permissions.roleFeatures?.['Staf Bisnis Development'] || {}),
    },
    'Staf Gudang': {
      ...DEFAULT_ROLE_FEATURES['Staf Gudang'],
      ...(permissions.roleFeatures?.['Staf Gudang'] || {}),
    },
    Supervisor: {
      ...DEFAULT_ROLE_FEATURES.Supervisor,
      ...(permissions.roleFeatures?.Supervisor || permissions.supervisorFeatures || {}),
    },
  };

  const unprovisionedEmployees = useMemo(() => {
    const existingEmpIds = new Set(users.map((u) => u.employeeId).filter(Boolean));
    const existingEmails = new Set(users.map((u) => u.email.toLowerCase()));
    return employees.filter(
      (emp) =>
        emp.role !== 'Admin' &&
        emp.role !== 'HR Manager' &&
        !existingEmpIds.has(emp.id) &&
        !existingEmails.has(emp.email.toLowerCase())
    );
  }, [employees, users]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    const staffRoles: UserRole[] = [
      'Staf HC',
      'Staf Admin Operasional',
      'Staf Marketing',
      'Staf Akunting',
      'Staf General Affair',
      'Staf Bisnis Development',
      'Staf Gudang',
      'Supervisor',
    ];
    return users.filter((u) => {
      if (userLevelFilter === 'MANAGER') {
        if (
          u.role !== 'Admin' &&
          u.role !== 'HR Manager' &&
          u.role !== 'Manager Operasional' &&
          u.role !== 'Manager Marketing' &&
          u.role !== 'Manager Akunting & Finance' &&
          u.role !== 'Manager SCM'
        ) {
          return false;
        }
      } else if (userLevelFilter === 'STAFF') {
        if (!staffRoles.includes(u.role)) return false;
      } else if (userLevelFilter === 'BARISTA') {
        if (u.role !== 'Barista') return false;
      }
      if (!q) return true;
      return (
        u.fullName.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
      );
    });
  }, [users, userLevelFilter, userSearch]);

  const handleToggleRoleFeature = async (
    targetRole: ConfigurableRole,
    key: keyof RoleFeatureAccess
  ) => {
    if (!isOwner) return;
    setSaving(true);
    setError(null);
    try {
      const nextRoleFeatures: Record<ConfigurableRole, RoleFeatureAccess> = {
        ...roleFeaturesMap,
        [targetRole]: {
          ...roleFeaturesMap[targetRole],
          [key]: !(roleFeaturesMap[targetRole][key] ?? true),
        },
      };
      await onUpdatePermissions({
        ...permissions,
        supervisorFeatures: nextRoleFeatures.Supervisor,
        roleFeatures: nextRoleFeatures,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResetLevelFeatures = async (rolesToReset: ConfigurableRole[]) => {
    if (!isOwner) return;
    setSaving(true);
    setError(null);
    try {
      const nextRoleFeatures: Record<ConfigurableRole, RoleFeatureAccess> = {
        ...roleFeaturesMap,
      };
      for (const r of rolesToReset) {
        nextRoleFeatures[r] = DEFAULT_ROLE_FEATURES[r];
      }
      await onUpdatePermissions({
        ...permissions,
        supervisorFeatures: nextRoleFeatures.Supervisor,
        roleFeatures: nextRoleFeatures,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleBaristaPermission = async (key: BaristaPermissionKey) => {
    setSaving(true);
    setError(null);
    try {
      const currentVal =
        key === 'baristaCanUseLiveAttendance'
          ? permissions.baristaCanUseLiveAttendance !== false
          : Boolean(permissions[key]);
      await onUpdatePermissions({
        ...permissions,
        [key]: !currentVal,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleBulkProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    setError(null);
    setNotice(null);
    setBulkRunning(true);
    try {
      const res = await fetch('/api/users/bulk-provision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ defaultPassword: bulkDefaultPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal membuat akun massal.');
      setBulkModalOpen(false);
      setNotice(
        data.createdCount > 0
          ? `${data.createdCount} akun Barista & Staf berhasil dibuat sekaligus.`
          : 'Seluruh Barista & Staf sudah memiliki akun login aktif.'
      );
      await onRefreshState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan.');
    } finally {
      setBulkRunning(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          username,
          email,
          fullName,
          role,
          password,
          employeeId: selectedEmpId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal membuat akun.');
      setModalOpen(false);
      setUsername('');
      setEmail('');
      setFullName('');
      setPassword('');
      setSelectedEmpId('');
      await onRefreshState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (u: UserAccount) => {
    setError(null);
    const res = await fetch(`/api/users/${u.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ active: !u.active }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Gagal mengubah status akun.');
      return;
    }
    await onRefreshState();
  };

  const handleDeleteUser = async (u: UserAccount) => {
    setError(null);
    const res = await fetch(`/api/users/${u.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Gagal menghapus akun.');
      return;
    }
    await onRefreshState();
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget || resetPass.length < 6) return;
    setError(null);
    const res = await fetch(`/api/users/${resetTarget.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ password: resetPass }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Gagal memperbarui password.');
      return;
    }
    setNotice(`Password untuk ${resetTarget.fullName} berhasil diperbarui.`);
    setResetTarget(null);
    setResetPass('');
  };

  const canManageUserTarget = (targetRole: UserRole): boolean => {
    if (isAdmin) return true;
    if (currentUser.role === 'HR Manager') {
      return targetRole !== 'Admin' && targetRole !== 'HR Manager';
    }
    return targetRole === 'Barista';
  };

  const renderMatrixTable = (
    columns: Array<{ role: ConfigurableRole; line1: string; line2: string }>,
    minWidthClass: string
  ) => (
    <div className="overflow-x-auto">
      <table className={`w-full text-left text-xs border-collapse ${minWidthClass}`}>
        <thead>
          <tr className="bg-[#1B365D] text-white text-[11px] font-semibold">
            <th className="py-3 px-4 min-w-[260px]">Modul / Fitur Portal</th>
            {columns.map((col) => (
              <th key={col.role} className="py-3 px-3 text-center w-36">
                <div className="leading-tight">{col.line1}</div>
                <div className="text-[10px] font-normal text-blue-100 leading-tight mt-0.5">
                  {col.line2}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {MANAGEMENT_FEATURE_ITEMS.map((item) => (
            <tr key={item.key} className="hover:bg-blue-50/40">
              <td className="py-3.5 px-4">
                <p className="text-xs font-semibold text-slate-900">{item.title}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{item.desc}</p>
              </td>
              {columns.map((col) => {
                const enabled =
                  item.key === 'canAccessLiveAttendance'
                    ? roleFeaturesMap[col.role][item.key] !== false
                    : Boolean(roleFeaturesMap[col.role][item.key]);
                return (
                  <td key={col.role} className="py-3.5 px-3 text-center">
                    <div className="inline-flex flex-col items-center gap-1">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        aria-label={`${item.title} untuk ${col.role}`}
                        disabled={!isOwner}
                        onClick={() => void handleToggleRoleFeature(col.role, item.key)}
                        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                          !isOwner ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                        } ${enabled ? 'bg-[#0B4EA2]' : 'bg-slate-300'}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            enabled ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                      <span
                        className={`text-[10px] font-semibold ${
                          enabled ? 'text-emerald-700' : 'text-slate-400'
                        }`}
                      >
                        {enabled ? 'Aktif' : 'Off'}
                      </span>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-medium text-red-800 flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {notice && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-medium text-emerald-800 flex items-center justify-between">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
            <span>{notice}</span>
          </span>
          <button type="button" onClick={() => setNotice(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 3-Level Role Architecture Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-[#0B4EA2]">
            <Briefcase className="w-4 h-4" />
            <span>1. Level Manager</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
            <strong>Manager HC</strong> bertindak sebagai Owner (akses penuh tanpa slip gaji pribadi).{' '}
            <strong>Manager Operasional, Marketing, Akunting &amp; Finance, SCM</strong> diatur terpisah di Level Manager.
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
            <UserCheck className="w-4 h-4 text-[#0B4EA2]" />
            <span>2. Level Staf &amp; Supervisor</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
            <strong>Staf HC, Admin Ops, Marketing, Akunting, General Affair, Bisnis Development, Gudang</strong> &amp; <strong>Supervisor</strong> memiliki pengaturan fitur tersendiri.
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
            <Coffee className="w-4 h-4 text-[#0B4EA2]" />
            <span>3. Level Kru (Barista)</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
            <strong>Barista, Head Bar, Trainee &amp; Kru Outlet</strong> mengakses portal mandiri (absensi GPS Maps, slip gaji pribadi &amp; training) sesuai sakelar Level Kru.
          </p>
        </div>
      </div>

      {/* SECTION 1: LEVEL MANAGER */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#0B4EA2]" />
              <h3 className="text-sm font-bold text-slate-900">
                1. Pengaturan Fitur Level Manager (Selain Manager HC)
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Mengatur fitur khusus untuk Manager Operasional, Manager Marketing, Manager Akunting &amp; Finance, dan Manager SCM.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {saving && <span className="text-xs font-medium text-amber-700 mr-1">Menyimpan...</span>}
            {isOwner && (
              <button
                type="button"
                onClick={() =>
                  void handleResetLevelFeatures(MANAGER_LEVEL_COLUMNS.map((c) => c.role))
                }
                className="h-8 px-3 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg"
              >
                Reset Level Manager
              </button>
            )}
          </div>
        </div>

        {renderMatrixTable(MANAGER_LEVEL_COLUMNS, 'min-w-[780px]')}
      </div>

      {/* SECTION 2: LEVEL STAF */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-[#0B4EA2]" />
              <h3 className="text-sm font-bold text-slate-900">
                2. Pengaturan Fitur Level Staf (Divisi Holding &amp; Supervisor)
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Terpisah dari Level Manager dan Level Kru (Barista); atur izin akses Staf HC, Admin Ops, Marketing, Akunting, GA, Bisnis Development, Gudang &amp; Supervisor secara independen.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {saving && <span className="text-xs font-medium text-amber-700 mr-1">Menyimpan...</span>}
            {isOwner && (
              <button
                type="button"
                onClick={() =>
                  void handleResetLevelFeatures(STAFF_LEVEL_COLUMNS.map((c) => c.role))
                }
                className="h-8 px-3 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg"
              >
                Reset Level Staf
              </button>
            )}
          </div>
        </div>

        {renderMatrixTable(STAFF_LEVEL_COLUMNS, 'min-w-[1100px]')}
      </div>

      {/* SECTION 3: LEVEL KRU (BARISTA) */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#0B4EA2]" />
              <h3 className="text-sm font-bold text-slate-900">
                3. Pengaturan Fitur Level Kru (Barista)
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Mengatur fitur portal mandiri khusus untuk seluruh akun dengan peran Barista / Kru Outlet.
            </p>
          </div>
          {saving && <span className="text-xs font-medium text-amber-700">Menyimpan...</span>}
        </div>

        <div className="divide-y divide-slate-100">
          {BARISTA_PERMISSION_ITEMS.map((item) => {
            const enabled =
              item.key === 'baristaCanUseLiveAttendance'
                ? permissions.baristaCanUseLiveAttendance !== false
                : Boolean(permissions[item.key]);
            return (
              <div
                key={item.key}
                className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-blue-50/40"
              >
                <div>
                  <p className="text-xs font-semibold text-slate-900">{item.title}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{item.desc}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  onClick={() => void handleToggleBaristaPermission(item.key)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    enabled ? 'bg-[#0B4EA2]' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                      enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* SECTION 4: ACCOUNT MANAGEMENT TABLE & BULK PROVISIONING */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Daftar Akun Login Manager, Staf &amp; Kru (Barista) ({users.length} Akun)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Seluruh Barista dan Staf dapat masuk menggunakan Username atau Email dengan password default yang telah ditetapkan dan disarankan segera mengubah password setelah login.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isOwner && (
              <button
                type="button"
                onClick={() => setBulkModalOpen(true)}
                className="h-9 px-3.5 text-xs font-semibold text-[#0B4EA2] bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg inline-flex items-center gap-1.5"
              >
                <Users className="w-3.5 h-3.5" />
                <span>
                  Buat Akun Massal Barista &amp; Staf
                  {unprovisionedEmployees.length > 0 ? ` (${unprovisionedEmployees.length})` : ''}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="h-9 px-4 text-xs font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] rounded-lg inline-flex items-center gap-1.5"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Buat Akun Baru</span>
            </button>
          </div>
        </div>

        {/* Search & Level Filter */}
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Cari nama, username, atau email..."
              className="h-8 pl-8 pr-3 border border-slate-300 rounded-lg bg-white w-64"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 font-medium">Filter Level:</span>
            <select
              value={userLevelFilter}
              onChange={(e) =>
                setUserLevelFilter(e.target.value as 'ALL' | 'MANAGER' | 'STAFF' | 'BARISTA')
              }
              className="h-8 px-2.5 border border-slate-300 rounded-lg bg-white font-semibold text-slate-700"
            >
              <option value="ALL">Semua Level ({users.length})</option>
              <option value="MANAGER">Level Manager &amp; Owner</option>
              <option value="STAFF">Level Staf &amp; Supervisor</option>
              <option value="BARISTA">Level Kru (Barista)</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#1B365D] text-white text-[11px] font-semibold">
                <th className="py-2.5 px-4">Nama &amp; Username</th>
                <th className="py-2.5 px-4">Email Login</th>
                <th className="py-2.5 px-4">Level / Peran</th>
                <th className="py-2.5 px-4">Tertaut ke Kru</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 px-4 text-center text-slate-500">
                    Tidak ada akun yang cocok dengan filter pencarian.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const linkedEmp = employees.find((e) => e.id === u.employeeId);
                  const canManageTarget = canManageUserTarget(u.role);
                  return (
                    <tr key={u.id} className="hover:bg-blue-50/40">
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-900">{u.fullName}</div>
                        <div className="font-mono text-[11px] text-slate-500">{u.username}</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-600">{u.email}</td>
                      <td className="py-2.5 px-4 font-semibold text-slate-800">
                        {u.role === 'HR Manager' ? 'Manager HC (Owner)' : u.role}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600">
                        {linkedEmp ? `${linkedEmp.name} (${linkedEmp.branch})` : '—'}
                      </td>
                      <td className="py-2.5 px-4 font-semibold">
                        <span className={u.active ? 'text-emerald-700' : 'text-red-700'}>
                          {u.active ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        {canManageTarget ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setResetTarget(u)}
                              title="Ubah Password"
                              className="px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 rounded inline-flex items-center gap-1"
                            >
                              <KeyRound className="w-3 h-3" />
                              <span>Password</span>
                            </button>
                            {u.id !== currentUser.id && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void handleToggleActive(u)}
                                  className="px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 rounded"
                                >
                                  {u.active ? 'Nonaktifkan' : 'Aktifkan'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteUser(u)}
                                  className="p-1.5 text-slate-400 hover:text-red-700 rounded"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">Terbatas</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bulk Provision Barista & Staff Modal */}
      {bulkModalOpen && isOwner && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setBulkModalOpen(false);
          }}
          className="fixed inset-0 z-50 bg-slate-950/40 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">
                Buat Akun Massal Barista &amp; Staf
              </h3>
              <button
                type="button"
                onClick={() => setBulkModalOpen(false)}
                title="Tutup"
                className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleBulkProvision} className="mt-4 space-y-3 text-xs">
              <p className="text-slate-600 leading-relaxed">
                Sistem akan membuat akun login untuk seluruh karyawan Barista &amp; Staf di Database Kru yang belum memiliki akun ({unprovisionedEmployees.length} orang menunggu).
              </p>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Password Default Akun Baru (min. 6 karakter)
                </label>
                <input
                  type="text"
                  required
                  minLength={6}
                  value={bulkDefaultPassword}
                  onChange={(e) => setBulkDefaultPassword(e.target.value)}
                  className="w-full h-9 px-3 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBulkModalOpen(false)}
                  className="h-9 px-4 font-semibold text-slate-700 border border-slate-300 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={bulkRunning}
                  className="h-9 px-4 font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] rounded-lg"
                >
                  {bulkRunning ? 'Membuat Akun...' : 'Buat Akun Sekarang'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {modalOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
          className="fixed inset-0 z-50 bg-slate-950/40 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">Buat Akun Login Baru</h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                title="Tutup"
                className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateUser} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Tautkan ke Data Kru / Staf (Opsional)
                </label>
                <select
                  value={selectedEmpId}
                  onChange={(e) => {
                    const emp = employees.find((x) => x.id === e.target.value);
                    setSelectedEmpId(e.target.value);
                    if (emp) {
                      setFullName(emp.name);
                      setEmail(emp.email);
                      setUsername(emp.email.split('@')[0]);
                      setRole(emp.role);
                    }
                  }}
                  className="w-full h-9 px-2.5 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">-- Pilih Karyawan --</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.branch} · {emp.position})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nama Lengkap</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full h-9 px-3 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Username</label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full h-9 px-3 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Peran</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="w-full h-9 px-2.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Barista">Barista (Kru / Outlet)</option>
                    {isOwner && (
                      <>
                        <option value="Supervisor">Supervisor (Level Staf)</option>
                        <option value="Staf HC">Staf HC (Level Staf)</option>
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
                      </>
                    )}
                    {isAdmin && <option value="HR Manager">Manager HC (Owner)</option>}
                    {isAdmin && <option value="Admin">Admin</option>}
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-9 px-3 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Password (min. 6 karakter)
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-9 px-3 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="h-9 px-4 font-semibold text-slate-700 border border-slate-300 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="h-9 px-4 font-semibold text-white bg-[#0B4EA2] rounded-lg"
                >
                  {saving ? 'Menyimpan...' : 'Simpan Akun'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetTarget && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setResetTarget(null);
          }}
          className="fixed inset-0 z-50 bg-slate-950/40 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                Reset Password: {resetTarget.fullName}
              </h3>
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                title="Tutup"
                className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleResetPassword} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Password Baru (min. 6 karakter)
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={resetPass}
                  onChange={(e) => setResetPass(e.target.value)}
                  className="w-full h-9 px-3 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="h-9 px-4 font-semibold text-slate-700 border border-slate-300 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="h-9 px-4 font-semibold text-white bg-[#0B4EA2] rounded-lg"
                >
                  Perbarui Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
