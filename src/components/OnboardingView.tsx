import React, { useMemo, useState } from 'react';
import {
  Award,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Plus,
  Printer,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import {
  AspectKey,
  AttendanceCode,
  BranchName,
  Employee,
  EvaluationIndicator,
  TraineeRecord,
  TrainingBatch,
} from '../types/hc';
import {
  addDaysISO,
  ASPECT_KEYS,
  ASPECT_LABELS,
  calculateAttendancePercent,
  evaluateBatchTrainees,
  formatDateID,
  SCORE_SCALE_DESC,
} from '../utils/calculations';
import { downloadCSV, downloadRaporPDF } from '../utils/pdfGenerator';

interface OnboardingViewProps {
  batches: TrainingBatch[];
  indicators: EvaluationIndicator[];
  employees: Employee[];
  initialTraineeEmployeeId?: string | null;
  onSaveOnboarding: (batches: TrainingBatch[], indicators: EvaluationIndicator[]) => Promise<void>;
}

type OnboardingTab =
  | 'ringkasan'
  | 'peserta'
  | 'jadwal'
  | 'kehadiran'
  | 'standar'
  | 'skor'
  | 'hasil'
  | 'rapor'
  | 'pengaturan';

const TAB_ITEMS: Array<{ id: OnboardingTab; label: string }> = [
  { id: 'ringkasan', label: 'Ringkasan' },
  { id: 'peserta', label: '1. Daftar Peserta' },
  { id: 'jadwal', label: '2. Jadwal' },
  { id: 'kehadiran', label: '3. Kehadiran' },
  { id: 'standar', label: '4. Standar Indikator' },
  { id: 'skor', label: '5. Input Skor' },
  { id: 'hasil', label: '6. Hasil Penilaian' },
  { id: 'rapor', label: '7. Rapor Individu' },
  { id: 'pengaturan', label: '8. Pengaturan' },
];

const BRANCH_LIST: BranchName[] = [
  'Abdesir',
  'Agus Salim',
  'Djemma',
  'Holding',
  'Perintis',
  'Tamalate',
];

const NEXT_ATTENDANCE: Record<AttendanceCode, AttendanceCode> = {
  '': 'H',
  H: 'I',
  I: 'S',
  S: 'A',
  A: '',
};

const CERT_OPTIONS = [
  'Espresso Calibration',
  'Milk Texturing & Latte Art',
  'Manual Brew V60',
  'Food Safety & Hygiene',
  'POS & Kasir SOP',
  'Hospitality Excellence',
];

const TRAINER_OPTIONS = [
  'Satrio',
  'Baso',
  'Rofifah',
  'Affan',
  'Anin',
  'Regina',
];

export const OnboardingView: React.FC<OnboardingViewProps> = ({
  batches,
  indicators,
  employees,
  initialTraineeEmployeeId,
  onSaveOnboarding,
}) => {
  const [activeBatchId, setActiveBatchId] = useState<string>(batches[0]?.id || '');
  const [activeTab, setActiveTab] = useState<OnboardingTab>(
    initialTraineeEmployeeId ? 'rapor' : 'ringkasan'
  );
  const [saving, setSaving] = useState(false);

  const activeBatch = useMemo(
    () => batches.find((b) => b.id === activeBatchId) || batches[0],
    [batches, activeBatchId]
  );

  const [selectedRaporId, setSelectedRaporId] = useState<string>(() => {
    if (initialTraineeEmployeeId && activeBatch) {
      const matched = activeBatch.trainees.find(
        (t) => t.employeeId === initialTraineeEmployeeId
      );
      if (matched) return matched.id;
    }
    return activeBatch?.trainees[0]?.id || '';
  });

  // Add Trainee modal state
  const [addTraineeOpen, setAddTraineeOpen] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState<string>('');
  const [manualName, setManualName] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [manualBranch, setManualBranch] = useState<BranchName>('Abdesir');
  const [manualStartDate, setManualStartDate] = useState(
    activeBatch?.startDate || new Date().toISOString().slice(0, 10)
  );

  // New Batch modal state
  const [newBatchOpen, setNewBatchOpen] = useState(false);
  const [newBatchName, setNewBatchName] = useState('');
  const [newBatchStart, setNewBatchStart] = useState(new Date().toISOString().slice(0, 10));
  const [newBatchTrainer, setNewBatchTrainer] = useState('Rofifah');

  // Input Skor view mode: matrix (with clear indicator headers) or per-trainee form
  const [scoreViewMode, setScoreViewMode] = useState<'matrix' | 'per_trainee'>('matrix');
  const [scoreTraineeId, setScoreTraineeId] = useState<string>(
    activeBatch?.trainees[0]?.id || ''
  );

  const summaries = useMemo(() => {
    if (!activeBatch) return {};
    return evaluateBatchTrainees(activeBatch.trainees, indicators, activeBatch.settings);
  }, [activeBatch, indicators]);

  const dashboardStats = useMemo(() => {
    if (!activeBatch) {
      return {
        total: 0,
        complete: 0,
        passed: 0,
        avgFinal: 0,
        avgAttendance: 0,
        highest: 0,
        lowest: 0,
        bestName: '—',
        categoryCounts: {
          'Sangat Baik': 0,
          Baik: 0,
          Cukup: 0,
          'Perlu Pembinaan': 0,
          'Belum Lengkap': 0,
        } as Record<string, number>,
        aspectAverages: {} as Record<AspectKey, number>,
      };
    }

    const list = activeBatch.trainees.map((t) => ({
      trainee: t,
      summary: summaries[t.id],
    }));

    const completed = list.filter((x) => x.summary?.isComplete && x.summary.finalScore !== null);
    const passed = list.filter((x) => x.summary?.decision === 'Lulus').length;

    const avgFinal =
      completed.length > 0
        ? Math.round(
            (completed.reduce((acc, x) => acc + (x.summary.finalScore || 0), 0) /
              completed.length) *
              10
          ) / 10
        : 0;

    const avgAttendance =
      list.length > 0
        ? Math.round(
            list.reduce((acc, x) => acc + (x.summary?.attendancePercent || 0), 0) / list.length
          )
        : 0;

    const sortedCompleted = [...completed].sort(
      (a, b) => (b.summary.finalScore || 0) - (a.summary.finalScore || 0)
    );
    const highest = sortedCompleted[0]?.summary.finalScore || 0;
    const lowest = sortedCompleted[sortedCompleted.length - 1]?.summary.finalScore || 0;
    const bestName = sortedCompleted[0]?.trainee.name || '—';

    const categoryCounts: Record<string, number> = {
      'Sangat Baik': 0,
      Baik: 0,
      Cukup: 0,
      'Perlu Pembinaan': 0,
      'Belum Lengkap': 0,
    };
    list.forEach((x) => {
      const cat = x.summary?.category || 'Belum Lengkap';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });

    const aspectAverages = {} as Record<AspectKey, number>;
    ASPECT_KEYS.forEach((key) => {
      const vals = list
        .map((x) => x.summary?.aspectScores[key])
        .filter((v): v is number => v !== null && v !== undefined);
      aspectAverages[key] =
        vals.length > 0
          ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
          : 0;
    });

    return {
      total: list.length,
      complete: completed.length,
      passed,
      avgFinal,
      avgAttendance,
      highest,
      lowest,
      bestName,
      categoryCounts,
      aspectAverages,
    };
  }, [activeBatch, summaries]);

  const updateBatch = async (updater: (b: TrainingBatch) => TrainingBatch) => {
    if (!activeBatch) return;
    setSaving(true);
    try {
      const nextBatches = batches.map((b) => (b.id === activeBatch.id ? updater(b) : b));
      await onSaveOnboarding(nextBatches, indicators);
    } finally {
      setSaving(false);
    }
  };

  const handleBatchMetaChange = (
    field: 'name' | 'startDate' | 'trainer',
    value: string
  ) => {
    void updateBatch((b) => ({ ...b, [field]: value }));
  };

  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBatchName.trim() || !activeBatch) return;
    const id = `batch-${Date.now()}`;
    const created: TrainingBatch = {
      id,
      name: newBatchName.trim(),
      startDate: newBatchStart,
      trainer: newBatchTrainer.trim() || 'Rofifah',
      schedule: activeBatch.schedule.map((s) => ({
        ...s,
        status: 'Terjadwal',
        notes: '',
      })),
      trainees: [],
      settings: structuredClone(activeBatch.settings),
    };
    setSaving(true);
    try {
      await onSaveOnboarding([created, ...batches], indicators);
      setActiveBatchId(id);
      setNewBatchOpen(false);
      setNewBatchName('');
      setActiveTab('peserta');
    } finally {
      setSaving(false);
    }
  };

  const handleAddTrainee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBatch) return;
    if (activeBatch.trainees.length >= 25) return;

    const linkedEmp = employees.find((emp) => emp.id === selectedEmpId);
    const name = linkedEmp ? linkedEmp.name : manualName.trim();
    if (!name) return;

    const startDate = linkedEmp?.startDate || manualStartDate || activeBatch.startDate;
    const newTrainee: TraineeRecord = {
      id: `tr-${Date.now()}`,
      employeeId: linkedEmp?.id,
      name,
      email: linkedEmp?.email || manualEmail.trim(),
      branch: linkedEmp?.branch || manualBranch,
      startDate,
      completionDate: linkedEmp?.trainingCompletedDate || addDaysISO(startDate, 13),
      certifications: linkedEmp?.certifications ? [...linkedEmp.certifications] : [],
      attendance: Array.from({ length: 14 }, () => ''),
      scores: Object.fromEntries(indicators.map((ind) => [ind.code, null])),
      trainerNotes: '',
    };

    await updateBatch((b) => ({
      ...b,
      trainees: [...b.trainees, newTrainee],
    }));
    setSelectedRaporId(newTrainee.id);
    setAddTraineeOpen(false);
    setSelectedEmpId('');
    setManualName('');
    setManualEmail('');
  };

  const handleUpdateTrainee = (
    traineeId: string,
    patch: Partial<TraineeRecord>
  ) => {
    void updateBatch((b) => ({
      ...b,
      trainees: b.trainees.map((t) => (t.id === traineeId ? { ...t, ...patch } : t)),
    }));
  };

  const handleRemoveTrainee = (traineeId: string) => {
    void updateBatch((b) => ({
      ...b,
      trainees: b.trainees.filter((t) => t.id !== traineeId),
    }));
  };

  const handleToggleCert = (trainee: TraineeRecord, cert: string) => {
    const exists = trainee.certifications.includes(cert);
    const nextCerts = exists
      ? trainee.certifications.filter((c) => c !== cert)
      : [...trainee.certifications, cert];
    handleUpdateTrainee(trainee.id, { certifications: nextCerts });
  };

  const handleCycleAttendance = (traineeId: string, dayIdx: number) => {
    void updateBatch((b) => ({
      ...b,
      trainees: b.trainees.map((t) => {
        if (t.id !== traineeId) return t;
        const nextAtt = [...t.attendance];
        const cur = nextAtt[dayIdx] || '';
        nextAtt[dayIdx] = NEXT_ATTENDANCE[cur];
        return { ...t, attendance: nextAtt };
      }),
    }));
  };

  const handleScoreChange = (traineeId: string, code: string, raw: string) => {
    const trimmed = raw.trim();
    let val: number | null = null;
    if (trimmed !== '') {
      const parsed = Number(trimmed);
      if (Number.isNaN(parsed)) return;
      val = Math.min(5, Math.max(1, Math.round(parsed)));
    }
    void updateBatch((b) => ({
      ...b,
      trainees: b.trainees.map((t) =>
        t.id === traineeId ? { ...t, scores: { ...t.scores, [code]: val } } : t
      ),
    }));
  };

  const handleUpdateSchedule = (
    dayNum: number,
    patch: Partial<{ topic: string; trainer: string; status: 'Terjadwal' | 'Berjalan' | 'Selesai'; notes: string }>
  ) => {
    void updateBatch((b) => ({
      ...b,
      schedule: b.schedule.map((s) => (s.day === dayNum ? { ...s, ...patch } : s)),
    }));
  };

  const handleUpdateIndicator = (
    code: string,
    patch: Partial<{ standard: string; method: string }>
  ) => {
    const nextIndicators = indicators.map((ind) =>
      ind.code === code ? { ...ind, ...patch } : ind
    );
    void onSaveOnboarding(batches, nextIndicators);
  };

  const handleUpdateSettings = (
    patch: Partial<TrainingBatch['settings']>
  ) => {
    void updateBatch((b) => ({
      ...b,
      settings: { ...b.settings, ...patch },
    }));
  };

  const handleExportResultsCSV = () => {
    if (!activeBatch) return;
    const headers = [
      'No',
      'Nama Peserta',
      'Cabang',
      'Tanggal Mulai',
      'Target Selesai',
      'Kehadiran (%)',
      ...ASPECT_KEYS.map((k) => ASPECT_LABELS[k]),
      'Nilai Akhir',
      'Kategori',
      'Syarat Kritis Kebersihan',
      'Keputusan',
      'Peringkat',
      'Sertifikasi',
      'Catatan Trainer',
    ];
    const rows = activeBatch.trainees.map((t, idx) => {
      const sum = summaries[t.id];
      return [
        idx + 1,
        t.name,
        t.branch,
        t.startDate,
        t.completionDate,
        `${sum?.attendancePercent ?? 0}%`,
        ...ASPECT_KEYS.map((k) =>
          sum?.aspectScores[k] !== null && sum?.aspectScores[k] !== undefined
            ? sum.aspectScores[k]!.toFixed(1)
            : '—'
        ),
        sum?.finalScore !== null && sum?.finalScore !== undefined ? sum.finalScore.toFixed(1) : '—',
        sum?.category || 'Belum Lengkap',
        sum?.criticalHygienePassed === null
          ? 'Menunggu'
          : sum.criticalHygienePassed
          ? 'Memenuhi'
          : 'Tidak Memenuhi',
        sum?.decision || 'Menunggu Kelengkapan',
        sum?.rank || '—',
        t.certifications.join('; '),
        t.trainerNotes || '',
      ];
    });
    downloadCSV(
      `Rekap_Training_${activeBatch.name.replace(/[^a-zA-Z0-9]+/g, '_')}.csv`,
      headers,
      rows
    );
  };

  if (!activeBatch) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500">
        Belum ada data batch training.
      </div>
    );
  }

  const raporTrainee =
    activeBatch.trainees.find((t) => t.id === selectedRaporId) || activeBatch.trainees[0];
  const raporSummary = raporTrainee ? summaries[raporTrainee.id] : undefined;

  const weightSum = ASPECT_KEYS.reduce(
    (acc, k) => acc + (activeBatch.settings.weights[k] || 0),
    0
  );

  return (
    <div className="space-y-6">
      {/* Top Batch Selector & Actions */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 no-print">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Batch Aktif (Maks. 25 Peserta)
            </label>
            <select
              value={activeBatch.id}
              onChange={(e) => setActiveBatchId(e.target.value)}
              className="h-9 px-3 text-sm font-semibold text-slate-900 bg-[#EFF6FF] border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]/30"
            >
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.trainees.length}/25)
                </option>
              ))}
            </select>
          </div>

          <div className="h-9 border-l border-slate-200 hidden sm:block mx-1" />

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Tanggal Mulai
            </label>
            <input
              type="date"
              value={activeBatch.startDate}
              onChange={(e) => handleBatchMetaChange('startDate', e.target.value)}
              className="h-9 px-2.5 text-sm font-medium text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Trainer PJ
            </label>
            <select
              value={activeBatch.trainer}
              onChange={(e) => handleBatchMetaChange('trainer', e.target.value)}
              className="h-9 px-2.5 text-sm font-medium text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded-lg w-44"
            >
              {!TRAINER_OPTIONS.includes(activeBatch.trainer) && activeBatch.trainer && (
                <option value={activeBatch.trainer}>{activeBatch.trainer}</option>
              )}
              {TRAINER_OPTIONS.map((tr) => (
                <option key={tr} value={tr}>
                  {tr}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {saving && (
            <span className="text-xs text-slate-500 mr-1">Menyimpan perubahan...</span>
          )}
          <button
            type="button"
            onClick={() => setNewBatchOpen(true)}
            className="h-9 px-3.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Batch Baru</span>
          </button>
          <button
            type="button"
            onClick={() => setAddTraineeOpen(true)}
            disabled={activeBatch.trainees.length >= 25}
            className="h-9 px-3.5 text-xs font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Tambah Peserta ({activeBatch.trainees.length}/25)</span>
          </button>
          <button
            type="button"
            onClick={handleExportResultsCSV}
            className="h-9 px-3.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            <span>Ekspor CSV</span>
          </button>
        </div>
      </div>

      {/* Segmented Navigation Tabs */}
      <div className="overflow-x-auto pb-1 no-print">
        <div className="inline-flex bg-slate-200/70 p-1 rounded-xl gap-1 min-w-max">
          {TAB_ITEMS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB 0: RINGKASAN VISUAL */}
      {activeTab === 'ringkasan' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500">Peserta Batch Terdaftar</p>
              <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
                {dashboardStats.total}{' '}
                <span className="text-sm font-normal text-slate-500">/ 25 maks</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {dashboardStats.complete} selesai dinilai penuh ({indicators.length} indikator)
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500">Kelulusan &amp; Syarat Kritis</p>
              <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-700">
                {dashboardStats.passed}{' '}
                <span className="text-sm font-normal text-slate-500">Lulus</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Wajib Kebersihan &amp; SOP ≥ {activeBatch.settings.criticalHygieneMin}
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500">Rata-rata Nilai Akhir</p>
              <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-[#0B4EA2]">
                {dashboardStats.avgFinal.toFixed(1)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Tertinggi: {dashboardStats.highest.toFixed(1)} · Terendah:{' '}
                {dashboardStats.lowest.toFixed(1)}
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500">Peserta Terbaik Batch</p>
              <p className="mt-2 text-lg font-bold text-slate-900 truncate">
                {dashboardStats.bestName}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Rata-rata kehadiran: {dashboardStats.avgAttendance}%
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Aspect averages */}
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-sm font-bold text-slate-900 mb-4">
                Rata-rata Skor Per Aspek Penilaian (Skala 0–100)
              </h3>
              <div className="space-y-3.5">
                {ASPECT_KEYS.map((key) => {
                  const score = dashboardStats.aspectAverages[key] || 0;
                  const isCritical = key === 'kebersihan';
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-medium text-slate-700">
                          {ASPECT_LABELS[key]}{' '}
                          <span className="text-slate-400">
                            (Bobot {activeBatch.settings.weights[key]}%)
                          </span>
                          {isCritical && (
                            <span className="ml-2 text-rose-700 font-semibold">
                              [Syarat Kritis ≥ {activeBatch.settings.criticalHygieneMin}]
                            </span>
                          )}
                        </span>
                        <span className="font-mono tabular-nums font-bold text-slate-900">
                          {score.toFixed(1)}
                        </span>
                      </div>
                      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            isCritical && score < activeBatch.settings.criticalHygieneMin
                              ? 'bg-rose-500'
                              : 'bg-[#0B4EA2]'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Category breakdown */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-sm font-bold text-slate-900 mb-4">Distribusi Kategori</h3>
              <div className="space-y-3">
                {[
                  { label: 'Sangat Baik', rule: `≥ ${activeBatch.settings.thresholds.sangatBaik}`, color: 'bg-emerald-600' },
                  { label: 'Baik', rule: `≥ ${activeBatch.settings.thresholds.baik}`, color: 'bg-sky-600' },
                  { label: 'Cukup', rule: `≥ ${activeBatch.settings.thresholds.cukup}`, color: 'bg-amber-600' },
                  { label: 'Perlu Pembinaan', rule: `< ${activeBatch.settings.thresholds.cukup}`, color: 'bg-rose-600' },
                  { label: 'Belum Lengkap', rule: `< ${indicators.length} indikator`, color: 'bg-slate-400' },
                ].map((item) => {
                  const count = dashboardStats.categoryCounts[item.label] || 0;
                  return (
                    <div
                      key={item.label}
                      className="flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0 text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                        <span className="font-semibold text-slate-800">{item.label}</span>
                        <span className="text-slate-400">({item.rule})</span>
                      </div>
                      <span className="font-mono tabular-nums font-bold text-slate-900">
                        {count} kru
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-5 pt-4 border-t border-slate-200 text-xs text-slate-600 space-y-1.5">
                <p className="font-semibold text-slate-800">Legenda Workbook:</p>
                <p>
                  <span className="inline-block w-3 h-3 bg-[#EFF6FF] border border-slate-300 align-middle mr-1.5" />
                  Sel latar biru muda = input manual HC / Trainer
                </p>
                <p>
                  <span className="inline-block w-3 h-3 bg-white border border-slate-300 align-middle mr-1.5" />
                  Sel latar putih = hasil perhitungan otomatis
                </p>
              </div>
            </div>
          </div>

          {/* Onboarding Status & Certifications At a Glance */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                Status Onboarding, Tanggal Target &amp; Sertifikasi Peserta
              </h3>
              <button
                type="button"
                onClick={() => setActiveTab('skor')}
                className="text-xs font-semibold text-[#0B4EA2] hover:underline"
              >
                Buka Matriks Input Skor →
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Peserta</th>
                    <th className="px-4 py-3 font-semibold">Cabang</th>
                    <th className="px-4 py-3 font-semibold">Mulai – Selesai</th>
                    <th className="px-4 py-3 font-semibold">Kehadiran</th>
                    <th className="px-4 py-3 font-semibold">Progres Indikator</th>
                    <th className="px-4 py-3 font-semibold">Sertifikasi</th>
                    <th className="px-4 py-3 font-semibold text-right">Nilai &amp; Keputusan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeBatch.trainees.map((t) => {
                    const sum = summaries[t.id];
                    return (
                      <tr key={t.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          {t.name}
                          {t.isExample && (
                            <span className="ml-1.5 text-[11px] font-normal text-slate-400">
                              (contoh)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{t.branch}</td>
                        <td className="px-4 py-3 font-mono tabular-nums text-slate-600">
                          {formatDateID(t.startDate)} – {formatDateID(t.completionDate)}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums font-semibold text-slate-800">
                          {sum?.attendancePercent ?? 0}% ({sum?.hadirCount ?? 0}H)
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#0B4EA2] rounded-full"
                                style={{
                                  width: `${Math.round(
                                    ((sum?.filledCount || 0) / Math.max(1, indicators.length)) * 100
                                  )}%`,
                                }}
                              />
                            </div>
                            <span className="font-mono tabular-nums text-slate-600">
                              {sum?.filledCount || 0}/{indicators.length}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {t.certifications.length > 0 ? (
                            <span>{t.certifications.join(', ')}</span>
                          ) : (
                            <span className="text-slate-400">Belum ada</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="font-mono tabular-nums font-bold text-slate-900">
                            {sum?.finalScore !== null && sum?.finalScore !== undefined
                              ? sum.finalScore.toFixed(1)
                              : '—'}
                          </div>
                          <div
                            className={`text-[11px] font-semibold ${
                              sum?.decision === 'Lulus'
                                ? 'text-emerald-700'
                                : sum?.decision?.startsWith('Belum Lulus')
                                ? 'text-rose-700'
                                : 'text-slate-500'
                            }`}
                          >
                            {sum?.decision}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {activeBatch.trainees.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        Belum ada peserta pada batch ini. Klik &ldquo;Tambah Peserta&rdquo; untuk
                        memasukkan kru baru.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 1: DAFTAR PESERTA */}
      {activeTab === 'peserta' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Daftar Peserta &amp; Sertifikasi Batch ({activeBatch.trainees.length}/25)
              </h3>
              <p className="text-xs text-slate-500">
                Nama peserta otomatis tersinkronisasi ke Jadwal, Kehadiran, Input Skor, Hasil, dan
                Rapor Individu.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">Nama Batch:</label>
              <input
                type="text"
                value={activeBatch.name}
                onChange={(e) => handleBatchMetaChange('name', e.target.value)}
                className="h-8 px-2.5 text-xs font-semibold text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded-lg w-56"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#1B365D] text-white">
                <tr>
                  <th className="px-3 py-2.5 font-semibold w-10">No</th>
                  <th className="px-3 py-2.5 font-semibold">Nama Lengkap</th>
                  <th className="px-3 py-2.5 font-semibold">Email Kru</th>
                  <th className="px-3 py-2.5 font-semibold">Cabang</th>
                  <th className="px-3 py-2.5 font-semibold">Tgl Mulai</th>
                  <th className="px-3 py-2.5 font-semibold">Tgl Selesai</th>
                  <th className="px-3 py-2.5 font-semibold">Sertifikasi Kompetensi</th>
                  <th className="px-3 py-2.5 font-semibold text-right w-16">Hapus</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {activeBatch.trainees.map((t, idx) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono tabular-nums text-slate-500">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={t.name}
                        onChange={(e) => handleUpdateTrainee(t.id, { name: e.target.value })}
                        className="w-full h-8 px-2 text-xs font-semibold text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="email"
                        value={t.email}
                        onChange={(e) => handleUpdateTrainee(t.id, { email: e.target.value })}
                        placeholder="email@kopituju.id"
                        className="w-44 h-8 px-2 text-xs text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={t.branch}
                        onChange={(e) =>
                          handleUpdateTrainee(t.id, { branch: e.target.value as BranchName })
                        }
                        className="h-8 px-2 text-xs text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                      >
                        {BRANCH_LIST.map((br) => (
                          <option key={br} value={br}>
                            {br}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="date"
                        value={t.startDate}
                        onChange={(e) => handleUpdateTrainee(t.id, { startDate: e.target.value })}
                        className="h-8 px-2 text-xs font-mono text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="date"
                        value={t.completionDate}
                        onChange={(e) =>
                          handleUpdateTrainee(t.id, { completionDate: e.target.value })
                        }
                        className="h-8 px-2 text-xs font-mono text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {CERT_OPTIONS.map((cert) => {
                          const checked = t.certifications.includes(cert);
                          return (
                            <button
                              key={cert}
                              type="button"
                              onClick={() => handleToggleCert(t, cert)}
                              className={`px-2 py-1 text-[11px] rounded border transition-colors ${
                                checked
                                  ? 'bg-emerald-50 border-emerald-400 text-emerald-800 font-semibold'
                                  : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400'
                              }`}
                            >
                              {checked ? '✓ ' : ''}
                              {cert}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleRemoveTrainee(t.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded"
                        title="Hapus peserta"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: JADWAL 14 HARI */}
      {activeTab === 'jadwal' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="text-sm font-bold text-slate-900">
              Jadwal Training 14 Hari ({activeBatch.name})
            </h3>
            <p className="text-xs text-slate-500">
              Tanggal terhitung otomatis dari Tanggal Mulai Batch. Kolom Peserta Hadir terisi
              otomatis dari tab Kehadiran.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#1B365D] text-white">
                <tr>
                  <th className="px-3 py-2.5 font-semibold w-16">Hari</th>
                  <th className="px-3 py-2.5 font-semibold w-28">Tanggal</th>
                  <th className="px-3 py-2.5 font-semibold">Materi / Topik Training</th>
                  <th className="px-3 py-2.5 font-semibold w-36">Trainer</th>
                  <th className="px-3 py-2.5 font-semibold w-32">Status</th>
                  <th className="px-3 py-2.5 font-semibold w-28 text-center">Peserta Hadir</th>
                  <th className="px-3 py-2.5 font-semibold">Catatan Sesi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {activeBatch.schedule.map((item, idx) => {
                  const dateISO = addDaysISO(activeBatch.startDate, item.day - 1);
                  const hadirDayCount = activeBatch.trainees.filter(
                    (t) => t.attendance[idx] === 'H'
                  ).length;
                  return (
                    <tr key={item.day} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono tabular-nums font-semibold text-slate-700">
                        Hari {item.day}
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums text-slate-600">
                        {formatDateID(dateISO)}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={item.topic}
                          onChange={(e) =>
                            handleUpdateSchedule(item.day, { topic: e.target.value })
                          }
                          className="w-full h-8 px-2 text-xs text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={item.trainer}
                          onChange={(e) =>
                            handleUpdateSchedule(item.day, { trainer: e.target.value })
                          }
                          className="w-full h-8 px-2 text-xs font-medium text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                        >
                          {!TRAINER_OPTIONS.includes(item.trainer) && item.trainer && (
                            <option value={item.trainer}>{item.trainer}</option>
                          )}
                          {TRAINER_OPTIONS.map((tr) => (
                            <option key={tr} value={tr}>
                              {tr}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={item.status}
                          onChange={(e) =>
                            handleUpdateSchedule(item.day, {
                              status: e.target.value as 'Terjadwal' | 'Berjalan' | 'Selesai',
                            })
                          }
                          className="w-full h-8 px-2 text-xs font-semibold text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                        >
                          <option value="Terjadwal">Terjadwal</option>
                          <option value="Berjalan">Berjalan</option>
                          <option value="Selesai">Selesai</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 text-center font-mono tabular-nums font-bold text-slate-900">
                        {hadirDayCount} / {activeBatch.trainees.length}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={item.notes}
                          onChange={(e) =>
                            handleUpdateSchedule(item.day, { notes: e.target.value })
                          }
                          placeholder="Catatan trainer..."
                          className="w-full h-8 px-2 text-xs text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: KEHADIRAN */}
      {activeTab === 'kehadiran' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Rekap Kehadiran 14 Hari (Klik sel untuk ubah: H → I → S → A → Kosong)
              </h3>
              <p className="text-xs text-slate-500">
                H = Hadir · I = Izin · S = Sakit · A = Alpha. Persentase kehadiran dihitung
                otomatis dari total hari tercatat.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-center text-xs">
              <thead className="bg-[#1B365D] text-white">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold sticky left-0 bg-[#1B365D] min-w-[160px]">
                    Nama Peserta
                  </th>
                  {Array.from({ length: 14 }, (_, i) => (
                    <th key={i} className="px-2 py-2.5 font-semibold w-10">
                      H{i + 1}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 font-semibold">Hadir</th>
                  <th className="px-3 py-2.5 font-semibold">% Hadir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {activeBatch.trainees.map((t) => {
                  const att = calculateAttendancePercent(t.attendance);
                  return (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-left font-semibold text-slate-900 sticky left-0 bg-white border-r border-slate-200">
                        {t.name}
                      </td>
                      {t.attendance.map((code, idx) => {
                        const cellColor =
                          code === 'H'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : code === 'I'
                            ? 'bg-sky-50 text-sky-800 border-sky-200'
                            : code === 'S'
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : code === 'A'
                            ? 'bg-rose-50 text-rose-800 border-rose-200'
                            : 'bg-[#EFF6FF] text-slate-400 border-slate-200';
                        return (
                          <td key={idx} className="p-1">
                            <button
                              type="button"
                              onClick={() => handleCycleAttendance(t.id, idx)}
                              className={`w-8 h-8 rounded font-mono font-bold text-xs border transition-colors ${cellColor}`}
                            >
                              {code || '·'}
                            </button>
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 font-mono tabular-nums font-semibold text-slate-800">
                        {att.hadir}/{att.recorded}
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums font-bold text-[#0B4EA2]">
                        {att.percent}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: STANDAR 30 INDIKATOR */}
      {activeTab === 'standar' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-3">
              Skala Penilaian Resmi (1–5)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {[5, 4, 3, 2, 1].map((s) => (
                <div key={s} className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono font-bold text-sm text-[#0B4EA2]">Skor {s}</span>
                    <span className="text-xs font-bold text-slate-900">
                      {SCORE_SCALE_DESC[s].label}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    {SCORE_SCALE_DESC[s].desc}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-900">
                Rujukan {indicators.length} Indikator Penilaian Barista (A1–F5)
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#1B365D] text-white">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold w-16">Kode</th>
                    <th className="px-3 py-2.5 font-semibold w-56">Aspek Penilaian</th>
                    <th className="px-3 py-2.5 font-semibold">Standar yang Dinilai</th>
                    <th className="px-3 py-2.5 font-semibold w-56">Metode Penilaian</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {indicators.map((ind) => (
                    <tr key={ind.code} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono font-bold text-[#0B4EA2]">{ind.code}</td>
                      <td className="px-3 py-2 font-medium text-slate-700">{ind.aspectLabel}</td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={ind.standard}
                          onChange={(e) =>
                            handleUpdateIndicator(ind.code, { standard: e.target.value })
                          }
                          className="w-full h-8 px-2 text-xs text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={ind.method}
                          onChange={(e) =>
                            handleUpdateIndicator(ind.code, { method: e.target.value })
                          }
                          className="w-full h-8 px-2 text-xs text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: INPUT SKOR MATRIKS INDIKATOR */}
      {activeTab === 'skor' && (() => {
        const activeScoreTrainee =
          activeBatch.trainees.find((t) => t.id === scoreTraineeId) || activeBatch.trainees[0];
        return (
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Input Skor Evaluasi (Peserta × {indicators.length} Indikator A1–F5)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Isi skor 1–5 sesuai deskripsi standar tiap indikator. Nilai akhir &amp; kategori
                    muncul otomatis setelah seluruh {indicators.length} indikator terisi.
                  </p>
                </div>

                <div className="inline-flex bg-slate-100 p-1 rounded-lg border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setScoreViewMode('matrix')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                      scoreViewMode === 'matrix'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Matriks Semua Peserta
                  </button>
                  <button
                    type="button"
                    onClick={() => setScoreViewMode('per_trainee')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                      scoreViewMode === 'per_trainee'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Form Per Peserta (Detail Standar)
                  </button>
                </div>
              </div>

              {scoreViewMode === 'matrix' ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-center text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#1B365D] text-white">
                        <th
                          rowSpan={2}
                          className="px-3 py-2.5 text-left font-semibold sticky left-0 bg-[#1B365D] z-20 min-w-[170px] border-r border-slate-700"
                        >
                          Peserta
                        </th>
                        {ASPECT_KEYS.map((key) => {
                          const count = indicators.filter((i) => i.aspect === key).length;
                          if (count === 0) return null;
                          return (
                            <th
                              key={key}
                              colSpan={count}
                              className="px-3 py-2 text-left font-semibold border-l border-slate-700 text-[11px]"
                            >
                              {ASPECT_LABELS[key]} ({count} Indikator)
                            </th>
                          );
                        })}
                        <th
                          rowSpan={2}
                          className="px-3 py-2.5 font-semibold border-l border-slate-700 min-w-[74px]"
                        >
                          Terisi
                        </th>
                      </tr>
                      <tr className="bg-slate-50 text-slate-700 border-b border-slate-300">
                        {indicators.map((ind) => (
                          <th
                            key={ind.code}
                            className="px-2.5 py-2 text-left align-top border-l border-slate-200 min-w-[155px] max-w-[175px]"
                          >
                            <div className="flex items-center justify-between gap-1.5 mb-1">
                              <span className="font-mono font-bold text-xs text-[#0B4EA2]">
                                {ind.code}
                              </span>
                              <span className="text-[10px] font-normal text-slate-500 truncate">
                                {ind.method}
                              </span>
                            </div>
                            <p className="text-[11px] font-medium text-slate-800 leading-snug whitespace-normal">
                              {ind.standard}
                            </p>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {activeBatch.trainees.map((t) => {
                        const sum = summaries[t.id];
                        return (
                          <tr key={t.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2.5 text-left font-semibold text-slate-900 sticky left-0 bg-white border-r border-slate-200 z-10">
                              <div>{t.name}</div>
                              <div className="text-[11px] font-normal text-slate-500">
                                {t.branch}
                              </div>
                            </td>
                            {indicators.map((ind) => {
                              const val = t.scores[ind.code];
                              const tint =
                                val !== null && val !== undefined && val <= 2
                                  ? 'bg-rose-50 text-rose-800 border-rose-300'
                                  : val === 5
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                  : 'bg-[#EFF6FF] text-blue-900 border-slate-300';
                              return (
                                <td
                                  key={ind.code}
                                  className="px-2.5 py-2 border-l border-slate-100 text-center"
                                >
                                  <input
                                    type="number"
                                    min={1}
                                    max={5}
                                    value={val ?? ''}
                                    onChange={(e) =>
                                      handleScoreChange(t.id, ind.code, e.target.value)
                                    }
                                    placeholder="1-5"
                                    title={`${t.name} — ${ind.code}: ${ind.standard}`}
                                    className={`w-14 h-8 text-center font-mono font-bold text-xs border rounded focus:outline-none focus:ring-2 focus:ring-[#0B4EA2]/30 ${tint}`}
                                  />
                                </td>
                              );
                            })}
                            <td className="px-3 py-2.5 font-mono tabular-nums font-bold text-slate-700 border-l border-slate-200">
                              {sum?.filledCount || 0}/{indicators.length}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-5 space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-semibold text-slate-700">
                        Pilih Peserta:
                      </label>
                      <select
                        value={activeScoreTrainee?.id || ''}
                        onChange={(e) => setScoreTraineeId(e.target.value)}
                        className="h-9 px-3 text-sm font-semibold text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded-lg"
                      >
                        {activeBatch.trainees.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.branch})
                          </option>
                        ))}
                      </select>
                    </div>
                    {activeScoreTrainee && (
                      <div className="text-xs text-slate-600 font-mono tabular-nums">
                        Progres:{' '}
                        <strong className="text-slate-900">
                          {summaries[activeScoreTrainee.id]?.filledCount || 0}/
                          {indicators.length} indikator
                        </strong>{' '}
                        · Nilai Sementara:{' '}
                        <strong className="text-[#0B4EA2]">
                          {summaries[activeScoreTrainee.id]?.finalScore !== null &&
                          summaries[activeScoreTrainee.id]?.finalScore !== undefined
                            ? summaries[activeScoreTrainee.id]?.finalScore!.toFixed(1)
                            : 'Menunggu lengkap'}
                        </strong>
                      </div>
                    )}
                  </div>

                  {activeScoreTrainee ? (
                    <div className="space-y-5">
                      {ASPECT_KEYS.map((key) => {
                        const aspectInds = indicators.filter((ind) => ind.aspect === key);
                        if (aspectInds.length === 0) return null;
                        return (
                          <div
                            key={key}
                            className="border border-slate-200 rounded-xl overflow-hidden"
                          >
                            <div className="bg-[#1B365D] text-white px-4 py-2.5 flex items-center justify-between text-xs font-semibold">
                              <span>{ASPECT_LABELS[key]}</span>
                              <span className="font-mono">
                                Bobot {activeBatch.settings.weights[key]}%
                              </span>
                            </div>
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                                <tr>
                                  <th className="px-3 py-2 font-semibold w-16">Kode</th>
                                  <th className="px-3 py-2 font-semibold">Standar yang Dinilai</th>
                                  <th className="px-3 py-2 font-semibold w-40">Metode</th>
                                  <th className="px-3 py-2 font-semibold w-44 text-center">
                                    Skor (1–5)
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {aspectInds.map((ind) => {
                                  const val = activeScoreTrainee.scores[ind.code];
                                  return (
                                    <tr key={ind.code} className="hover:bg-slate-50">
                                      <td className="px-3 py-2.5 font-mono font-bold text-[#0B4EA2]">
                                        {ind.code}
                                      </td>
                                      <td className="px-3 py-2.5 text-slate-800 font-medium">
                                        {ind.standard}
                                      </td>
                                      <td className="px-3 py-2.5 text-slate-500">{ind.method}</td>
                                      <td className="px-3 py-2.5 text-center">
                                        <div className="inline-flex items-center gap-1">
                                          {[1, 2, 3, 4, 5].map((num) => {
                                            const selected = val === num;
                                            return (
                                              <button
                                                key={num}
                                                type="button"
                                                onClick={() =>
                                                  handleScoreChange(
                                                    activeScoreTrainee.id,
                                                    ind.code,
                                                    selected ? '' : String(num)
                                                  )
                                                }
                                                title={SCORE_SCALE_DESC[num].label}
                                                className={`w-7 h-7 rounded font-mono text-xs font-bold border transition-colors ${
                                                  selected
                                                    ? num <= 2
                                                      ? 'bg-rose-600 text-white border-rose-600'
                                                      : num === 5
                                                      ? 'bg-emerald-600 text-white border-emerald-600'
                                                      : 'bg-[#0B4EA2] text-white border-[#0B4EA2]'
                                                    : 'bg-[#EFF6FF] text-blue-900 border-slate-300 hover:border-slate-500'
                                                }`}
                                              >
                                                {num}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 text-center py-6">
                      Belum ada peserta pada batch ini.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* TAB 6: HASIL PENILAIAN */}
      {activeTab === 'hasil' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Hasil Penilaian Otomatis &amp; Catatan Trainer
              </h3>
              <p className="text-xs text-slate-500">
                Syarat Kritis: Aspek Kebersihan, Keamanan Pangan &amp; SOP minimal{' '}
                {activeBatch.settings.criticalHygieneMin}. Hanya kolom Catatan Trainer yang diisi
                manual.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#1B365D] text-white">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">No</th>
                  <th className="px-3 py-2.5 font-semibold">Peserta</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Hadir</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Teknis</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Layanan</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Penget.</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Kebersihan</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Kasir</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Sikap</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Nilai Akhir</th>
                  <th className="px-3 py-2.5 font-semibold">Kategori</th>
                  <th className="px-3 py-2.5 font-semibold">Keputusan</th>
                  <th className="px-3 py-2.5 font-semibold text-center">Rank</th>
                  <th className="px-3 py-2.5 font-semibold min-w-[200px]">Catatan Trainer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {activeBatch.trainees.map((t, idx) => {
                  const s = summaries[t.id];
                  const fmt = (v: number | null | undefined) =>
                    v !== null && v !== undefined ? v.toFixed(1) : '—';
                  return (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-mono tabular-nums text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-slate-900 whitespace-nowrap">
                        {t.name}
                      </td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-right">
                        {s?.attendancePercent ?? 0}%
                      </td>
                      {ASPECT_KEYS.map((k) => {
                        const val = s?.aspectScores[k];
                        const failCritical =
                          k === 'kebersihan' &&
                          val !== null &&
                          val !== undefined &&
                          val < activeBatch.settings.criticalHygieneMin;
                        return (
                          <td
                            key={k}
                            className={`px-3 py-2.5 font-mono tabular-nums text-right ${
                              failCritical ? 'text-rose-700 font-bold' : 'text-slate-700'
                            }`}
                          >
                            {fmt(val)}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2.5 font-mono tabular-nums text-right font-bold text-[#0B4EA2]">
                        {fmt(s?.finalScore)}
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-slate-800 whitespace-nowrap">
                        {s?.category}
                      </td>
                      <td
                        className={`px-3 py-2.5 font-semibold whitespace-nowrap ${
                          s?.decision === 'Lulus'
                            ? 'text-emerald-700'
                            : s?.decision?.startsWith('Belum Lulus')
                            ? 'text-rose-700'
                            : 'text-slate-500'
                        }`}
                      >
                        {s?.decision}
                      </td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-center font-bold">
                        {s?.rank ? `#${s.rank}` : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={t.trainerNotes}
                          onChange={(e) =>
                            handleUpdateTrainee(t.id, { trainerNotes: e.target.value })
                          }
                          placeholder="Tambahkan catatan evaluasi..."
                          className="w-full h-8 px-2 text-xs text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 7: RAPOR INDIVIDU */}
      {activeTab === 'rapor' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 no-print">
            <div className="flex items-center gap-3">
              <label className="text-xs font-semibold text-slate-700">Pilih Peserta Rapor:</label>
              <select
                value={raporTrainee?.id || ''}
                onChange={(e) => setSelectedRaporId(e.target.value)}
                className="h-9 px-3 text-sm font-semibold text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded-lg"
              >
                {activeBatch.trainees.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.branch})
                  </option>
                ))}
              </select>
            </div>
            {raporTrainee && raporSummary && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="h-9 px-3.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Cetak</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadRaporPDF(
                      activeBatch,
                      raporTrainee,
                      raporSummary,
                      activeBatch.settings
                    )
                  }
                  className="h-9 px-4 text-xs font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] rounded-lg inline-flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Unduh Rapor PDF</span>
                </button>
              </div>
            )}
          </div>

          {raporTrainee && raporSummary ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-4xl mx-auto">
              <div className="text-center border-b-2 border-slate-800 pb-4 mb-6">
                <h2 className="text-lg font-bold tracking-wide text-slate-900">
                  RAPOR INDIVIDU ONBOARDING &amp; TRAINING BARISTA
                </h2>
                <p className="text-xs text-slate-600 mt-1">
                  Toko Kopi Tuju — Human Capital Management
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs mb-6">
                <div className="space-y-1.5">
                  <p>
                    <span className="inline-block w-32 text-slate-500">Nama Peserta</span>:{' '}
                    <strong className="text-slate-900">{raporTrainee.name}</strong>
                  </p>
                  <p>
                    <span className="inline-block w-32 text-slate-500">Cabang Penempatan</span>:{' '}
                    <strong className="text-slate-900">{raporTrainee.branch}</strong>
                  </p>
                  <p>
                    <span className="inline-block w-32 text-slate-500">Batch Training</span>:{' '}
                    <strong className="text-slate-900">{activeBatch.name}</strong>
                  </p>
                  <p>
                    <span className="inline-block w-32 text-slate-500">Trainer PJ</span>:{' '}
                    <strong className="text-slate-900">{activeBatch.trainer}</strong>
                  </p>
                </div>
                <div className="space-y-1.5">
                  <p>
                    <span className="inline-block w-32 text-slate-500">Tanggal Mulai</span>:{' '}
                    <strong className="font-mono">{formatDateID(raporTrainee.startDate)}</strong>
                  </p>
                  <p>
                    <span className="inline-block w-32 text-slate-500">Tanggal Selesai</span>:{' '}
                    <strong className="font-mono">
                      {formatDateID(raporTrainee.completionDate)}
                    </strong>
                  </p>
                  <p>
                    <span className="inline-block w-32 text-slate-500">Kehadiran (14 Hari)</span>:{' '}
                    <strong className="font-mono">
                      {raporSummary.hadirCount} hari ({raporSummary.attendancePercent}%)
                    </strong>
                  </p>
                  <p>
                    <span className="inline-block w-32 text-slate-500">Peringkat Batch</span>:{' '}
                    <strong className="font-mono">
                      {raporSummary.rank ? `#${raporSummary.rank}` : '—'}
                    </strong>
                  </p>
                </div>
              </div>

              <table className="w-full text-xs border border-slate-300 mb-6">
                <thead className="bg-slate-100 text-slate-800 border-b border-slate-300">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-semibold">Aspek Penilaian</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Bobot</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Nilai (0–100)</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {ASPECT_KEYS.map((key) => {
                    const val = raporSummary.aspectScores[key];
                    const isCritical = key === 'kebersihan';
                    const passCritical =
                      !isCritical ||
                      val === null ||
                      val >= activeBatch.settings.criticalHygieneMin;
                    return (
                      <tr key={key}>
                        <td className="px-3 py-2.5 font-medium text-slate-800">
                          {ASPECT_LABELS[key]}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                          {activeBatch.settings.weights[key]}%
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums font-bold">
                          {val !== null ? val.toFixed(1) : '—'}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-semibold ${
                            val === null
                              ? 'text-slate-400'
                              : passCritical
                              ? 'text-emerald-700'
                              : 'text-rose-700'
                          }`}
                        >
                          {val === null
                            ? 'Belum Lengkap'
                            : passCritical
                            ? 'Memenuhi'
                            : `Di bawah min (${activeBatch.settings.criticalHygieneMin})`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4 mb-6">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-slate-500">
                    Nilai Akhir Gabungan
                  </p>
                  <p className="text-2xl font-bold font-mono tabular-nums text-[#0B4EA2]">
                    {raporSummary.finalScore !== null
                      ? raporSummary.finalScore.toFixed(1)
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-slate-500">Kategori</p>
                  <p className="text-base font-bold text-slate-900">{raporSummary.category}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-slate-500">Keputusan</p>
                  <p
                    className={`text-base font-bold ${
                      raporSummary.decision === 'Lulus'
                        ? 'text-emerald-700'
                        : raporSummary.decision.startsWith('Belum Lulus')
                        ? 'text-rose-700'
                        : 'text-slate-600'
                    }`}
                  >
                    {raporSummary.decision}
                  </p>
                </div>
              </div>

              <div className="space-y-3 text-xs mb-10">
                <div>
                  <p className="font-bold text-slate-800 mb-1 flex items-center gap-1.5">
                    <Award className="w-3.5 h-3.5 text-[#0B4EA2]" />
                    <span>Sertifikasi Kompetensi Diperoleh:</span>
                  </p>
                  <p className="text-slate-700">
                    {raporTrainee.certifications.length > 0
                      ? raporTrainee.certifications.join(' · ')
                      : 'Belum ada sertifikasi tercatat.'}
                  </p>
                </div>
                <div>
                  <p className="font-bold text-slate-800 mb-1">Catatan Evaluasi Trainer:</p>
                  <p className="text-slate-700 italic">
                    {raporTrainee.trainerNotes || 'Tidak ada catatan tambahan.'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-6 text-center text-xs pt-6 border-t border-slate-200">
                <div>
                  <p className="text-slate-500 mb-14">Trainer Lapangan</p>
                  <p className="font-bold text-slate-900 border-t border-slate-400 pt-1 inline-block px-6">
                    {activeBatch.trainer}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500 mb-14">Manager HC Kopi Tuju</p>
                  <p className="font-bold text-slate-900 border-t border-slate-400 pt-1 inline-block px-6">
                    Pengelola Kopi Tuju
                  </p>
                </div>
                <div>
                  <p className="text-slate-500 mb-14">Peserta Training</p>
                  <p className="font-bold text-slate-900 border-t border-slate-400 pt-1 inline-block px-6">
                    {raporTrainee.name}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-500">
              Belum ada peserta untuk dibuatkan rapor.
            </div>
          )}
        </div>
      )}

      {/* TAB 8: PENGATURAN BOBOT & SYARAT KRITIS */}
      {activeTab === 'pengaturan' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-900">Bobot Aspek Penilaian (%)</h3>
              <span
                className={`font-mono text-xs font-bold ${
                  weightSum === 100 ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                Total: {weightSum}%
              </span>
            </div>
            <div className="space-y-3">
              {ASPECT_KEYS.map((key) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <label className="text-xs font-medium text-slate-700">
                    {ASPECT_LABELS[key]}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={activeBatch.settings.weights[key]}
                    onChange={(e) => {
                      const val = Math.max(0, Number(e.target.value) || 0);
                      handleUpdateSettings({
                        weights: { ...activeBatch.settings.weights, [key]: val },
                      });
                    }}
                    className="w-24 h-8 px-2.5 text-right font-mono font-bold text-xs text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-3">
                Batas Nilai Kategori Kelulusan
              </h3>
              <div className="space-y-3">
                {[
                  { key: 'sangatBaik' as const, label: 'Minimal Kategori Sangat Baik' },
                  { key: 'baik' as const, label: 'Minimal Kategori Baik' },
                  { key: 'cukup' as const, label: 'Minimal Kategori Cukup (Batas Lulus)' },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between gap-4">
                    <label className="text-xs font-medium text-slate-700">{item.label}</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={activeBatch.settings.thresholds[item.key]}
                      onChange={(e) =>
                        handleUpdateSettings({
                          thresholds: {
                            ...activeBatch.settings.thresholds,
                            [item.key]: Math.max(0, Number(e.target.value) || 0),
                          },
                        })
                      }
                      className="w-24 h-8 px-2.5 text-right font-mono font-bold text-xs text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200">
              <h3 className="text-sm font-bold text-slate-900 mb-2">
                Syarat Kritis Kebersihan, Keamanan Pangan &amp; SOP
              </h3>
              <p className="text-xs text-slate-500 mb-3">
                Bila nilai aspek Kebersihan di bawah angka ini, peserta otomatis berstatus{' '}
                <strong>Belum Lulus (Syarat Kritis)</strong> berapa pun nilai akhirnya.
              </p>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">
                  Nilai Minimum Aspek Kebersihan
                </span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={activeBatch.settings.criticalHygieneMin}
                  onChange={(e) =>
                    handleUpdateSettings({
                      criticalHygieneMin: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="w-24 h-8 px-2.5 text-right font-mono font-bold text-xs text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: TAMBAH PESERTA */}
      {addTraineeOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setAddTraineeOpen(false);
          }}
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleAddTrainee}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-slate-900">
                Tambah Peserta Batch ({activeBatch.name})
              </h3>
              <button
                type="button"
                onClick={() => setAddTraineeOpen(false)}
                title="Tutup"
                className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Pilih dari Database Kru (Opsional)
              </label>
              <select
                value={selectedEmpId}
                onChange={(e) => {
                  const empId = e.target.value;
                  setSelectedEmpId(empId);
                  const found = employees.find((emp) => emp.id === empId);
                  if (found) {
                    setManualName(found.name);
                    setManualEmail(found.email);
                    setManualBranch(found.branch);
                    setManualStartDate(found.startDate);
                  }
                }}
                className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg"
              >
                <option value="">-- Input Peserta Baru Manual --</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} ({emp.branch} · {emp.status})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nama Lengkap
              </label>
              <input
                type="text"
                required
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                className="w-full h-9 px-3 text-sm bg-[#EFF6FF] border border-slate-300 rounded-lg"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Cabang Penempatan
                </label>
                <select
                  value={manualBranch}
                  onChange={(e) => setManualBranch(e.target.value as BranchName)}
                  className="w-full h-9 px-3 text-sm bg-[#EFF6FF] border border-slate-300 rounded-lg"
                >
                  {BRANCH_LIST.map((br) => (
                    <option key={br} value={br}>
                      {br}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tanggal Mulai
                </label>
                <input
                  type="date"
                  value={manualStartDate}
                  onChange={(e) => setManualStartDate(e.target.value)}
                  className="w-full h-9 px-3 text-sm bg-[#EFF6FF] border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Email Kru</label>
              <input
                type="email"
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                placeholder="nama@kopituju.id"
                className="w-full h-9 px-3 text-sm bg-[#EFF6FF] border border-slate-300 rounded-lg"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAddTraineeOpen(false)}
                className="h-9 px-4 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
              >
                Batal
              </button>
              <button
                type="submit"
                className="h-9 px-4 text-xs font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] rounded-lg inline-flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Simpan Peserta</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: BATCH BARU */}
      {newBatchOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setNewBatchOpen(false);
          }}
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleCreateBatch}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-slate-900">Buat Batch Training Baru</h3>
              <button
                type="button"
                onClick={() => setNewBatchOpen(false)}
                title="Tutup"
                className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nama Batch
              </label>
              <input
                type="text"
                required
                placeholder="Contoh: Batch 09 — Kru Barista Baru"
                value={newBatchName}
                onChange={(e) => setNewBatchName(e.target.value)}
                className="w-full h-9 px-3 text-sm bg-[#EFF6FF] border border-slate-300 rounded-lg"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tanggal Mulai
                </label>
                <input
                  type="date"
                  required
                  value={newBatchStart}
                  onChange={(e) => setNewBatchStart(e.target.value)}
                  className="w-full h-9 px-3 text-sm bg-[#EFF6FF] border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Trainer PJ
                </label>
                <select
                  required
                  value={newBatchTrainer}
                  onChange={(e) => setNewBatchTrainer(e.target.value)}
                  className="w-full h-9 px-3 text-sm text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded-lg"
                >
                  {TRAINER_OPTIONS.map((tr) => (
                    <option key={tr} value={tr}>
                      {tr}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setNewBatchOpen(false)}
                className="h-9 px-4 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
              >
                Batal
              </button>
              <button
                type="submit"
                className="h-9 px-4 text-xs font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] rounded-lg"
              >
                Buat Batch
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
