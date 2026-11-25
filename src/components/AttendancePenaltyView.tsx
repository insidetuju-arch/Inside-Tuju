import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  AttendanceLateRule,
  AttendanceLogRecord,
  AttendanceUploadBatch,
  Employee,
  PayrollPeriod,
} from '../types/hc';
import {
  computePenaltyForMinutes,
  DEFAULT_ATTENDANCE_RULE,
  downloadAttendanceTemplateXlsx,
  parseAttendanceFile,
  recalculateAttendanceRecords,
} from '../utils/attendanceParser';
import {
  formatDateID,
  formatRupiah,
  recalculatePayrollEntry,
} from '../utils/calculations';
import { downloadCSV } from '../utils/pdfGenerator';

interface AttendancePenaltyViewProps {
  attendanceBatches: AttendanceUploadBatch[];
  employees: Employee[];
  payrollPeriods: PayrollPeriod[];
  canSyncPayroll?: boolean;
  onSaveAttendanceBatches: (next: AttendanceUploadBatch[]) => Promise<void>;
  onSavePayrollPeriods: (next: PayrollPeriod[]) => Promise<void>;
}

interface EmployeeAttendanceRecap {
  key: string;
  employeeId?: string;
  employeeName: string;
  branch: string;
  totalLogs: number;
  onTimeCount: number;
  lateCount: number;
  totalLateMinutes: number;
  izinCount: number;
  sakitCount: number;
  alphaCount: number;
  totalPenalty: number;
}

type SubTab = 'rekap' | 'detail';

