import React, { useEffect, useMemo, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  Circle,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useMap,
} from '@vis.gl/react-google-maps';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock,
  Crosshair,
  Download,
  Lock,
  LogIn,
  LogOut as LogOutIcon,
  MapPin,
  Navigation,
  Save,
  Search,
  Settings,
  ShieldAlert,
} from 'lucide-react';
import type {
  BranchName,
  Employee,
  LiveAttendanceRecord,
  OutletLocationConfig,
  TodayClockState,
  UserAccount,
} from '../types/hc';
import {
  calculateHaversineMeters,
  formatDateID,
  formatRupiah,
  getWitaDateAndTime,
} from '../utils/calculations';

interface LiveAttendanceViewProps {
  currentUser: UserAccount;
  employees: Employee[];
  outletLocations: OutletLocationConfig[];
  liveAttendanceRecords: LiveAttendanceRecord[];
  myTodayClockState?: TodayClockState | null;
  authToken: string;
  mapsApiKey: string;
  compactForBarista?: boolean;
  onRefreshState: () => Promise<void>;
}

interface GpsCoords {
  lat: number;
  lng: number;
  accuracyMeters: number;
  capturedAt: string;
}

const BRANCH_OPTIONS: BranchName[] = [
  'Abdesir',
  'Agus Salim',
  'Djemma',
  'Holding',
  'Perintis',
  'Tamalate',
];

const SHIFT_PRESETS = [
  { key: 'shift1', label: 'Shift 1 (Pagi)', start: '06:05' },
  { key: 'shift2', label: 'Shift 2 (Siang)', start: '11:05' },
  { key: 'shift3', label: 'Shift 3 (Sore)', start: '15:05' },
  { key: 'holding', label: 'Holding / Manajemen', start: '09:00' },
];

// Neutral regional viewport used only when an outlet has not yet been pinned by Manager HC
const DEFAULT_VIEWPORT_CENTER = { lat: -5.1477, lng: 119.4327 };

const MapCameraController: React.FC<{
  center: { lat: number; lng: number } | null;
  zoom?: number;
}> = ({ center, zoom }) => {
  const map = useMap();
  useEffect(() => {
    if (!map || !center) return;
    map.panTo(center);
    if (typeof zoom === 'number') {
      map.setZoom(zoom);
    }
  }, [map, center?.lat, center?.lng, zoom]);
  return null;
};

