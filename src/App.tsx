import React, { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock,
  FileText,
  GraduationCap,
  KeyRound,
  LogOut,
  MapPin,
  Menu,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  AttendanceUploadBatch,
  ConfigurableRole,
  Employee,
  EvaluationIndicator,
  FeaturePermissions,
  HcAppState,
  KpiDivisionKey,
  KpiEvaluationRecord,
  KpiIndicatorItem,
  KpiJobDescription,
  PayrollPeriod,
  RoleFeatureAccess,
  TrainingBatch,
  UserAccount,
} from './types/hc';
import {
  connectGoogleForGmail,
  disconnectGoogleGmail,
  initGoogleAuthListener,
} from './lib/firebaseAuth';
import { LoginPortal } from './components/LoginPortal';
import { CrewDatabaseView } from './components/CrewDatabaseView';
import { OnboardingView } from './components/OnboardingView';
import { PayrollView } from './components/PayrollView';
import { KpiEvaluationView, KPI_DIVISIONS } from './components/KpiEvaluationView';
import { AccessControlView } from './components/AccessControlView';
import { BaristaSelfServiceView } from './components/BaristaSelfServiceView';
import { AttendancePenaltyView } from './components/AttendancePenaltyView';
import { LiveAttendanceView } from './components/LiveAttendanceView';
import { PersonalPayslipView } from './components/PersonalPayslipView';
import { ChangePasswordModal } from './components/ChangePasswordModal';

type NavSection =
  | 'crew'
  | 'onboarding'
  | 'payroll'
  | 'live_attendance'
  | 'attendance'
  | 'kpi'
  | 'my_payslip'
  | 'access';

const SECTION_META: Record<NavSection, { title: string; subtitle: string }> = {
  crew: {
    title: 'Database Kru & Staf',
    subtitle: 'Direktori terpusat seluruh barista, head bar, dan staf holding Toko Kopi Tuju',
  },
  onboarding: {
    title: 'Onboarding & Training 14 Hari',
    subtitle: 'Rekap peserta batch, jadwal harian, kehadiran H/I/S/A, 28 indikator & rapor individu',
  },
  payroll: {
    title: 'Payroll & Slip Gaji Otomatis',
    subtitle: 'Kalkulasi gaji, potongan, insentif holding, unduh PDF & kirim otomatis ke Gmail kru',
  },
  live_attendance: {
    title: 'Absensi Kehadiran & Lokasi Maps',
    subtitle: 'Absen datang & pulang dengan validasi radius GPS terhadap titik outlet Manager HC',
  },
  attendance: {
    title: 'Denda Kehadiran & Rekap Absensi',
    subtitle: 'Unggah file absensi (.xlsx / .csv), rekap kehadiran otomatis & kalkulasi denda keterlambatan',
  },
  kpi: {
    title: 'Evaluasi KPI Staf & Kepala Outlet',
    subtitle: 'Penilaian KPI Admin Operasional, Marketing, Supervisor, Akunting & Kepala Outlet',
  },
  my_payslip: {
    title: 'Slip Gaji Pribadi',
    subtitle: 'Lihat rincian slip gaji & insentif pribadi serta unduh PDF Slip Gaji resmi',
  },
  access: {
    title: 'Hak Akses & Akun Portal',
    subtitle: 'Kelola akun serta pengaturan fitur Manager Divisi, Staf HC, Supervisor & Barista',
  },
};