export const AttendancePenaltyView: React.FC<AttendancePenaltyViewProps> = ({
  attendanceBatches,
  employees,
  payrollPeriods,
  canSyncPayroll = true,
  onSaveAttendanceBatches,
  onSavePayrollPeriods,
}) => {
  const [selectedBatchId, setSelectedBatchId] = useState<string>(
    attendanceBatches[0]?.id || ''
  );
  const [subTab, setSubTab] = useState<SubTab>('rekap');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [uploadPeriodLabel, setUploadPeriodLabel] = useState(
    payrollPeriods[0]?.label || 'Oktober 2026'
  );
  const [syncPayrollId, setSyncPayrollId] = useState(payrollPeriods[0]?.id || '');

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeBatch = useMemo(() => {
    return (
      attendanceBatches.find((b) => b.id === selectedBatchId) ||
      attendanceBatches[0] ||
      null
    );
  }, [attendanceBatches, selectedBatchId]);

  const activeRule: AttendanceLateRule = useMemo(
    () => ({
      ...DEFAULT_ATTENDANCE_RULE,
      ...(activeBatch?.rule || {}),
    }),
    [activeBatch]
  );

  const employeeRecapList = useMemo<EmployeeAttendanceRecap[]>(() => {
    if (!activeBatch) return [];
    const map = new Map<string, EmployeeAttendanceRecap>();

    for (const rec of activeBatch.records) {
      const key = rec.employeeId || rec.employeeName.trim().toLowerCase();
      let bucket = map.get(key);
      if (!bucket) {
        bucket = {
          key,
          employeeId: rec.employeeId,
          employeeName: rec.employeeName,
          branch: rec.branch || 'Holding',
          totalLogs: 0,
          onTimeCount: 0,
          lateCount: 0,
          totalLateMinutes: 0,
          izinCount: 0,
          sakitCount: 0,
          alphaCount: 0,
          totalPenalty: 0,
        };
        map.set(key, bucket);
      }

      bucket.totalLogs += 1;
      if (rec.status === 'Hadir') bucket.onTimeCount += 1;
      else if (rec.status === 'Terlambat') {
        bucket.lateCount += 1;
        bucket.totalLateMinutes += rec.lateMinutes || 0;
        bucket.totalPenalty += rec.penaltyAmount || 0;
      } else if (rec.status === 'Izin') bucket.izinCount += 1;
      else if (rec.status === 'Sakit') bucket.sakitCount += 1;
      else if (rec.status === 'Alpha') bucket.alphaCount += 1;
    }

    return Array.from(map.values()).sort(
      (a, b) => b.totalPenalty - a.totalPenalty || a.employeeName.localeCompare(b.employeeName)
    );
  }, [activeBatch]);

  const filteredRecaps = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employeeRecapList.filter((item) => {
      if (branchFilter !== 'ALL' && item.branch !== branchFilter) return false;
      if (!q) return true;
      return (
        item.employeeName.toLowerCase().includes(q) ||
        item.branch.toLowerCase().includes(q)
      );
    });
  }, [employeeRecapList, search, branchFilter]);

  const filteredLogs = useMemo(() => {
    if (!activeBatch) return [];
    const q = search.trim().toLowerCase();
    return activeBatch.records.filter((rec) => {
      if (branchFilter !== 'ALL' && rec.branch !== branchFilter) return false;
      if (statusFilter !== 'ALL' && rec.status !== statusFilter) return false;
      if (!q) return true;
      return (
        rec.employeeName.toLowerCase().includes(q) ||
        rec.branch.toLowerCase().includes(q) ||
        rec.date.toLowerCase().includes(q)
      );
    });
  }, [activeBatch, search, branchFilter, statusFilter]);

  const summaryStats = useMemo(() => {
    return employeeRecapList.reduce(
      (acc, r) => {
        acc.totalEmployees += 1;
        acc.totalPresent += r.onTimeCount + r.lateCount;
        acc.totalLateCount += r.lateCount;
        acc.totalLateMinutes += r.totalLateMinutes;
        acc.totalPenalty += r.totalPenalty;
        return acc;
      },
      {
        totalEmployees: 0,
        totalPresent: 0,
        totalLateCount: 0,
        totalLateMinutes: 0,
        totalPenalty: 0,
      }
    );
  }, [employeeRecapList]);

  const persistBatches = async (next: AttendanceUploadBatch[]) => {
    setSaving(true);
    try {
      await onSaveAttendanceBatches(next);
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    setFeedback(null);
    try {
      const records = await parseAttendanceFile(file, employees, activeRule);
      const newBatch: AttendanceUploadBatch = {
        id: `att-batch-${Date.now()}`,
        periodLabel: uploadPeriodLabel.trim() || 'Periode Baru',
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
        rule: { ...activeRule },
        records,
      };
      const next = [newBatch, ...attendanceBatches];
      await persistBatches(next);
      setSelectedBatchId(newBatch.id);
      setFeedback({
        type: 'success',
        message: `File "${file.name}" berhasil diunggah (${records.length} baris kehadiran terbaca dan denda dihitung otomatis).`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Gagal membaca file absensi. Periksa format kolom file.',
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRuleChange = (patch: Partial<AttendanceLateRule>) => {
    if (!activeBatch) return;
    const nextRule: AttendanceLateRule = {
      ...DEFAULT_ATTENDANCE_RULE,
      ...activeBatch.rule,
      ...patch,
    };
    const recalculated = recalculateAttendanceRecords(activeBatch.records, nextRule);
    const nextBatches = attendanceBatches.map((b) =>
      b.id === activeBatch.id ? { ...b, rule: nextRule, records: recalculated } : b
    );
    void persistBatches(nextBatches);
  };

  const handleRecordEdit = (
    recordId: string,
    patch: Partial<Pick<AttendanceLogRecord, 'checkIn' | 'status' | 'lateMinutes'>>
  ) => {
    if (!activeBatch) return;
    const updatedRecords = activeBatch.records.map((rec) => {
      if (rec.id !== recordId) return rec;
      const merged = { ...rec, ...patch };
      // If checkIn changed without explicit lateMinutes override, recalculate from checkIn
      if (patch.checkIn !== undefined && patch.lateMinutes === undefined) {
        return recalculateAttendanceRecords([merged], activeBatch.rule)[0];
      }
      if (patch.status === 'Izin' || patch.status === 'Sakit' || patch.status === 'Alpha') {
        return { ...merged, lateMinutes: 0, penaltyAmount: 0 };
      }
      if (patch.status === 'Hadir' && patch.lateMinutes === undefined) {
        return { ...merged, lateMinutes: 0, penaltyAmount: 0 };
      }
      const mergedRule: AttendanceLateRule = {
        ...DEFAULT_ATTENDANCE_RULE,
        ...activeBatch.rule,
      };
      const billable = Math.max(
        0,
        (merged.lateMinutes || 0) - Math.max(0, mergedRule.graceMinutes || 0)
      );
      const nextStatus: AttendanceLogRecord['status'] =
        billable > 0 ? 'Terlambat' : 'Hadir';
      const penalty = computePenaltyForMinutes(merged.lateMinutes || 0, nextStatus, mergedRule);
      return {
        ...merged,
        status: nextStatus,
        penaltyAmount: penalty,
      };
    });

    const nextBatches = attendanceBatches.map((b) =>
      b.id === activeBatch.id ? { ...b, records: updatedRecords } : b
    );
    void persistBatches(nextBatches);
  };

  const handleDeleteBatch = (batchId: string) => {
    const next = attendanceBatches.filter((b) => b.id !== batchId);
    if (selectedBatchId === batchId) {
      setSelectedBatchId(next[0]?.id || '');
    }
    void persistBatches(next);
  };

  const handleSyncToPayroll = async () => {
    if (!activeBatch) return;
    const targetPeriod =
      payrollPeriods.find((p) => p.id === syncPayrollId) || payrollPeriods[0];
    if (!targetPeriod) {
      setFeedback({
        type: 'error',
        message: 'Belum ada periode payroll yang tersedia untuk disinkronkan.',
      });
      return;
    }

    let updatedCount = 0;
    const nextEntries = targetPeriod.entries.map((entry) => {
      const matched = employeeRecapList.find(
        (r) =>
          (r.employeeId && r.employeeId === entry.employeeId) ||
          r.employeeName.trim().toLowerCase() === entry.name.trim().toLowerCase()
      );
      if (!matched) return entry;
      updatedCount += 1;
      return recalculatePayrollEntry(
        { ...entry, potonganKeterlambatan: matched.totalPenalty },
        targetPeriod.gajiHarianStandar,
        targetPeriod.uangTrainingPerHari
      );
    });

    const nextPeriods = payrollPeriods.map((p) =>
      p.id === targetPeriod.id ? { ...p, entries: nextEntries } : p
    );
    setSaving(true);
    try {
      await onSavePayrollPeriods(nextPeriods);
      setFeedback({
        type: 'success',
        message: `Denda keterlambatan untuk ${updatedCount} kru berhasil disinkronkan ke Payroll periode "${targetPeriod.label}".`,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleExportRecapCSV = () => {
    if (!activeBatch) return;
    const headers = [
      'No',
      'Nama Kru',
      'Cabang',
      'Total Log',
      'Hadir Tepat Waktu',
      'Terlambat (Kali)',
      'Total Menit Terlambat',
      'Izin',
      'Sakit',
      'Alpha',
      'Total Denda Keterlambatan (Rp)',
    ];
    const rows = filteredRecaps.map((r, idx) => [
      idx + 1,
      r.employeeName,
      r.branch,
      r.totalLogs,
      r.onTimeCount,
      r.lateCount,
      r.totalLateMinutes,
      r.izinCount,
      r.sakitCount,
      r.alphaCount,
      r.totalPenalty,
    ]);
    downloadCSV(
      `Rekap_Denda_Kehadiran_${activeBatch.periodLabel.replace(/[^a-zA-Z0-9]+/g, '_')}.csv`,
      headers,
      rows
    );
  };

  const handleDownloadSampleCSV = () => {
    const headers = [
      'No.',
      'ID Karyawan',
      'Nama Karyawan',
      'Cabang Masuk',
      'Tanggal Masuk',
      'Jam Masuk',
      'Cabang Pulang',
      'Tanggal Pulang',
      'Jam Pulang',
      'Jam Kerja',
    ];
    const sampleRows = [
      [1, 'crewdinda', 'Dinda', 'Toko Kopi Tuju Andi Jemma', '26-10-2026', '05:56 WITA', 'Toko Kopi Tuju Andi Jemma', '26-10-2026', '15:53 WITA', '9 Jam 56 Menit'],
      [2, 'crewanas', 'Anas', 'Toko Kopi Tuju Tamalate', '26-10-2026', '05:44 WITA', 'Toko Kopi Tuju Tamalate', '26-10-2026', '15:30 WITA', '9 Jam 46 Menit'],
      [3, 'crewaziz', 'Aziz', 'Toko Kopi Tuju Abdesir', '26-10-2026', '06:14 WITA', 'Toko Kopi Tuju Abdesir', '26-10-2026', '16:01 WITA', '9 Jam 47 Menit'],
      [4, 'crewaffan', 'Affan', 'Toko Kopi Tuju Abdesir', '26-10-2026', '06:10 WITA', 'Toko Kopi Tuju Abdesir', '26-10-2026', '16:10 WITA', '10 Jam 0 Menit'],
      [5, 'crewqayyum', 'Qayyum', 'Toko Kopi Tuju Abdesir', '26-10-2026', '14:04 WITA', 'Toko Kopi Tuju Abdesir', '26-10-2026', '23:54 WITA', '9 Jam 50 Menit'],
      [6, 'crewregina', 'Regina', 'Toko Kopi Tuju Andi Jemma', '26-10-2026', '14:15 WITA', 'Toko Kopi Tuju Andi Jemma', '26-10-2026', '23:53 WITA', '9 Jam 38 Menit'],
    ];
    downloadCSV('Template_Daftar_Kehadiran_Kopi_Tuju.csv', headers, sampleRows);
  };

  const branches = useMemo(() => {
    const set = new Set<string>(['Holding', 'Abdesir', 'Agus Salim', 'Djemma', 'Perintis', 'Tamalate']);
    activeBatch?.records.forEach((r) => {
      if (r.branch) set.add(r.branch);
    });
    return Array.from(set);
  }, [activeBatch]);

  return (
    <div className="space-y-6">
      {/* Upload Card & Batch Selector */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#0B4EA2]" />
              <span>Upload File Absensi &amp; Rekap Denda Keterlambatan</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Unggah file ekspor mesin absensi / rekap Excel (.xlsx, .csv, .tsv) untuk menghitung
              rekap kehadiran dan total denda keterlambatan secara otomatis.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {saving && <span className="text-xs text-slate-500 mr-1">Menyimpan...</span>}
            <button
              type="button"
              onClick={handleDownloadSampleCSV}
              className="h-9 px-3 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Template CSV</span>
            </button>
            <button
              type="button"
              onClick={() => void downloadAttendanceTemplateXlsx(employees)}
              className="h-9 px-3 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
              <span>Template Excel (.xlsx)</span>
            </button>
          </div>
        </div>

        {/* Drag & Drop Upload Box */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) void handleFileUpload(dropped);
          }}
          className={`border-2 border-dashed rounded-xl p-5 transition-colors flex flex-col md:flex-row items-center justify-between gap-4 ${
            dragOver
              ? 'border-[#0B4EA2] bg-blue-50/70'
              : 'border-slate-300 bg-[#F4F7FB]'
          }`}
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-[#0B4EA2]/10 text-[#0B4EA2] flex items-center justify-center shrink-0">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900">
                Seret &amp; lepas file absensi di sini, atau klik pilih file
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Mendukung format <span className="font-mono">.xlsx</span> &amp;{' '}
                <span className="font-mono">.csv</span> Daftar Kehadiran Toko Kopi Tuju (
                <span className="font-mono">
                  No., ID Karyawan, Nama Karyawan, Cabang Masuk, Tanggal Masuk, Jam Masuk, Cabang
                  Pulang, Tanggal Pulang, Jam Pulang, Jam Kerja
                </span>
                ).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <input
              type="text"
              value={uploadPeriodLabel}
              onChange={(e) => setUploadPeriodLabel(e.target.value)}
              placeholder="Label Periode (mis. Nov 2026)"
              className="h-9 px-3 text-xs font-semibold text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded-lg w-40"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.tsv,.txt"
              className="hidden"
              onChange={(e) => {
                const selected = e.target.files?.[0];
                if (selected) void handleFileUpload(selected);
              }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="h-9 px-4 text-xs font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] disabled:opacity-60 rounded-lg inline-flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{uploading ? 'Memproses File...' : 'Upload File Absensi'}</span>
            </button>
          </div>
        </div>

        {feedback && (
          <div
            className={`px-4 py-2.5 rounded-lg border text-xs flex items-center gap-2 ${
              feedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-700 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
        )}

        {/* Uploaded Batches Selector + Aturan Denda */}
        {activeBatch && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-2 border-t border-slate-100 items-end">
            <div className="lg:col-span-4">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                File / Periode Rekap Aktif
              </label>
              <div className="flex items-center gap-1.5">
                <select
                  value={activeBatch.id}
                  onChange={(e) => setSelectedBatchId(e.target.value)}
                  className="flex-1 h-9 px-3 text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg"
                >
                  {attendanceBatches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.periodLabel} — {b.fileName} ({b.records.length} log)
                    </option>
                  ))}
                </select>
                {attendanceBatches.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleDeleteBatch(activeBatch.id)}
                    title="Hapus file rekap ini"
                    className="h-9 px-2.5 text-slate-400 hover:text-rose-700 hover:bg-rose-50 border border-slate-300 rounded-lg"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="lg:col-span-3">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Metode Hitung Denda Keterlambatan
              </label>
              <select
                value={activeRule.mode}
                onChange={(e) =>
                  handleRuleChange({
                    mode: e.target.value as AttendanceLateRule['mode'],
                  })
                }
                className="w-full h-9 px-3 text-xs font-semibold text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded-lg"
              >
                <option value="tiered_hourly">
                  Bertingkat (0–29m / 30–59m / ≥60m per jam)
                </option>
                <option value="per_occurrence">Per Kejadian Terlambat</option>
                <option value="per_minute">Per Menit Terlambat</option>
                <option value="per_block">Per Blok Kelipatan Menit</option>
              </select>
            </div>

            <div className="lg:col-span-2">
              {activeRule.mode === 'tiered_hourly' ? (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Denda 0–29m / ≥30m (Rp)
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="number"
                      min={0}
                      step={100}
                      title="Denda 0-29 menit"
                      value={activeRule.tier1Penalty ?? 2700}
                      onChange={(e) =>
                        handleRuleChange({
                          tier1Penalty: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      className="w-full h-9 px-2 text-xs font-mono font-bold text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded-lg"
                    />
                    <input
                      type="number"
                      min={0}
                      step={100}
                      title="Denda 30-59 menit & kelipatan per jam >=60 menit"
                      value={activeRule.hourlyPenalty ?? 5400}
                      onChange={(e) => {
                        const v = Math.max(0, Number(e.target.value) || 0);
                        handleRuleChange({ tier2Penalty: v, hourlyPenalty: v });
                      }}
                      className="w-full h-9 px-2 text-xs font-mono font-bold text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {activeRule.mode === 'per_occurrence'
                      ? 'Denda / Kejadian (Rp)'
                      : activeRule.mode === 'per_minute'
                      ? 'Denda / Menit (Rp)'
                      : `Denda / ${activeRule.blockMinutes} Menit (Rp)`}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={
                      activeRule.mode === 'per_occurrence'
                        ? activeRule.penaltyPerOccurrence
                        : activeRule.mode === 'per_minute'
                        ? activeRule.penaltyPerMinute
                        : activeRule.penaltyPerBlock
                    }
                    onChange={(e) => {
                      const v = Math.max(0, Number(e.target.value) || 0);
                      if (activeRule.mode === 'per_occurrence') {
                        handleRuleChange({ penaltyPerOccurrence: v });
                      } else if (activeRule.mode === 'per_minute') {
                        handleRuleChange({ penaltyPerMinute: v });
                      } else {
                        handleRuleChange({ penaltyPerBlock: v });
                      }
                    }}
                    className="w-full h-9 px-3 text-xs font-mono font-bold text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded-lg"
                  />
                </div>
              )}
            </div>

            <div className="lg:col-span-3 grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Toleransi Tambahan (Mnt)
                </label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={activeRule.graceMinutes}
                  onChange={(e) =>
                    handleRuleChange({
                      graceMinutes: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="w-full h-9 px-2.5 text-xs font-mono font-bold text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Pola Jam Shift
                </label>
                <select
                  value={activeRule.shiftMode || 'three_shifts'}
                  onChange={(e) =>
                    handleRuleChange({
                      shiftMode: e.target.value as
                        | 'three_shifts'
                        | 'two_shifts'
                        | 'single_shift',
                    })
                  }
                  className="w-full h-9 px-2 text-xs font-semibold text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded-lg"
                >
                  <option value="three_shifts">3 Shift (06:05/11:05/15:05)</option>
                  <option value="two_shifts">2 Shift (Pagi/Siang)</option>
                  <option value="single_shift">1 Shift Standar</option>
                </select>
              </div>
            </div>

            <div className="lg:col-span-12 flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100 text-xs">
              <div className="flex flex-wrap items-center gap-4">
                {(activeRule.shiftMode || 'three_shifts') === 'three_shifts' ? (
                  <>
                    <label className="inline-flex items-center gap-2 text-slate-700 font-medium">
                      <span>Shift 1:</span>
                      <input
                        type="time"
                        value={activeRule.shift1Start || '06:05'}
                        onChange={(e) =>
                          handleRuleChange({ shift1Start: e.target.value || '06:05' })
                        }
                        className="h-8 px-2 font-mono font-bold text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                      />
                    </label>
                    <label className="inline-flex items-center gap-2 text-slate-700 font-medium">
                      <span>Shift 2:</span>
                      <input
                        type="time"
                        value={activeRule.shift2Start || '11:05'}
                        onChange={(e) =>
                          handleRuleChange({ shift2Start: e.target.value || '11:05' })
                        }
                        className="h-8 px-2 font-mono font-bold text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                      />
                    </label>
                    <label className="inline-flex items-center gap-2 text-slate-700 font-medium">
                      <span>Shift 3:</span>
                      <input
                        type="time"
                        value={activeRule.shift3Start || '15:05'}
                        onChange={(e) =>
                          handleRuleChange({ shift3Start: e.target.value || '15:05' })
                        }
                        className="h-8 px-2 font-mono font-bold text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                      />
                    </label>
                  </>
                ) : activeRule.shiftMode === 'two_shifts' ? (
                  <>
                    <label className="inline-flex items-center gap-2 text-slate-700 font-medium">
                      <span>Jadwal Shift Pagi (&lt; 11:00):</span>
                      <input
                        type="time"
                        value={activeRule.shiftMorningStart || '06:05'}
                        onChange={(e) =>
                          handleRuleChange({ shiftMorningStart: e.target.value || '06:05' })
                        }
                        className="h-8 px-2 font-mono font-bold text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                      />
                    </label>
                    <label className="inline-flex items-center gap-2 text-slate-700 font-medium">
                      <span>Jadwal Shift Siang (&ge; 11:00):</span>
                      <input
                        type="time"
                        value={activeRule.shiftAfternoonStart || '15:05'}
                        onChange={(e) =>
                          handleRuleChange({ shiftAfternoonStart: e.target.value || '15:05' })
                        }
                        className="h-8 px-2 font-mono font-bold text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                      />
                    </label>
                  </>
                ) : (
                  <label className="inline-flex items-center gap-2 text-slate-700 font-medium">
                    <span>Jam Masuk Standar:</span>
                    <input
                      type="time"
                      value={activeRule.defaultShiftStart || '06:05'}
                      onChange={(e) =>
                        handleRuleChange({ defaultShiftStart: e.target.value || '06:05' })
                      }
                      className="h-8 px-2 font-mono font-bold text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                    />
                  </label>
                )}

                <label className="inline-flex items-center gap-2 text-slate-700 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activeRule.convertWibToWita ?? true}
                    onChange={(e) =>
                      handleRuleChange({ convertWibToWita: e.target.checked })
                    }
                    className="rounded border-slate-300 text-[#0B4EA2] focus:ring-[#0B4EA2]"
                  />
                  <span>Konversi WIB &rarr; WITA (+1 jam)</span>
                </label>
              </div>

              {activeRule.mode === 'tiered_hourly' && (
                <div className="text-[11px] font-medium text-[#0B4EA2] bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-lg">
                  Aturan aktif: 0–29 menit ={' '}
                  <strong>{formatRupiah(activeRule.tier1Penalty ?? 2700)}</strong> · 30–59 menit ={' '}
                  <strong>{formatRupiah(activeRule.tier2Penalty ?? 5400)}</strong> · &ge;60 menit ={' '}
                  <strong>kelipatan {formatRupiah(activeRule.hourlyPenalty ?? 5400)}/jam</strong>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 4 Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Total Kru Terdata</p>
          <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {summaryStats.totalEmployees}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {activeBatch ? activeBatch.periodLabel : 'Belum ada file'}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Total Kehadiran Tercatat</p>
          <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-700">
            {summaryStats.totalPresent}
          </p>
          <p className="mt-1 text-xs text-slate-500">Shift hadir &amp; terlambat</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Kejadian Keterlambatan</p>
          <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-amber-700">
            {summaryStats.totalLateCount}{' '}
            <span className="text-sm font-normal text-slate-500">
              ({summaryStats.totalLateMinutes} menit)
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500">Otomatis dari selisih jam masuk</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Total Denda Keterlambatan</p>
          <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-rose-700">
            {formatRupiah(summaryStats.totalPenalty)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Siap potong otomatis di Payroll</p>
        </div>
      </div>

      {/* Sub-tabs & Filter Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex bg-slate-200/70 p-1 rounded-xl gap-1">
          {[
            { id: 'rekap' as const, label: '1. Rekap Kehadiran & Denda Per Kru' },
            { id: 'detail' as const, label: '2. Detail Log Absensi Hasil Upload' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors ${
                subTab === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama kru atau cabang..."
              className="h-9 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-lg w-52"
            />
          </div>
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="h-9 px-3 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
          >
            <option value="ALL">Semua Cabang</option>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          {subTab === 'detail' && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 px-3 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
            >
              <option value="ALL">Semua Status</option>
              <option value="Hadir">Hadir</option>
              <option value="Terlambat">Terlambat</option>
              <option value="Izin">Izin</option>
              <option value="Sakit">Sakit</option>
              <option value="Alpha">Alpha</option>
            </select>
          )}
        </div>
      </div>

      {/* TAB 1: REKAP KEHADIRAN & DENDA PER KRU */}
      {subTab === 'rekap' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Rekap Kehadiran &amp; Denda Keterlambatan —{' '}
                {activeBatch ? activeBatch.periodLabel : '—'}
              </h3>
              <p className="text-xs text-slate-500">
                Akumulasi kehadiran, keterlambatan, dan nominal denda otomatis per karyawan.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canSyncPayroll && payrollPeriods.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <select
                    value={syncPayrollId}
                    onChange={(e) => setSyncPayrollId(e.target.value)}
                    className="h-9 px-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
                  >
                    {payrollPeriods.map((p) => (
                      <option key={p.id} value={p.id}>
                        Payroll: {p.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleSyncToPayroll()}
                    className="h-9 px-3.5 text-xs font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] rounded-lg inline-flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Terapkan ke Payroll</span>
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={handleExportRecapCSV}
                className="h-9 px-3.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                <span>Ekspor Rekap CSV</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#1B365D] text-white">
                  <th className="px-3 py-2.5 font-semibold w-10 text-center">No</th>
                  <th className="px-3 py-2.5 font-semibold">Nama Kru</th>
                  <th className="px-3 py-2.5 font-semibold">Cabang</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Hadir Tepat Waktu</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Terlambat (Kali)</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Total Menit Telat</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Izin</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Sakit</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Alpha</th>
                  <th className="px-3 py-2.5 font-semibold text-right">
                    Total Denda Keterlambatan
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredRecaps.map((r, idx) => (
                  <tr key={r.key} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 text-center font-mono text-slate-500">
                      {idx + 1}
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-slate-900">
                      {r.employeeName}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{r.branch}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-emerald-700 font-semibold">
                      {r.onTimeCount}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-amber-700 font-semibold">
                      {r.lateCount}x
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                      {r.totalLateMinutes} mnt
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600">
                      {r.izinCount}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600">
                      {r.sakitCount}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-rose-700">
                      {r.alphaCount}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums font-bold text-rose-700">
                      {formatRupiah(r.totalPenalty)}
                    </td>
                  </tr>
                ))}
                {filteredRecaps.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-slate-500">
                      Tidak ada data kehadiran yang sesuai. Silakan unggah file absensi di atas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: DETAIL LOG ABSENSI HASIL UPLOAD */}
      {subTab === 'detail' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="text-sm font-bold text-slate-900">
              Detail Log Harian Absensi — {activeBatch ? activeBatch.fileName : '—'}
            </h3>
            <p className="text-xs text-slate-500">
              Jam masuk, status, atau menit keterlambatan pada sel biru muda dapat disesuaikan dan
              denda akan otomatis dihitung ulang.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#1B365D] text-white">
                  <th className="px-3 py-2.5 font-semibold">Tanggal Masuk</th>
                  <th className="px-3 py-2.5 font-semibold">ID Karyawan</th>
                  <th className="px-3 py-2.5 font-semibold">Nama Karyawan</th>
                  <th className="px-3 py-2.5 font-semibold">Cabang Masuk</th>
                  <th className="px-3 py-2.5 font-semibold text-center">Jadwal Shift</th>
                  <th className="px-3 py-2.5 font-semibold text-center">Jam Masuk</th>
                  <th className="px-3 py-2.5 font-semibold text-center">Jam Pulang</th>
                  <th className="px-3 py-2.5 font-semibold">Jam Kerja</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Telat (Menit)</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Denda Keterlambatan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredLogs.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-slate-700 whitespace-nowrap">
                      {formatDateID(rec.date)}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-500">
                      {rec.employeeCode || '—'}
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-900">
                      {rec.employeeName}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{rec.branch}</td>
                    <td className="px-3 py-2 text-center font-mono text-slate-600">
                      {rec.shiftStart || activeRule.defaultShiftStart}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="text"
                        value={rec.checkIn}
                        placeholder="06:00 WITA"
                        onChange={(e) =>
                          handleRecordEdit(rec.id, { checkIn: e.target.value })
                        }
                        className="w-24 h-7 text-center font-mono text-xs font-semibold text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                      />
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-slate-600 whitespace-nowrap">
                      {rec.checkOut || '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                      {rec.workDuration || '—'}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={rec.status}
                        onChange={(e) =>
                          handleRecordEdit(rec.id, {
                            status: e.target.value as AttendanceLogRecord['status'],
                          })
                        }
                        className={`h-7 px-2 text-xs font-semibold border border-slate-300 rounded bg-[#EFF6FF] ${
                          rec.status === 'Hadir'
                            ? 'text-emerald-700'
                            : rec.status === 'Terlambat'
                            ? 'text-amber-700'
                            : rec.status === 'Alpha'
                            ? 'text-rose-700'
                            : 'text-slate-700'
                        }`}
                      >
                        <option value="Hadir">Hadir</option>
                        <option value="Terlambat">Terlambat</option>
                        <option value="Izin">Izin</option>
                        <option value="Sakit">Sakit</option>
                        <option value="Alpha">Alpha</option>
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        value={rec.lateMinutes}
                        onChange={(e) =>
                          handleRecordEdit(rec.id, {
                            lateMinutes: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        className="w-16 h-7 text-right px-1.5 font-mono font-bold text-xs text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                      />
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums font-bold text-rose-700">
                      {formatRupiah(rec.penaltyAmount)}
                    </td>
                  </tr>
                ))}
                {filteredLogs.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-4 py-10 text-center text-slate-500">
                      Tidak ada baris log absensi yang sesuai.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