export const LiveAttendanceView: React.FC<LiveAttendanceViewProps> = ({
  currentUser,
  employees,
  outletLocations,
  liveAttendanceRecords,
  myTodayClockState = null,
  authToken,
  mapsApiKey,
  compactForBarista = false,
  onRefreshState,
}) => {
  const isOwnerRole = currentUser.role === 'Admin' || currentUser.role === 'HR Manager';

  const selfEmployee = useMemo(
    () =>
      employees.find(
        (e) =>
          (currentUser.employeeId && e.id === currentUser.employeeId) ||
          e.email.toLowerCase() === currentUser.email.toLowerCase()
      ),
    [employees, currentUser]
  );

  // Manager HC / Owner tabs: strictly 'history' (Riwayat Absensi) and 'outlet_setup' (Pengaturan Lokasi)
  const [ownerTab, setOwnerTab] = useState<'history' | 'outlet_setup'>('history');

  // Staff clock-in / clock-out controls
  const [selectedBranch, setSelectedBranch] = useState<BranchName>(
    selfEmployee?.branch || 'Abdesir'
  );
  const [selectedShiftKey, setSelectedShiftKey] = useState<string>(
    (selfEmployee?.branch || '') === 'Holding' ? 'holding' : 'shift1'
  );
  const [clockNote, setClockNote] = useState('');

  // Mandatory live device GPS state for staff
  const [locationPermissionState, setLocationPermissionState] = useState<
    'checking' | 'granted' | 'prompt' | 'denied' | 'unsupported'
  >('checking');
  const [gpsCoords, setGpsCoords] = useState<GpsCoords | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Clock-in/out submission feedback
  const [clockSubmitting, setClockSubmitting] = useState(false);
  const [clockMessage, setClockMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Map marker InfoWindow state
  const [openMarkerInfo, setOpenMarkerInfo] = useState<'outlet' | 'user' | null>(null);

  // Manager HC History Filters
  const [historySearch, setHistorySearch] = useState('');
  const [historyBranchFilter, setHistoryBranchFilter] = useState<string>('ALL');
  const [historyDateFilter, setHistoryDateFilter] = useState<string>('');

  // Manager HC Outlet Setup state
  const [setupBranch, setSetupBranch] = useState<BranchName>('Abdesir');
  const [setupLatInput, setSetupLatInput] = useState('');
  const [setupLngInput, setSetupLngInput] = useState('');
  const [setupRadiusInput, setSetupRadiusInput] = useState('100');
  const [setupAddressInput, setSetupAddressInput] = useState('');
  const [setupSaving, setSetupSaving] = useState(false);
  const [setupMessage, setSetupMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const witaNow = getWitaDateAndTime(new Date());

  const requestCurrentGps = (onCaptured?: (coords: GpsCoords) => void) => {
    setGpsError(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationPermissionState('unsupported');
      setGpsError('Browser atau perangkat Anda tidak mendukung akses lokasi GPS.');
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next: GpsCoords = {
          lat: Number(position.coords.latitude.toFixed(6)),
          lng: Number(position.coords.longitude.toFixed(6)),
          accuracyMeters: Math.round(position.coords.accuracy || 0),
          capturedAt: getWitaDateAndTime(new Date()).timeHHmm,
        };
        setLocationPermissionState('granted');
        setGpsCoords(next);
        setGpsLoading(false);
        onCaptured?.(next);
      },
      (err) => {
        setGpsLoading(false);
        setGpsCoords(null);
        if (err.code === err.PERMISSION_DENIED) {
          setLocationPermissionState('denied');
          setGpsError(
            'Akses lokasi ditolak/nonaktif. Anda wajib mengaktifkan izin lokasi perangkat & browser untuk dapat melakukan absen.'
          );
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setGpsError('Sinyal GPS perangkat tidak tersedia. Aktifkan layanan lokasi (GPS) perangkat dan coba lagi.');
        } else {
          setGpsError('Waktu deteksi GPS habis. Pastikan GPS aktif lalu tekan tombol deteksi lokasi kembali.');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      }
    );
  };

  // Check geolocation permission on mount for staff (without triggering unsolicited browser prompt)
  useEffect(() => {
    if (isOwnerRole) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationPermissionState('unsupported');
      return;
    }
    if (!navigator.permissions?.query) {
      setLocationPermissionState('prompt');
      return;
    }
    let cancelled = false;
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((status) => {
        if (cancelled) return;
        setLocationPermissionState(status.state);
        if (status.state === 'granted') {
          requestCurrentGps();
        }
        status.onchange = () => {
          if (cancelled) return;
          setLocationPermissionState(status.state);
          if (status.state === 'denied') {
            setGpsCoords(null);
          } else if (status.state === 'granted') {
            requestCurrentGps();
          }
        };
      })
      .catch(() => {
        if (!cancelled) setLocationPermissionState('prompt');
      });
    return () => {
      cancelled = true;
    };
  }, [isOwnerRole]);

  // Sync setup form when setupBranch or outletLocations updates
  useEffect(() => {
    const target = outletLocations.find((o) => o.branch === setupBranch);
    if (!target) return;
    setSetupLatInput(target.lat !== null ? String(target.lat) : '');
    setSetupLngInput(target.lng !== null ? String(target.lng) : '');
    setSetupRadiusInput(String(target.radiusMeters || 100));
    setSetupAddressInput(
      target.configured ? target.addressLabel : `Outlet Kopi Tuju ${setupBranch}`
    );
  }, [setupBranch, outletLocations]);

  // Staff shift lock state (derived from lightweight myTodayClockState — no history table/timestamps exposed)
  const hasClockedInToday = Boolean(myTodayClockState?.hasClockedIn);
  const hasClockedOutToday = Boolean(myTodayClockState?.hasClockedOut);

  const effectiveAttendanceBranch: BranchName =
    hasClockedInToday && !hasClockedOutToday && myTodayClockState?.branch
      ? myTodayClockState.branch
      : selectedBranch;

  const activeOutlet = useMemo(() => {
    return (
      outletLocations.find((o) => o.branch === effectiveAttendanceBranch) || {
        branch: effectiveAttendanceBranch,
        configured: false,
        lat: null,
        lng: null,
        radiusMeters: 100,
        addressLabel: 'Belum diatur Manager HC',
      }
    );
  }, [outletLocations, effectiveAttendanceBranch]);

  const distanceMeters = useMemo(() => {
    if (
      !gpsCoords ||
      !activeOutlet.configured ||
      activeOutlet.lat === null ||
      activeOutlet.lng === null
    ) {
      return null;
    }
    return Math.round(
      calculateHaversineMeters(gpsCoords.lat, gpsCoords.lng, activeOutlet.lat, activeOutlet.lng)
    );
  }, [gpsCoords, activeOutlet]);

  const isLocationActive = locationPermissionState === 'granted' && Boolean(gpsCoords);
  const isWithinGeofence =
    isLocationActive &&
    Boolean(activeOutlet.configured) &&
    distanceMeters !== null &&
    distanceMeters <= activeOutlet.radiusMeters;

  const canClockIn = isWithinGeofence && !hasClockedInToday && !clockSubmitting;
  const canClockOut =
    isWithinGeofence && hasClockedInToday && !hasClockedOutToday && !clockSubmitting;

  const handleClockAction = async (action: 'clock_in' | 'clock_out') => {
    setClockMessage(null);
    if (!isLocationActive || !gpsCoords || !isWithinGeofence) {
      setClockMessage({
        type: 'error',
        text: 'Lokasi perangkat belum aktif atau berada di luar radius outlet yang ditentukan Manager HC. Absen terkunci.',
      });
      return;
    }

    const shiftObj =
      SHIFT_PRESETS.find((s) => s.key === selectedShiftKey) || SHIFT_PRESETS[0];

    setClockSubmitting(true);
    try {
      const res = await fetch('/api/live-attendance/clock', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          action,
          branch: effectiveAttendanceBranch,
          lat: gpsCoords.lat,
          lng: gpsCoords.lng,
          shiftLabel: shiftObj.label,
          shiftStart: shiftObj.start,
          note: clockNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setClockMessage({
          type: 'error',
          text: data.error || 'Gagal mencatat absensi kehadiran.',
        });
        return;
      }

      setClockMessage({
        type: 'success',
        text:
          action === 'clock_in'
            ? `Absen Datang di outlet ${effectiveAttendanceBranch} berhasil dicatat (jarak ${data.distanceMeters} m dari titik outlet).`
            : `Absen Pulang di outlet ${effectiveAttendanceBranch} berhasil dicatat (jarak ${data.distanceMeters} m dari titik outlet).`,
      });
      setClockNote('');
      await onRefreshState();
    } catch {
      setClockMessage({
        type: 'error',
        text: 'Gagal terhubung ke server absensi. Periksa koneksi internet Anda.',
      });
    } finally {
      setClockSubmitting(false);
    }
  };

  const handleSaveOutletLocation = async (configured: boolean) => {
    if (!isOwnerRole) return;
    setSetupMessage(null);

    const parsedLat = Number(setupLatInput);
    const parsedLng = Number(setupLngInput);
    const parsedRadius = Math.round(Number(setupRadiusInput));

    if (
      configured &&
      (!setupLatInput.trim() ||
        !setupLngInput.trim() ||
        !Number.isFinite(parsedLat) ||
        !Number.isFinite(parsedLng))
    ) {
      setSetupMessage({
        type: 'error',
        text: 'Pilih titik lokasi pada peta atau isi koordinat Latitude & Longitude terlebih dahulu.',
      });
      return;
    }

    setSetupSaving(true);
    try {
      const res = await fetch('/api/outlet-locations', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          branch: setupBranch,
          configured,
          lat: configured ? parsedLat : null,
          lng: configured ? parsedLng : null,
          radiusMeters: Number.isFinite(parsedRadius) ? parsedRadius : 100,
          addressLabel: setupAddressInput,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSetupMessage({
          type: 'error',
          text: data.error || 'Gagal menyimpan titik lokasi outlet.',
        });
        return;
      }
      setSetupMessage({
        type: 'success',
        text: configured
          ? `Titik lokasi outlet ${setupBranch} (radius ${parsedRadius} m) berhasil disimpan.`
          : `Validasi titik lokasi outlet ${setupBranch} dinonaktifkan sementara.`,
      });
      await onRefreshState();
    } catch {
      setSetupMessage({
        type: 'error',
        text: 'Terjadi kesalahan saat menyimpan pengaturan lokasi outlet.',
      });
    } finally {
      setSetupSaving(false);
    }
  };

  // Manager HC only: filtered attendance history
  const filteredOwnerRecords = useMemo(() => {
    if (!isOwnerRole) return [];
    const q = historySearch.trim().toLowerCase();
    return liveAttendanceRecords.filter((r) => {
      if (historyBranchFilter !== 'ALL' && r.branch !== historyBranchFilter) return false;
      if (historyDateFilter && r.date !== historyDateFilter) return false;
      if (
        q &&
        !r.employeeName.toLowerCase().includes(q) &&
        !r.role.toLowerCase().includes(q) &&
        !r.branch.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [isOwnerRole, liveAttendanceRecords, historySearch, historyBranchFilter, historyDateFilter]);

  const ownerSummary = useMemo(() => {
    if (!isOwnerRole) {
      return { total: 0, onTime: 0, late: 0, completed: 0, totalPenalty: 0 };
    }
    return filteredOwnerRecords.reduce(
      (acc, r) => {
        acc.total += 1;
        if (r.status === 'Hadir') acc.onTime += 1;
        else acc.late += 1;
        if (r.clockOutTime) acc.completed += 1;
        acc.totalPenalty += r.penaltyAmount || 0;
        return acc;
      },
      { total: 0, onTime: 0, late: 0, completed: 0, totalPenalty: 0 }
    );
  }, [isOwnerRole, filteredOwnerRecords]);

  const handleExportCsv = () => {
    if (!isOwnerRole) return;
    const headers = [
      'Tanggal',
      'Nama',
      'Jabatan/Peran',
      'Outlet',
      'Shift',
      'Absen Datang',
      'Jarak Datang (m)',
      'Absen Pulang',
      'Jarak Pulang (m)',
      'Durasi Kerja',
      'Status',
      'Telat (Menit)',
      'Denda (Rp)',
    ];
    const rows = filteredOwnerRecords.map((r) => [
      r.date,
      r.employeeName,
      r.role,
      r.branch,
      `${r.shiftLabel} (${r.shiftStart})`,
      r.clockInTime || '-',
      r.clockInDistanceMeters ?? '-',
      r.clockOutTime || '-',
      r.clockOutDistanceMeters ?? '-',
      r.workDuration || '-',
      r.status,
      r.lateMinutes,
      r.penaltyAmount,
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Riwayat_Absensi_KopiTuju_${witaNow.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clockMapCenter = useMemo(() => {
    if (activeOutlet.configured && activeOutlet.lat !== null && activeOutlet.lng !== null) {
      return { lat: activeOutlet.lat, lng: activeOutlet.lng };
    }
    if (gpsCoords) {
      return { lat: gpsCoords.lat, lng: gpsCoords.lng };
    }
    return DEFAULT_VIEWPORT_CENTER;
  }, [activeOutlet.configured, activeOutlet.lat, activeOutlet.lng, gpsCoords]);

  const setupDraftLat = Number(setupLatInput);
  const setupDraftLng = Number(setupLngInput);
  const hasValidSetupDraftCoords =
    setupLatInput.trim() !== '' &&
    setupLngInput.trim() !== '' &&
    Number.isFinite(setupDraftLat) &&
    Number.isFinite(setupDraftLng);
  const setupDraftRadius = Math.max(
    20,
    Math.min(5000, Math.round(Number(setupRadiusInput) || 100))
  );

  const setupMapCenter = hasValidSetupDraftCoords
    ? { lat: setupDraftLat, lng: setupDraftLng }
    : DEFAULT_VIEWPORT_CENTER;

  // =====================================================================
  // OWNER VIEW (MANAGER HC / ADMIN): RIWAYAT ABSENSI + PENGATURAN OUTLET
  // =====================================================================
  if (isOwnerRole && !compactForBarista) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setOwnerTab('history')}
              className={`h-9 px-4 text-xs font-semibold rounded-lg inline-flex items-center gap-2 transition-colors ${
                ownerTab === 'history'
                  ? 'bg-[#0B4EA2] text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-[#0B4EA2]'
              }`}
            >
              <ClipboardList className="w-3.5 h-3.5" />
              <span>Riwayat Absensi Staf (Manager HC)</span>
            </button>

            <button
              type="button"
              onClick={() => setOwnerTab('outlet_setup')}
              className={`h-9 px-4 text-xs font-semibold rounded-lg inline-flex items-center gap-2 transition-colors ${
                ownerTab === 'outlet_setup'
                  ? 'bg-[#0B4EA2] text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-[#0B4EA2]'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Pengaturan Titik Lokasi Outlet (Maps)</span>
            </button>
          </div>

          <div className="text-xs text-slate-500 flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-[#0B4EA2]" />
            <span className="font-mono font-semibold text-slate-800">
              {formatDateID(witaNow.date)} · {witaNow.timeHHmm} WITA
            </span>
          </div>
        </div>

        {/* MANAGER HC TAB 1: RIWAYAT ABSENSI STAF */}
        {ownerTab === 'history' && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-[11px] font-semibold text-slate-500">Total Catatan Absensi</p>
                <p className="mt-1 text-xl font-bold font-mono text-slate-900">
                  {ownerSummary.total}
                </p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-[11px] font-semibold text-slate-500">Hadir Tepat Waktu</p>
                <p className="mt-1 text-xl font-bold font-mono text-emerald-700">
                  {ownerSummary.onTime}
                </p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-[11px] font-semibold text-slate-500">Terlambat / Selesai Pulang</p>
                <p className="mt-1 text-xl font-bold font-mono text-[#0B4EA2]">
                  {ownerSummary.late}{' '}
                  <span className="text-xs font-normal text-slate-500">
                    / {ownerSummary.completed} pulang
                  </span>
                </p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-[11px] font-semibold text-slate-500">Akumulasi Denda Telat</p>
                <p className="mt-1 text-xl font-bold font-mono text-slate-900">
                  {formatRupiah(ownerSummary.totalPenalty)}
                </p>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Riwayat Absensi Kehadiran Staf (Khusus Manager HC)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Hanya Manager HC yang dapat memantau log absen datang/pulang, koordinat jarak GPS outlet, dan denda keterlambatan staf.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder="Cari nama staf..."
                      className="h-8 pl-8 pr-3 border border-slate-300 rounded-lg w-44"
                    />
                  </div>

                  <input
                    type="date"
                    value={historyDateFilter}
                    onChange={(e) => setHistoryDateFilter(e.target.value)}
                    className="h-8 px-2.5 border border-slate-300 rounded-lg bg-white font-mono"
                  />

                  <select
                    value={historyBranchFilter}
                    onChange={(e) => setHistoryBranchFilter(e.target.value)}
                    className="h-8 px-2.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="ALL">Semua Outlet</option>
                    {BRANCH_OPTIONS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>

                  {filteredOwnerRecords.length > 0 && (
                    <button
                      type="button"
                      onClick={handleExportCsv}
                      className="h-8 px-3 font-semibold text-[#0B4EA2] bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg inline-flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Ekspor CSV</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse min-w-[820px]">
                  <thead>
                    <tr className="bg-[#1B365D] text-white text-[11px] font-semibold">
                      <th className="py-2.5 px-3.5">Tanggal</th>
                      <th className="py-2.5 px-3.5">Nama Staf &amp; Peran</th>
                      <th className="py-2.5 px-3.5">Outlet</th>
                      <th className="py-2.5 px-3.5">Shift</th>
                      <th className="py-2.5 px-3.5">Absen Datang</th>
                      <th className="py-2.5 px-3.5">Absen Pulang</th>
                      <th className="py-2.5 px-3.5">Durasi</th>
                      <th className="py-2.5 px-3.5">Status</th>
                      <th className="py-2.5 px-3.5 text-right">Denda Telat</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredOwnerRecords.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-8 px-4 text-center text-slate-500">
                          Belum ada riwayat absensi staf yang sesuai filter saat ini.
                        </td>
                      </tr>
                    ) : (
                      filteredOwnerRecords.map((rec) => (
                        <tr key={rec.id} className="hover:bg-blue-50/40">
                          <td className="py-2.5 px-3.5 font-mono text-slate-700 whitespace-nowrap">
                            {formatDateID(rec.date)}
                          </td>
                          <td className="py-2.5 px-3.5">
                            <div className="font-semibold text-slate-900">{rec.employeeName}</div>
                            <div className="text-[11px] text-slate-500">{rec.role}</div>
                          </td>
                          <td className="py-2.5 px-3.5 font-semibold text-slate-800">{rec.branch}</td>
                          <td className="py-2.5 px-3.5 text-slate-600 whitespace-nowrap">
                            {rec.shiftLabel} ({rec.shiftStart})
                          </td>
                          <td className="py-2.5 px-3.5 font-mono whitespace-nowrap">
                            <div className="font-semibold text-slate-900">
                              {rec.clockInTime ? `${rec.clockInTime} WITA` : '—'}
                            </div>
                            {rec.clockInDistanceMeters !== undefined && (
                              <div className="text-[10px] text-emerald-700">
                                Jarak {rec.clockInDistanceMeters} m
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3.5 font-mono whitespace-nowrap">
                            <div className="font-semibold text-slate-900">
                              {rec.clockOutTime ? `${rec.clockOutTime} WITA` : '—'}
                            </div>
                            {rec.clockOutDistanceMeters !== undefined && (
                              <div className="text-[10px] text-emerald-700">
                                Jarak {rec.clockOutDistanceMeters} m
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3.5 font-mono text-slate-700 whitespace-nowrap">
                            {rec.workDuration || '—'}
                          </td>
                          <td className="py-2.5 px-3.5 whitespace-nowrap">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                                rec.status === 'Hadir'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-red-50 text-red-700 border border-red-200'
                              }`}
                            >
                              {rec.status}
                              {rec.lateMinutes > 0 ? ` (${rec.lateMinutes} mnt)` : ''}
                            </span>
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-mono tabular-nums font-semibold text-slate-800 whitespace-nowrap">
                            {rec.penaltyAmount > 0 ? formatRupiah(rec.penaltyAmount) : 'Rp0'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* MANAGER HC TAB 2: PENGATURAN TITIK LOKASI OUTLET */}
        {ownerTab === 'outlet_setup' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900">
                  Pengaturan Titik Lokasi Outlet (Manager HC)
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Klik langsung di peta Google Maps atau gunakan GPS saat Anda berada di outlet untuk menetapkan koordinat resmi dan radius absensi staf.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {BRANCH_OPTIONS.map((branch) => {
                  const cfg = outletLocations.find((o) => o.branch === branch);
                  const selected = setupBranch === branch;
                  return (
                    <button
                      key={branch}
                      type="button"
                      onClick={() => {
                        setSetupBranch(branch);
                        setSetupMessage(null);
                      }}
                      className={`p-2.5 rounded-lg border text-left transition-colors ${
                        selected
                          ? 'border-[#0B4EA2] bg-blue-50 text-[#0B4EA2]'
                          : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="text-xs font-bold">{branch}</div>
                      <div className="text-[10px] mt-0.5 font-medium">
                        {cfg?.configured ? (
                          <span className="text-emerald-700">
                            Aktif · {cfg.radiusMeters} m
                          </span>
                        ) : (
                          <span className="text-amber-700">Belum Diatur</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="space-y-3 text-xs pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">
                    Konfigurasi Outlet {setupBranch}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      requestCurrentGps((coords) => {
                        setSetupLatInput(String(coords.lat));
                        setSetupLngInput(String(coords.lng));
                      })
                    }
                    disabled={gpsLoading}
                    className="h-8 px-3 text-[11px] font-semibold text-[#0B4EA2] bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg inline-flex items-center gap-1.5"
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    <span>{gpsLoading ? 'Mengambil GPS...' : 'Ambil GPS Lokasi Ini'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Latitude</label>
                    <input
                      type="text"
                      value={setupLatInput}
                      onChange={(e) => setSetupLatInput(e.target.value)}
                      placeholder="Klik peta atau ketik lat"
                      className="w-full h-9 px-3 border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Longitude</label>
                    <input
                      type="text"
                      value={setupLngInput}
                      onChange={(e) => setSetupLngInput(e.target.value)}
                      placeholder="Klik peta atau ketik lng"
                      className="w-full h-9 px-3 border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Radius Toleransi (meter)
                    </label>
                    <input
                      type="number"
                      min={20}
                      max={5000}
                      value={setupRadiusInput}
                      onChange={(e) => setSetupRadiusInput(e.target.value)}
                      className="w-full h-9 px-3 border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Keterangan / Alamat Titik
                    </label>
                    <input
                      type="text"
                      value={setupAddressInput}
                      onChange={(e) => setSetupAddressInput(e.target.value)}
                      placeholder="Contoh: Toko Kopi Tuju Jl. Abdesir"
                      className="w-full h-9 px-3 border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                {setupMessage && (
                  <div
                    className={`p-3 rounded-lg border text-xs font-medium ${
                      setupMessage.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-red-50 border-red-200 text-red-800'
                    }`}
                  >
                    {setupMessage.text}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={setupSaving}
                    onClick={() => void handleSaveOutletLocation(true)}
                    className="h-9 px-4 text-xs font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] disabled:opacity-60 rounded-lg inline-flex items-center gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{setupSaving ? 'Menyimpan...' : 'Simpan Titik Outlet'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={setupSaving}
                    onClick={() => void handleSaveOutletLocation(false)}
                    className="h-9 px-3 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg"
                  >
                    Nonaktifkan Titik
                  </button>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Klik Peta untuk Memasang Titik Outlet {setupBranch}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Klik titik bangunan outlet pada Google Maps di bawah untuk mengisi koordinat otomatis beserta pratinjau lingkaran radius.
                  </p>
                </div>
                <span className="text-[11px] font-mono text-slate-600 bg-slate-100 px-2.5 py-1 rounded-md">
                  {setupDraftRadius} m
                </span>
              </div>

              {!mapsApiKey ? (
                <div className="h-[400px] rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center p-6 text-center text-xs text-slate-600">
                  Google Maps API Key belum tersedia di runtime server.
                </div>
              ) : (
                <div className="w-full h-[400px] rounded-xl overflow-hidden border border-slate-200">
                  <APIProvider apiKey={mapsApiKey} language="id" region="ID">
                    <GoogleMap
                      mapId="DEMO_MAP_ID"
                      defaultCenter={setupMapCenter}
                      defaultZoom={hasValidSetupDraftCoords ? 17 : 13}
                      gestureHandling="greedy"
                      internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                      style={{ width: '100%', height: '400px' }}
                      onClick={(ev) => {
                        const latLng = ev.detail?.latLng;
                        if (!latLng) return;
                        setSetupLatInput(String(Number(latLng.lat.toFixed(6))));
                        setSetupLngInput(String(Number(latLng.lng.toFixed(6))));
                        setSetupMessage(null);
                      }}
                    >
                      <MapCameraController
                        center={setupMapCenter}
                        zoom={hasValidSetupDraftCoords ? 17 : 13}
                      />
                      {hasValidSetupDraftCoords && (
                        <>
                          <Circle
                            center={{ lat: setupDraftLat, lng: setupDraftLng }}
                            radius={setupDraftRadius}
                            strokeColor="#0B4EA2"
                            strokeOpacity={0.9}
                            strokeWeight={2}
                            fillColor="#0B4EA2"
                            fillOpacity={0.16}
                          />
                          <AdvancedMarker
                            position={{ lat: setupDraftLat, lng: setupDraftLng }}
                          >
                            <Pin
                              background="#0B4EA2"
                              glyphColor="#FFFFFF"
                              borderColor="#1B365D"
                            />
                          </AdvancedMarker>
                        </>
                      )}
                    </GoogleMap>
                  </APIProvider>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // =====================================================================
  // STAFF VIEW (ONLY ABSEN DATANG & PULANG + WAJIB AKTIFKAN LOKASI; NO HISTORY)
  // =====================================================================
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Control Card */}
      <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Absensi Kehadiran Staf
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Wajib mengaktifkan lokasi GPS perangkat sesuai titik outlet yang ditentukan Manager HC.
            </p>
          </div>
          <span className="text-[11px] font-mono font-semibold text-[#0B4EA2] bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200 whitespace-nowrap">
            {witaNow.timeHHmm} WITA
          </span>
        </div>

        {/* Today's Action Status Indicator (No history table or past timestamps exposed) */}
        <div className="p-3.5 rounded-xl bg-[#F4F7FB] border border-blue-100 flex items-center justify-between gap-2 text-xs">
          <div>
            <span className="block font-semibold text-slate-700">
              Status Sesi Hari Ini ({formatDateID(witaNow.date)})
            </span>
            <span className="text-[11px] text-slate-500">
              {hasClockedOutToday
                ? 'Absen Datang & Pulang hari ini telah selesai tercatat.'
                : hasClockedInToday
                ? `Sudah Absen Datang di ${effectiveAttendanceBranch}. Lakukan Absen Pulang saat selesai.`
                : 'Belum melakukan Absen Datang hari ini.'}
            </span>
          </div>
          <span
            className={`font-semibold px-2.5 py-1 rounded-md text-[11px] shrink-0 ${
              hasClockedOutToday
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : hasClockedInToday
                ? 'bg-blue-50 text-[#0B4EA2] border border-blue-200'
                : 'bg-slate-100 text-slate-600 border border-slate-200'
            }`}
          >
            {hasClockedOutToday
              ? 'Selesai'
              : hasClockedInToday
              ? 'Sudah Datang'
              : 'Belum Absen'}
          </span>
        </div>

        {/* Outlet & Shift Selection */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Outlet Lokasi Tugas
            </label>
            <select
              value={effectiveAttendanceBranch}
              disabled={hasClockedInToday && !hasClockedOutToday}
              onChange={(e) => setSelectedBranch(e.target.value as BranchName)}
              className="w-full h-9 px-2.5 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-600"
            >
              {BRANCH_OPTIONS.map((b) => {
                const cfg = outletLocations.find((o) => o.branch === b);
                return (
                  <option key={b} value={b}>
                    {b} {cfg?.configured ? `(Radius ${cfg.radiusMeters} m)` : '(Belum Diatur)'}
                  </option>
                );
              })}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Shift Kerja</label>
            <select
              value={selectedShiftKey}
              disabled={hasClockedInToday}
              onChange={(e) => setSelectedShiftKey(e.target.value)}
              className="w-full h-9 px-2.5 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-600"
            >
              {SHIFT_PRESETS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label} · {s.start}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Catatan Kehadiran (Opsional)
          </label>
          <input
            type="text"
            value={clockNote}
            onChange={(e) => setClockNote(e.target.value)}
            placeholder="Contoh: Penggantian shift / tugas outlet"
            className="w-full h-9 px-3 text-xs border border-slate-300 rounded-lg"
          />
        </div>

        {/* Step 1: Mandatory Device Location Activation */}
        <div className="p-3.5 rounded-xl border border-slate-200 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Navigation className="w-3.5 h-3.5 text-[#0B4EA2]" />
              <span>1. Wajib Aktifkan Lokasi GPS</span>
            </span>
            <button
              type="button"
              onClick={() => requestCurrentGps()}
              disabled={gpsLoading}
              className="h-8 px-3 text-xs font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] disabled:opacity-60 rounded-lg inline-flex items-center gap-1.5"
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>
                {gpsLoading
                  ? 'Mendeteksi...'
                  : isLocationActive
                  ? 'Perbarui Lokasi'
                  : 'Aktifkan Lokasi Saya'}
              </span>
            </button>
          </div>

          <p className="text-[11px] text-slate-500">
            Izin lokasi perangkat wajib aktif agar sistem dapat memastikan Anda berada di area outlet sebelum tombol Absen Datang &amp; Pulang dibuka.
          </p>

          {gpsError && (
            <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-700 font-medium">
              {gpsError}
            </div>
          )}

          {gpsCoords && (
            <div className="text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-slate-700">
                GPS: {gpsCoords.lat}, {gpsCoords.lng}
              </span>
              <span className="text-slate-500">
                Akurasi ±{gpsCoords.accuracyMeters} m · {gpsCoords.capturedAt} WITA
              </span>
            </div>
          )}

          {!activeOutlet.configured ? (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-start gap-2">
              <Lock className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
              <div>
                <p className="font-bold">
                  Titik Lokasi Outlet {effectiveAttendanceBranch} Belum Diatur
                </p>
                <p className="text-[11px] mt-0.5">
                  Manager HC harus menetapkan titik Google Maps untuk outlet{' '}
                  <strong>{effectiveAttendanceBranch}</strong> sebelum absen dapat digunakan.
                </p>
              </div>
            </div>
          ) : !isLocationActive ? (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-slate-800 flex items-start gap-2">
              <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-[#0B4EA2]" />
              <div>
                <p className="font-bold text-[#0B4EA2]">Lokasi Perangkat Belum Aktif</p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Tekan <strong>Aktifkan Lokasi Saya</strong> dan izinkan akses GPS browser untuk memvalidasi jarak (maksimal{' '}
                  <strong>{activeOutlet.radiusMeters} m</strong> dari {activeOutlet.addressLabel}).
                </p>
              </div>
            </div>
          ) : isWithinGeofence ? (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
              <div>
                <p className="font-bold">
                  Lokasi Terverifikasi di {effectiveAttendanceBranch} (Jarak {distanceMeters} m / Maks{' '}
                  {activeOutlet.radiusMeters} m)
                </p>
                <p className="text-[11px] mt-0.5">
                  Silakan tekan tombol Absen Datang atau Absen Pulang di bawah ini.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-red-700" />
              <div>
                <p className="font-bold">
                  Di Luar Lokasi Outlet (Jarak {distanceMeters} m &gt; Batas{' '}
                  {activeOutlet.radiusMeters} m)
                </p>
                <p className="text-[11px] mt-0.5">
                  Anda tidak dapat mengakses Absen Datang maupun Absen Pulang di luar titik outlet{' '}
                  <strong>{effectiveAttendanceBranch}</strong>.
                </p>
              </div>
            </div>
          )}
        </div>

        {clockMessage && (
          <div
            className={`p-3 rounded-lg border text-xs font-medium ${
              clockMessage.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {clockMessage.text}
          </div>
        )}

        {/* Step 2: Clock In / Clock Out Buttons (Strictly locked unless GPS active & within radius) */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            disabled={!canClockIn}
            onClick={() => void handleClockAction('clock_in')}
            className={`h-11 px-4 text-xs font-bold rounded-xl inline-flex items-center justify-center gap-2 transition-colors ${
              canClockIn
                ? 'bg-[#0B4EA2] hover:bg-[#093E82] text-white'
                : 'bg-slate-200 text-slate-500 cursor-not-allowed'
            }`}
          >
            {canClockIn ? <LogIn className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            <span>Absen Datang</span>
          </button>

          <button
            type="button"
            disabled={!canClockOut}
            onClick={() => void handleClockAction('clock_out')}
            className={`h-11 px-4 text-xs font-bold rounded-xl inline-flex items-center justify-center gap-2 transition-colors ${
              canClockOut
                ? 'bg-[#1B365D] hover:bg-[#142847] text-white'
                : 'bg-slate-200 text-slate-500 cursor-not-allowed'
            }`}
          >
            {canClockOut ? <LogOutIcon className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            <span>Absen Pulang</span>
          </button>
        </div>
      </div>

      {/* Right Google Map Card */}
      <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Peta Validasi Radius Outlet {effectiveAttendanceBranch}
            </h3>
            <p className="text-[11px] text-slate-500">
              Pin biru menandai titik outlet Manager HC; lingkaran biru adalah area sah absensi; pin hijau/merah adalah lokasi GPS Anda.
            </p>
          </div>
          {activeOutlet.configured && (
            <span className="text-[11px] font-mono font-semibold text-[#0B4EA2] bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-md">
              Radius {activeOutlet.radiusMeters} m
            </span>
          )}
        </div>

        {!mapsApiKey ? (
          <div className="h-[380px] rounded-xl border border-slate-200 bg-slate-50 flex flex-col items-center justify-center p-6 text-center text-xs text-slate-600 gap-2">
            <AlertTriangle className="w-6 h-6 text-amber-600" />
            <p className="font-semibold text-slate-800">
              Google Maps API Key belum tersedia di runtime server.
            </p>
            <p className="text-[11px] text-slate-500 max-w-md">
              Pastikan environment variable <code className="font-mono">VITE_GOOGLE_MAPS_API_KEY</code> aktif lalu restart server aplikasi.
            </p>
          </div>
        ) : (
          <div className="w-full h-[380px] rounded-xl overflow-hidden border border-slate-200">
            <APIProvider apiKey={mapsApiKey} language="id" region="ID">
              <GoogleMap
                mapId="DEMO_MAP_ID"
                defaultCenter={clockMapCenter}
                defaultZoom={activeOutlet.configured ? 17 : 13}
                gestureHandling="greedy"
                disableDefaultUI={false}
                internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                style={{ width: '100%', height: '380px' }}
              >
                <MapCameraController
                  center={clockMapCenter}
                  zoom={activeOutlet.configured ? 17 : 13}
                />

                {activeOutlet.configured &&
                  activeOutlet.lat !== null &&
                  activeOutlet.lng !== null && (
                    <>
                      <Circle
                        center={{ lat: activeOutlet.lat, lng: activeOutlet.lng }}
                        radius={activeOutlet.radiusMeters}
                        strokeColor="#0B4EA2"
                        strokeOpacity={0.9}
                        strokeWeight={2}
                        fillColor="#0B4EA2"
                        fillOpacity={0.14}
                      />
                      <AdvancedMarker
                        position={{ lat: activeOutlet.lat, lng: activeOutlet.lng }}
                        onClick={() => setOpenMarkerInfo('outlet')}
                      >
                        <Pin
                          background="#0B4EA2"
                          glyphColor="#FFFFFF"
                          borderColor="#1B365D"
                        />
                      </AdvancedMarker>
                      {openMarkerInfo === 'outlet' && (
                        <InfoWindow
                          position={{ lat: activeOutlet.lat, lng: activeOutlet.lng }}
                          onCloseClick={() => setOpenMarkerInfo(null)}
                        >
                          <div className="text-xs p-1">
                            <p className="font-bold text-[#0B4EA2]">
                              Outlet {activeOutlet.branch}
                            </p>
                            <p className="text-slate-600">{activeOutlet.addressLabel}</p>
                            <p className="font-mono text-[11px] mt-1">
                              Radius: {activeOutlet.radiusMeters} meter
                            </p>
                          </div>
                        </InfoWindow>
                      )}
                    </>
                  )}

                {gpsCoords && (
                  <>
                    <AdvancedMarker
                      position={{ lat: gpsCoords.lat, lng: gpsCoords.lng }}
                      onClick={() => setOpenMarkerInfo('user')}
                    >
                      <Pin
                        background={isWithinGeofence ? '#16A34A' : '#DC2626'}
                        glyphColor="#FFFFFF"
                        borderColor={isWithinGeofence ? '#14532D' : '#7F1D1D'}
                      />
                    </AdvancedMarker>
                    {openMarkerInfo === 'user' && (
                      <InfoWindow
                        position={{ lat: gpsCoords.lat, lng: gpsCoords.lng }}
                        onCloseClick={() => setOpenMarkerInfo(null)}
                      >
                        <div className="text-xs p-1">
                          <p className="font-bold text-slate-900">
                            Posisi GPS Anda ({currentUser.fullName})
                          </p>
                          <p className="font-mono text-[11px] text-slate-600">
                            {gpsCoords.lat}, {gpsCoords.lng}
                          </p>
                          {distanceMeters !== null && (
                            <p className="font-semibold mt-1">
                              Jarak ke outlet: {distanceMeters} m
                            </p>
                          )}
                        </div>
                      </InfoWindow>
                    )}
                  </>
                )}
              </GoogleMap>
            </APIProvider>
          </div>
        )}
      </div>
    </div>
  );
};