export default function App() {
  const [bootLoading, setBootLoading] = useState(true);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);

  // Strictly in-memory session auth token (never localStorage or sessionStorage)
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);

  // Strictly in-memory Google OAuth access token for Gmail API
  const [gmailToken, setGmailToken] = useState<string | null>(null);
  const [gmailEmail, setGmailEmail] = useState<string | null>(null);

  const [appState, setAppState] = useState<HcAppState | null>(null);
  const [activeSection, setActiveSection] = useState<NavSection>('onboarding');
  const [activeKpiDivision, setActiveKpiDivision] = useState<KpiDivisionKey>('admin_ops');
  const [kpiMenuOpen, setKpiMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [focusEmpId, setFocusEmpId] = useState<string | null>(null);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [gmpQuotaExceeded, setGmpQuotaExceeded] = useState(false);
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    () => (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) || ''
  );

  useEffect(() => {
    const onQuotaExceeded = () => setGmpQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
  }, []);

  useEffect(() => {
    fetch('/api/auth/bootstrap-status')
      .then((r) => r.json())
      .then((data) => {
        setNeedsBootstrap(Boolean(data.needsBootstrap));
      })
      .catch(() => {})
      .finally(() => setBootLoading(false));
  }, []);

  useEffect(() => {
    const unsub = initGoogleAuthListener(
      (user, token) => {
        setGmailToken(token);
        setGmailEmail(user.email);
      },
      () => {
        setGmailToken(null);
        setGmailEmail(null);
      }
    );
    return () => unsub();
  }, []);

  const loadState = useCallback(
    async (token: string) => {
      const [stateRes, mapsRes] = await Promise.all([
        fetch('/api/state', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        mapsApiKey
          ? Promise.resolve(null)
          : fetch('/api/maps-config', {
              headers: { Authorization: `Bearer ${token}` },
            }).catch(() => null),
      ]);
      if (stateRes.ok) {
        const data = (await stateRes.json()) as HcAppState;
        setAppState(data);
      }
      if (mapsRes?.ok) {
        const cfg = (await mapsRes.json()) as { apiKey?: string };
        if (cfg.apiKey) {
          setMapsApiKey(cfg.apiKey);
        }
      }
    },
    [mapsApiKey]
  );

  const handleAuthenticated = async (
    token: string,
    user: UserAccount,
    connectedGmailToken?: string
  ) => {
    setAuthToken(token);
    setCurrentUser(user);
    setNeedsBootstrap(false);
    if (connectedGmailToken) {
      setGmailToken(connectedGmailToken);
      setGmailEmail(user.email);
    }
    await loadState(token);
  };

  const handleLogout = async () => {
    if (authToken) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => {});
    }
    setAuthToken(null);
    setCurrentUser(null);
    setAppState(null);
    setChangePasswordOpen(false);
    const statusRes = await fetch('/api/auth/bootstrap-status').catch(() => null);
    if (statusRes?.ok) {
      const st = await statusRes.json();
      setNeedsBootstrap(Boolean(st.needsBootstrap));
    }
  };

  const handleConnectGmail = async () => {
    const { user, accessToken } = await connectGoogleForGmail();
    setGmailToken(accessToken);
    setGmailEmail(user.email);
  };

  const handleDisconnectGmail = async () => {
    await disconnectGoogleGmail();
    setGmailToken(null);
    setGmailEmail(null);
  };

  const saveEmployees = async (next: Employee[]) => {
    if (!authToken || !appState) return;
    setAppState({ ...appState, employees: next });
    await fetch('/api/employees', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ employees: next }),
    });
  };

  const saveOnboarding = async (
    batches: TrainingBatch[],
    indicators: EvaluationIndicator[]
  ) => {
    if (!authToken || !appState) return;
    setAppState({ ...appState, batches, indicators });
    await fetch('/api/onboarding', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ batches, indicators }),
    });
  };

  const savePayrollPeriods = async (payrollPeriods: PayrollPeriod[]) => {
    if (!authToken || !appState) return;
    setAppState({ ...appState, payrollPeriods });
    await fetch('/api/payroll', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ payrollPeriods }),
    });
  };

  const savePermissions = async (permissions: FeaturePermissions) => {
    if (!authToken || !appState) return;
    setAppState({ ...appState, permissions });
    await fetch('/api/permissions', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ permissions }),
    });
  };

  const saveKpi = async (
    kpiJobDescriptions: KpiJobDescription[],
    kpiTemplates: KpiIndicatorItem[],
    kpiEvaluations: KpiEvaluationRecord[]
  ) => {
    if (!authToken || !appState) return;
    setAppState({ ...appState, kpiJobDescriptions, kpiTemplates, kpiEvaluations });
    await fetch('/api/kpi', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ kpiJobDescriptions, kpiTemplates, kpiEvaluations }),
    });
  };

  const saveAttendanceBatches = async (attendanceBatches: AttendanceUploadBatch[]) => {
    if (!authToken || !appState) return;
    setAppState({ ...appState, attendanceBatches });
    await fetch('/api/attendance', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ attendanceBatches }),
    });
  };

  if (bootLoading) {
    return (
      <div className="min-h-screen bg-[#F4F7FB] flex items-center justify-center text-sm text-slate-600">
        Memuat Portal HC Toko Kopi Tuju...
      </div>
    );
  }

  if (!authToken || !currentUser || !appState) {
    return (
      <LoginPortal
        needsBootstrap={needsBootstrap}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  const isManagementRole = currentUser.role !== 'Barista';
  const isOwnerRole = currentUser.role === 'Admin' || currentUser.role === 'HR Manager';
  const canChangeOwnPassword = currentUser.role !== 'HR Manager';

  const DEFAULT_CONFIGURABLE_ROLE_FALLBACK: Record<ConfigurableRole, RoleFeatureAccess> = {
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

  const resolveConfigurableAccess = (role: ConfigurableRole): RoleFeatureAccess => {
    const fallback = DEFAULT_CONFIGURABLE_ROLE_FALLBACK[role];
    const configured =
      appState.permissions.roleFeatures?.[role] ||
      (role === 'Supervisor' ? appState.permissions.supervisorFeatures : undefined);
    return {
      canAccessCrew: configured?.canAccessCrew ?? fallback.canAccessCrew,
      canAccessOnboarding: configured?.canAccessOnboarding ?? fallback.canAccessOnboarding,
      canAccessPayroll: configured?.canAccessPayroll ?? fallback.canAccessPayroll,
      canAccessAttendance: configured?.canAccessAttendance ?? fallback.canAccessAttendance,
      canAccessLiveAttendance:
        configured?.canAccessLiveAttendance ?? fallback.canAccessLiveAttendance ?? true,
      canAccessKpi: configured?.canAccessKpi ?? fallback.canAccessKpi,
      canAccessAccessControl:
        configured?.canAccessAccessControl ?? fallback.canAccessAccessControl,
      canViewOwnPayslip: configured?.canViewOwnPayslip ?? fallback.canViewOwnPayslip,
      canDownloadOwnPayslip: configured?.canDownloadOwnPayslip ?? fallback.canDownloadOwnPayslip,
    };
  };

  const activeRoleAccess: RoleFeatureAccess =
    currentUser.role === 'Admin' || currentUser.role === 'HR Manager'
      ? {
          canAccessCrew: true,
          canAccessOnboarding: true,
          canAccessPayroll: true,
          canAccessAttendance: true,
          canAccessLiveAttendance: true,
          canAccessKpi: true,
          canAccessAccessControl: true,
          canViewOwnPayslip: false,
          canDownloadOwnPayslip: false,
        }
      : currentUser.role === 'Barista'
      ? {
          canAccessCrew: false,
          canAccessOnboarding: false,
          canAccessPayroll: false,
          canAccessAttendance: false,
          canAccessLiveAttendance: true,
          canAccessKpi: false,
          canAccessAccessControl: false,
          canViewOwnPayslip: Boolean(appState.permissions.baristaCanViewOwnPayslip),
          canDownloadOwnPayslip: Boolean(appState.permissions.baristaCanDownloadPayslip),
        }
      : resolveConfigurableAccess(currentUser.role);

  const allNavItems: Array<{
    id: NavSection;
    label: string;
    icon: React.ReactNode;
    allowed: boolean;
  }> = [
    {
      id: 'crew',
      label: 'Database Kru & Staf',
      icon: <Users className="w-4 h-4" />,
      allowed: activeRoleAccess.canAccessCrew,
    },
    {
      id: 'onboarding',
      label: 'Onboarding & Training',
      icon: <GraduationCap className="w-4 h-4" />,
      allowed: activeRoleAccess.canAccessOnboarding,
    },
    {
      id: 'payroll',
      label: 'Payroll & Slip Gaji',
      icon: <Wallet className="w-4 h-4" />,
      allowed: activeRoleAccess.canAccessPayroll,
    },
    {
      id: 'live_attendance',
      label: 'Absensi Kehadiran',
      icon: <MapPin className="w-4 h-4" />,
      allowed: activeRoleAccess.canAccessLiveAttendance ?? true,
    },
    {
      id: 'attendance',
      label: 'Denda Kehadiran',
      icon: <Clock className="w-4 h-4" />,
      allowed: activeRoleAccess.canAccessAttendance,
    },
    {
      id: 'kpi',
      label: 'Evaluasi KPI',
      icon: <ClipboardCheck className="w-4 h-4" />,
      allowed: activeRoleAccess.canAccessKpi,
    },
    {
      id: 'my_payslip',
      label: 'Slip Gaji Pribadi',
      icon: <FileText className="w-4 h-4" />,
      allowed: activeRoleAccess.canViewOwnPayslip,
    },
    {
      id: 'access',
      label: 'Akun & Hak Akses',
      icon: <ShieldCheck className="w-4 h-4" />,
      allowed: activeRoleAccess.canAccessAccessControl,
    },
  ];

  const navItems = allNavItems.filter((item) => item.allowed);
  const effectiveSection: NavSection = navItems.some((item) => item.id === activeSection)
    ? activeSection
    : navItems[0]?.id || 'onboarding';

  // Barista self-service layout
  if (!isManagementRole) {
    return (
      <div className="min-h-screen bg-[#F4F7FB]">
        {gmpQuotaExceeded && (
          <div className="sticky top-0 z-50 bg-amber-50 border-b border-amber-300 px-4 py-2 text-xs text-amber-900 text-center">
            This demo has reached its Google Maps quota. Set up your own key in the{' '}
            <a
              href="https://developers.google.com/maps/documentation/javascript/get-api-key"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline text-[#0B4EA2]"
            >
              Google Maps developer site
            </a>{' '}
            to continue.
          </div>
        )}
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 whitespace-nowrap shrink-0">
            <img
              src="/assets/aistudio/BIRU__1__68671e1f.png"
              alt="Logo Toko Kopi Tuju"
              referrerPolicy="no-referrer"
              className="h-6 w-auto object-contain"
            />
            <span className="text-sm font-bold tracking-tight text-[#0B4EA2]">
              Toko Kopi Tuju
            </span>
          </div>
          <div className="text-xs text-slate-500 hidden sm:block whitespace-nowrap">
            Portal Kru &amp; Staf · {currentUser.fullName}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canChangeOwnPassword && (
              <button
                type="button"
                onClick={() => setChangePasswordOpen(true)}
                className="h-9 px-3.5 text-xs font-semibold text-[#0B4EA2] bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Ubah Password</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="h-9 px-3.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Keluar</span>
            </button>
          </div>
        </header>

        <main className="max-w-5xl mx-auto px-6 py-8">
          <BaristaSelfServiceView
            currentUser={currentUser}
            state={appState}
            authToken={authToken}
            mapsApiKey={mapsApiKey}
            onRefreshState={() => loadState(authToken)}
          />
        </main>

        {changePasswordOpen && canChangeOwnPassword && (
          <ChangePasswordModal
            currentUser={currentUser}
            authToken={authToken}
            onClose={() => setChangePasswordOpen(false)}
            onPasswordUpdated={(updated) => setCurrentUser(updated)}
          />
        )}
      </div>
    );
  }

  // Manager HC & Admin Full Workspace Layout
  return (
    <div className="min-h-screen bg-[#F4F7FB] flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col justify-between bg-white text-slate-700 border-r border-slate-200 no-print">
        <div>
          <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-3">
            <img
              src="/assets/aistudio/BIRU__1__68671e1f.png"
              alt="Logo Toko Kopi Tuju"
              referrerPolicy="no-referrer"
              className="h-7 w-auto object-contain shrink-0"
            />
            <div className="min-w-0">
              <span className="block text-sm font-bold tracking-tight text-[#0B4EA2] truncate">
                Toko Kopi Tuju
              </span>
              <span className="block text-[11px] font-medium text-slate-500 truncate">
                HC &amp; Payroll Portal
              </span>
            </div>
          </div>

          <nav className="p-3 space-y-1">
            {navItems.map((item) => {
              const active = effectiveSection === item.id;
              const isKpi = item.id === 'kpi';
              return (
                <div key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setFocusEmpId(null);
                      if (isKpi) {
                        setKpiMenuOpen((prev) => (active ? !prev : true));
                        setActiveSection('kpi');
                      } else {
                        setActiveSection(item.id);
                      }
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-[#0B4EA2] text-white shadow-xs'
                        : 'text-slate-600 hover:bg-blue-50/80 hover:text-[#0B4EA2]'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      {item.icon}
                      <span>{item.label}</span>
                    </span>
                    {isKpi &&
                      (kpiMenuOpen ? (
                        <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                      ))}
                  </button>

                  {isKpi && kpiMenuOpen && (
                    <div className="mt-1 ml-3 pl-3 border-l border-blue-200 space-y-1">
                      {KPI_DIVISIONS.map((div) => {
                        const divActive =
                          effectiveSection === 'kpi' && activeKpiDivision === div.key;
                        return (
                          <button
                            key={div.key}
                            type="button"
                            onClick={() => {
                              setFocusEmpId(null);
                              setActiveSection('kpi');
                              setActiveKpiDivision(div.key);
                            }}
                            className={`w-full text-left px-2.5 py-2 text-[11px] font-medium rounded-md transition-colors leading-snug ${
                              divActive
                                ? 'bg-blue-50 text-[#0B4EA2] font-semibold'
                                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                            }`}
                          >
                            {div.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-slate-200 space-y-3 text-xs bg-slate-50/60">
          <div>
            <p className="font-semibold text-slate-900 truncate">{currentUser.fullName}</p>
            <p className="text-slate-500 mt-0.5">
              {currentUser.role} · {appState.employees.length} Kru
            </p>
          </div>
          <div className="space-y-2">
            {canChangeOwnPassword && (
              <button
                type="button"
                onClick={() => setChangePasswordOpen(true)}
                className="w-full h-9 px-3 text-xs font-semibold text-[#0B4EA2] bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg inline-flex items-center justify-center gap-2 transition-colors"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Ubah Password</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="w-full h-9 px-3 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg inline-flex items-center justify-center gap-2 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Keluar Portal</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 bg-white text-slate-700 border-r border-slate-200 flex flex-col justify-between p-4 overflow-y-auto">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                <div className="flex items-center gap-2.5">
                  <img
                    src="/assets/aistudio/BIRU__1__68671e1f.png"
                    alt="Logo Toko Kopi Tuju"
                    referrerPolicy="no-referrer"
                    className="h-6 w-auto object-contain"
                  />
                  <span className="font-bold text-sm text-[#0B4EA2]">Toko Kopi Tuju</span>
                </div>
                <button type="button" onClick={() => setMobileMenuOpen(false)}>
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
              <nav className="mt-4 space-y-1">
                {navItems.map((item) => {
                  const isKpi = item.id === 'kpi';
                  return (
                    <div key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (isKpi) {
                            setKpiMenuOpen((prev) =>
                              effectiveSection === 'kpi' ? !prev : true
                            );
                            setActiveSection('kpi');
                          } else {
                            setActiveSection(item.id);
                            setMobileMenuOpen(false);
                          }
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-xs font-semibold rounded-lg ${
                          effectiveSection === item.id
                            ? 'bg-[#0B4EA2] text-white'
                            : 'text-slate-600 hover:bg-blue-50/70'
                        }`}
                      >
                        <span className="flex items-center gap-3">
                          {item.icon}
                          <span>{item.label}</span>
                        </span>
                        {isKpi &&
                          (kpiMenuOpen ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          ))}
                      </button>

                      {isKpi && kpiMenuOpen && (
                        <div className="mt-1 ml-3 pl-3 border-l border-blue-200 space-y-1">
                          {KPI_DIVISIONS.map((div) => (
                            <button
                              key={div.key}
                              type="button"
                              onClick={() => {
                                setActiveSection('kpi');
                                setActiveKpiDivision(div.key);
                                setMobileMenuOpen(false);
                              }}
                              className={`w-full text-left px-2.5 py-2 text-[11px] rounded-md ${
                                effectiveSection === 'kpi' && activeKpiDivision === div.key
                                  ? 'bg-blue-50 text-[#0B4EA2] font-semibold'
                                  : 'text-slate-500'
                              }`}
                            >
                              {div.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>
            </div>
            <div className="space-y-2 pt-4 border-t border-slate-200">
              {canChangeOwnPassword && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setChangePasswordOpen(true);
                  }}
                  className="w-full h-9 px-3 text-xs font-semibold text-[#0B4EA2] bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg inline-flex items-center justify-center gap-2"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Ubah Password</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="w-full h-9 px-3 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg inline-flex items-center justify-center gap-2"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Keluar</span>
              </button>
            </div>
          </div>
          <div
            className="flex-1 bg-slate-950/40"
            onClick={() => setMobileMenuOpen(false)}
          />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {gmpQuotaExceeded && (
          <div className="sticky top-0 z-40 bg-amber-50 border-b border-amber-300 px-4 py-2 text-xs text-amber-900 text-center no-print">
            This demo has reached its Google Maps quota. Set up your own key in the{' '}
            <a
              href="https://developers.google.com/maps/documentation/javascript/get-api-key"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline text-[#0B4EA2]"
            >
              Google Maps developer site
            </a>{' '}
            to continue.
          </div>
        )}
        {/* Top Bar Contract (1 row, 3 zones) */}
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-8 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-slate-900 truncate">
                {SECTION_META[effectiveSection].title}
              </h1>
              <p className="text-xs text-slate-500 truncate hidden sm:block">
                {SECTION_META[effectiveSection].subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-slate-600 shrink-0 whitespace-nowrap">
            <span>
              {currentUser.role} · <strong className="text-[#0B4EA2]">{currentUser.fullName}</strong>
            </span>
          </div>
        </header>

        <main className="flex-1 p-6 max-w-[1440px] w-full mx-auto">
          {navItems.length === 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-600">
              Belum ada modul yang diaktifkan untuk posisi {currentUser.role}. Hubungi Admin Sistem.
            </div>
          )}

          {effectiveSection === 'crew' && activeRoleAccess.canAccessCrew && (
            <CrewDatabaseView
              employees={appState.employees}
              readOnly={!isOwnerRole}
              onSaveEmployees={saveEmployees}
              onOpenEmployeeTraining={
                activeRoleAccess.canAccessOnboarding
                  ? (empId) => {
                      setFocusEmpId(empId);
                      setActiveSection('onboarding');
                    }
                  : undefined
              }
              onOpenEmployeePayroll={
                activeRoleAccess.canAccessPayroll
                  ? (empId) => {
                      setFocusEmpId(empId);
                      setActiveSection('payroll');
                    }
                  : undefined
              }
            />
          )}

          {effectiveSection === 'onboarding' && activeRoleAccess.canAccessOnboarding && (
            <OnboardingView
              batches={appState.batches}
              indicators={appState.indicators}
              employees={appState.employees}
              initialTraineeEmployeeId={focusEmpId}
              onSaveOnboarding={saveOnboarding}
            />
          )}

          {effectiveSection === 'payroll' && activeRoleAccess.canAccessPayroll && (
            <PayrollView
              periods={appState.payrollPeriods}
              employees={appState.employees}
              dispatchLogs={appState.dispatchLogs}
              authToken={authToken}
              gmailToken={gmailToken}
              gmailUserEmail={gmailEmail}
              readOnly={!isOwnerRole}
              initialFocusEmployeeId={focusEmpId}
              onConnectGmail={handleConnectGmail}
              onDisconnectGmail={handleDisconnectGmail}
              onSavePeriods={savePayrollPeriods}
              onRefreshState={() => loadState(authToken)}
            />
          )}

          {effectiveSection === 'live_attendance' &&
            (activeRoleAccess.canAccessLiveAttendance ?? true) && (
              <LiveAttendanceView
                currentUser={currentUser}
                employees={appState.employees}
                outletLocations={appState.outletLocations || []}
                liveAttendanceRecords={appState.liveAttendanceRecords || []}
                myTodayClockState={appState.myTodayClockState ?? null}
                authToken={authToken}
                mapsApiKey={mapsApiKey}
                onRefreshState={() => loadState(authToken)}
              />
            )}

          {effectiveSection === 'attendance' && activeRoleAccess.canAccessAttendance && (
            <AttendancePenaltyView
              attendanceBatches={appState.attendanceBatches || []}
              employees={appState.employees}
              payrollPeriods={appState.payrollPeriods}
              canSyncPayroll={isOwnerRole && activeRoleAccess.canAccessPayroll}
              onSaveAttendanceBatches={saveAttendanceBatches}
              onSavePayrollPeriods={savePayrollPeriods}
            />
          )}

          {effectiveSection === 'kpi' && activeRoleAccess.canAccessKpi && (
            <KpiEvaluationView
              kpiJobDescriptions={appState.kpiJobDescriptions || []}
              kpiTemplates={appState.kpiTemplates || []}
              kpiEvaluations={appState.kpiEvaluations || []}
              employees={appState.employees}
              activeDivision={activeKpiDivision}
              onSelectDivision={setActiveKpiDivision}
              onSaveKpi={saveKpi}
            />
          )}

          {effectiveSection === 'my_payslip' && activeRoleAccess.canViewOwnPayslip && (
            <PersonalPayslipView
              currentUser={currentUser}
              employees={appState.employees}
              personalPayrollPeriods={
                appState.personalPayrollPeriods ?? appState.payrollPeriods
              }
              canDownloadPdf={activeRoleAccess.canDownloadOwnPayslip}
            />
          )}

          {effectiveSection === 'access' && activeRoleAccess.canAccessAccessControl && (
            <AccessControlView
              currentUser={currentUser}
              users={appState.users}
              employees={appState.employees}
              permissions={appState.permissions}
              authToken={authToken}
              onUpdatePermissions={savePermissions}
              onRefreshState={() => loadState(authToken)}
            />
          )}
        </main>
      </div>

      {changePasswordOpen && canChangeOwnPassword && (
        <ChangePasswordModal
          currentUser={currentUser}
          authToken={authToken}
          onClose={() => setChangePasswordOpen(false)}
          onPasswordUpdated={(updated) => setCurrentUser(updated)}
        />
      )}
    </div>
  );
}
