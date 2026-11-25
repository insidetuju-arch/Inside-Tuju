import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  Download,
  Edit3,
  FileSpreadsheet,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type {
  BranchName,
  Employee,
  KpiDivisionKey,
  KpiEvaluationRecord,
  KpiIndicatorItem,
  KpiJobDescription,
  KpiType,
} from '../types/hc';
import { formatDateID } from '../utils/calculations';
import { downloadCSV, downloadKpiEvaluationPDF } from '../utils/pdfGenerator';

export const KPI_DIVISIONS: Array<{
  key: KpiDivisionKey;
  order: number;
  label: string;
  sheetTitle: string;
  shortLabel: string;
  subtitle: string;
}> = [
  {
    key: 'admin_ops',
    order: 1,
    label: 'Evaluasi Staf Admin Operasional',
    sheetTitle: '1. STAF ADMIN OPERASIONAL SUPPORT (SCM)',
    shortLabel: 'Staf Admin Operasional',
    subtitle: 'Uraian Job Description & KPI penginputan PO/DO, stok gudang, laporan SCM, serta komplain outlet',
  },
  {
    key: 'marketing',
    order: 2,
    label: 'Evaluasi Staf Marketing',
    sheetTitle: '2. STAF MARKETING',
    shortLabel: 'Staf Marketing',
    subtitle: 'Uraian Job Description & KPI produksi konten, transaksi promo, kampanye event, serta analitik brand',
  },
  {
    key: 'supervisor',
    order: 3,
    label: 'Evaluasi Staf Supervisor',
    sheetTitle: '3. STAF SUPERVISOR',
    shortLabel: 'Staf Supervisor',
    subtitle: 'Uraian Job Description & KPI audit kualitas SOP, target omzet cabang binaan, supervisi & coaching kru',
  },
  {
    key: 'akunting',
    order: 4,
    label: 'Evaluasi Staf Akunting',
    sheetTitle: '4. STAF AKUNTING',
    shortLabel: 'Staf Akunting',
    subtitle: 'Uraian Job Description & KPI tutup buku bulanan, rekonsiliasi kas/QRIS 6 outlet, HPP & validasi payroll',
  },
  {
    key: 'kepala_outlet',
    order: 5,
    label: 'Evaluasi Kepala Outlet',
    sheetTitle: '5. KEPALA OUTLET',
    shortLabel: 'Kepala Outlet',
    subtitle: 'Uraian Job Description & KPI target omzet cabang, kontrol waste & stock opname, SOP bar & tim outlet',
  },
];

const BRANCHES: BranchName[] = [
  'Holding',
  'Abdesir',
  'Agus Salim',
  'Djemma',
  'Perintis',
  'Tamalate',
];

interface KpiEvaluationViewProps {
  kpiJobDescriptions: KpiJobDescription[];
  kpiTemplates: KpiIndicatorItem[];
  kpiEvaluations: KpiEvaluationRecord[];
  employees: Employee[];
  activeDivision: KpiDivisionKey;
  onSelectDivision: (division: KpiDivisionKey) => void;
  onSaveKpi: (
    nextJobDescriptions: KpiJobDescription[],
    nextTemplates: KpiIndicatorItem[],
    nextEvaluations: KpiEvaluationRecord[]
  ) => Promise<void>;
}

type KpiSubTab = 'lembar' | 'rekap';

export function computeKpiItemScore(
  ind: KpiIndicatorItem,
  realization: number | null | undefined
): { achievement: number | null; weighted: number | null } {
  if (typeof realization !== 'number' || Number.isNaN(realization)) {
    return { achievement: null, weighted: null };
  }

  let achievement = 0;
  if (ind.type === 'Maximize') {
    achievement = ind.target > 0 ? Math.min(120, (realization / ind.target) * 100) : 0;
  } else {
    // Minimize: semakin rendah realisasi semakin baik (Skor = Target/Realisasi, maks 120%)
    if (ind.target === 0) {
      achievement = realization === 0 ? 100 : 0;
    } else if (realization <= 0) {
      achievement = 120;
    } else {
      achievement = Math.min(120, (ind.target / realization) * 100);
    }
  }

  const roundedAchievement = Math.round(achievement * 10) / 10;
  const weighted = Math.round(((roundedAchievement * (ind.weight || 0)) / 100) * 10) / 10;
  return { achievement: roundedAchievement, weighted };
}

export function computeKpiSummary(
  record: KpiEvaluationRecord,
  indicators: KpiIndicatorItem[]
): {
  filled: number;
  total: number;
  finalScore: number | null;
  predicate: 'SANGAT BAIK' | 'BAIK' | 'CUKUP' | 'PERLU PEMBINAAN' | 'BELUM LENGKAP';
} {
  const total = indicators.length;
  let filled = 0;
  let weightedSum = 0;

  for (const ind of indicators) {
    const calc = computeKpiItemScore(ind, record.scores[ind.code]);
    if (calc.weighted !== null) {
      filled += 1;
      weightedSum += calc.weighted;
    }
  }

  if (total === 0 || filled === 0) {
    return { filled, total, finalScore: null, predicate: 'BELUM LENGKAP' };
  }

  const finalScore = Math.round(weightedSum * 10) / 10;
  let predicate: 'SANGAT BAIK' | 'BAIK' | 'CUKUP' | 'PERLU PEMBINAAN' | 'BELUM LENGKAP' =
    'BELUM LENGKAP';

  if (filled < total) {
    predicate = 'BELUM LENGKAP';
  } else if (finalScore >= 90) {
    predicate = 'SANGAT BAIK';
  } else if (finalScore >= 80) {
    predicate = 'BAIK';
  } else if (finalScore >= 70) {
    predicate = 'CUKUP';
  } else {
    predicate = 'PERLU PEMBINAAN';
  }

  return { filled, total, finalScore, predicate };
}

function formatTargetOrRealization(val: number, unit: string): string {
  if (unit === '%') {
    return Number.isInteger(val) && val !== 2 ? `${val}%` : `${val}%`;
  }
  return `${val}`;
}

export const KpiEvaluationView: React.FC<KpiEvaluationViewProps> = ({
  kpiJobDescriptions,
  kpiTemplates,
  kpiEvaluations,
  employees,
  activeDivision,
  onSelectDivision,
  onSaveKpi,
}) => {
  const [subTab, setSubTab] = useState<KpiSubTab>('lembar');
  const [periodFilter, setPeriodFilter] = useState<string>('ALL');
  const [selectedRecordId, setSelectedRecordId] = useState<string>('');
  const [editingJobdesk, setEditingJobdesk] = useState(false);
  const [editingIndicatorMeta, setEditingIndicatorMeta] = useState(false);
  const [saving, setSaving] = useState(false);

  // Add Evaluation Modal
  const [addOpen, setAddOpen] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualBranch, setManualBranch] = useState<BranchName>('Holding');
  const [manualPeriod, setManualPeriod] = useState('Oktober 2026');
  const [manualEvaluator, setManualEvaluator] = useState('Pengelola Kopi Tuju');
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10));

  const divisionMeta = useMemo(
    () => KPI_DIVISIONS.find((d) => d.key === activeDivision) || KPI_DIVISIONS[0],
    [activeDivision]
  );

  const divisionJobItems = useMemo(() => {
    const found = kpiJobDescriptions.find((j) => j.division === activeDivision);
    return found?.items || [];
  }, [kpiJobDescriptions, activeDivision]);

  const divisionIndicators = useMemo(
    () => kpiTemplates.filter((item) => item.division === activeDivision),
    [kpiTemplates, activeDivision]
  );

  const divisionRecords = useMemo(() => {
    return kpiEvaluations.filter((rec) => {
      if (rec.division !== activeDivision) return false;
      if (periodFilter !== 'ALL' && rec.periodLabel !== periodFilter) return false;
      return true;
    });
  }, [kpiEvaluations, activeDivision, periodFilter]);

  const availablePeriods = useMemo(() => {
    const set = new Set<string>();
    kpiEvaluations.forEach((rec) => {
      if (rec.periodLabel) set.add(rec.periodLabel);
    });
    return Array.from(set);
  }, [kpiEvaluations]);

  const activeRecord = useMemo(() => {
    const matched = divisionRecords.find((r) => r.id === selectedRecordId);
    return matched || divisionRecords[0] || null;
  }, [divisionRecords, selectedRecordId]);

  const summaryStats = useMemo(() => {
    const computed = divisionRecords.map((rec) => ({
      rec,
      sum: computeKpiSummary(rec, divisionIndicators),
    }));
    const valid = computed.filter((x) => x.sum.finalScore !== null);
    const avg =
      valid.length > 0
        ? Math.round(
            (valid.reduce((a, b) => a + (b.sum.finalScore || 0), 0) / valid.length) * 10
          ) / 10
        : 0;
    const highest = valid.reduce((max, x) => Math.max(max, x.sum.finalScore || 0), 0);
    const goodCount = valid.filter((x) => (x.sum.finalScore || 0) >= 80).length;

    return {
      totalCount: divisionRecords.length,
      avg,
      highest,
      goodCount,
    };
  }, [divisionRecords, divisionIndicators]);

  const totalDivisionWeight = divisionIndicators.reduce((acc, i) => acc + (i.weight || 0), 0);

  const persist = async (
    nextJobDescriptions: KpiJobDescription[],
    nextTemplates: KpiIndicatorItem[],
    nextEvaluations: KpiEvaluationRecord[]
  ) => {
    setSaving(true);
    try {
      await onSaveKpi(nextJobDescriptions, nextTemplates, nextEvaluations);
    } finally {
      setSaving(false);
    }
  };

  const handleRealizationUpdate = (recordId: string, code: string, rawVal: string) => {
    const trimmed = rawVal.trim();
    let numVal: number | null = null;
    if (trimmed !== '') {
      const parsed = Number(trimmed);
      if (Number.isNaN(parsed)) return;
      numVal = Math.max(0, parsed);
    }
    const nextEvaluations = kpiEvaluations.map((rec) =>
      rec.id === recordId
        ? { ...rec, scores: { ...rec.scores, [code]: numVal } }
        : rec
    );
    void persist(kpiJobDescriptions, kpiTemplates, nextEvaluations);
  };

  const handleRecordFieldUpdate = (
    recordId: string,
    patch: Partial<KpiEvaluationRecord>
  ) => {
    const nextEvaluations = kpiEvaluations.map((rec) =>
      rec.id === recordId ? { ...rec, ...patch } : rec
    );
    void persist(kpiJobDescriptions, kpiTemplates, nextEvaluations);
  };

  const handleDeleteRecord = (recordId: string) => {
    const nextEvaluations = kpiEvaluations.filter((rec) => rec.id !== recordId);
    void persist(kpiJobDescriptions, kpiTemplates, nextEvaluations);
  };

  const handleUpdateIndicator = (
    code: string,
    patch: Partial<
      Pick<KpiIndicatorItem, 'kpiName' | 'definition' | 'type' | 'weight' | 'target' | 'unit'>
    >
  ) => {
    const nextTemplates = kpiTemplates.map((item) =>
      item.division === activeDivision && item.code === code
        ? { ...item, ...patch }
        : item
    );
    void persist(kpiJobDescriptions, nextTemplates, kpiEvaluations);
  };

  const handleUpdateJobdeskItem = (index: number, value: string) => {
    const exists = kpiJobDescriptions.some((j) => j.division === activeDivision);
    const nextJobs = exists
      ? kpiJobDescriptions.map((j) =>
          j.division === activeDivision
            ? { ...j, items: j.items.map((txt, i) => (i === index ? value : txt)) }
            : j
        )
      : [
          ...kpiJobDescriptions,
          {
            division: activeDivision,
            items: divisionJobItems.map((txt, i) => (i === index ? value : txt)),
          },
        ];
    void persist(nextJobs, kpiTemplates, kpiEvaluations);
  };

  const handleAddJobdeskItem = () => {
    const exists = kpiJobDescriptions.some((j) => j.division === activeDivision);
    const nextJobs = exists
      ? kpiJobDescriptions.map((j) =>
          j.division === activeDivision
            ? { ...j, items: [...j.items, 'Uraian tugas baru...'] }
            : j
        )
      : [...kpiJobDescriptions, { division: activeDivision, items: ['Uraian tugas baru...'] }];
    void persist(nextJobs, kpiTemplates, kpiEvaluations);
  };

  const handleRemoveJobdeskItem = (index: number) => {
    const nextJobs = kpiJobDescriptions.map((j) =>
      j.division === activeDivision
        ? { ...j, items: j.items.filter((_, i) => i !== index) }
        : j
    );
    void persist(nextJobs, kpiTemplates, kpiEvaluations);
  };

  const handleCreateEvaluation = async (e: React.FormEvent) => {
    e.preventDefault();
    const linked = employees.find((emp) => emp.id === selectedEmpId);
    const employeeName = linked ? linked.name : manualName.trim();
    if (!employeeName) return;

    const newRec: KpiEvaluationRecord = {
      id: `kpi-ev-${Date.now()}`,
      division: activeDivision,
      periodLabel: manualPeriod.trim() || 'Oktober 2026',
      employeeId: linked?.id,
      employeeName,
      branch: linked?.branch || manualBranch,
      evaluatorName: manualEvaluator.trim() || 'Pengelola Kopi Tuju',
      evaluatedDate: manualDate,
      scores: Object.fromEntries(divisionIndicators.map((ind) => [ind.code, null])),
      notes: '',
    };

    await persist(kpiJobDescriptions, kpiTemplates, [newRec, ...kpiEvaluations]);
    setSelectedRecordId(newRec.id);
    setSubTab('lembar');
    setAddOpen(false);
    setSelectedEmpId('');
    setManualName('');
  };

  const handleExportCSV = () => {
    const headers = [
      'No',
      'Divisi Evaluasi',
      'Periode',
      'Nama Staf',
      'Cabang',
      'Evaluator',
      'Tanggal',
      ...divisionIndicators.map(
        (i) => `${i.code} Realisasi (${i.unit}, Target ${i.target}${i.unit === '%' ? '%' : ''})`
      ),
      'Nilai Tertimbang Total (%)',
      'Predikat Pencapaian KPI',
      'Catatan',
    ];
    const rows = divisionRecords.map((rec, idx) => {
      const sum = computeKpiSummary(rec, divisionIndicators);
      return [
        idx + 1,
        divisionMeta.label,
        rec.periodLabel,
        rec.employeeName,
        rec.branch,
        rec.evaluatorName,
        rec.evaluatedDate,
        ...divisionIndicators.map((i) =>
          typeof rec.scores[i.code] === 'number' ? rec.scores[i.code]! : '—'
        ),
        sum.finalScore !== null ? sum.finalScore.toFixed(1) : '—',
        sum.predicate,
        rec.notes || '',
      ];
    });
    downloadCSV(
      `${divisionMeta.label.replace(/[^a-zA-Z0-9]+/g, '_')}.csv`,
      headers,
      rows
    );
  };

  return (
    <div className="space-y-6">
      {/* 5 Division Selector Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-[#0B4EA2]" />
              <span>{divisionMeta.label}</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">{divisionMeta.subtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {saving && <span className="text-xs text-slate-500 mr-1">Menyimpan...</span>}
            <select
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value)}
              className="h-9 px-3 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
            >
              <option value="ALL">Semua Periode</option>
              {availablePeriods.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleExportCSV}
              className="h-9 px-3.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
              <span>Ekspor CSV</span>
            </button>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="h-9 px-3.5 text-xs font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] rounded-lg inline-flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Penilaian</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 pt-2 border-t border-slate-100">
          {KPI_DIVISIONS.map((div) => {
            const active = div.key === activeDivision;
            const count = kpiEvaluations.filter((r) => r.division === div.key).length;
            return (
              <button
                key={div.key}
                type="button"
                onClick={() => {
                  onSelectDivision(div.key);
                  setSelectedRecordId('');
                }}
                className={`text-left px-3.5 py-2.5 rounded-lg border transition-colors ${
                  active
                    ? 'bg-[#0B4EA2] border-[#0B4EA2] text-white'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <div className="text-xs font-bold leading-snug">{div.label}</div>
                <div
                  className={`text-[11px] mt-0.5 font-mono tabular-nums ${
                    active ? 'text-blue-100' : 'text-slate-500'
                  }`}
                >
                  {count} evaluasi tercatat
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4-Card KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Total Staf Dievaluasi</p>
          <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {summaryStats.totalCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">{divisionMeta.shortLabel}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Rata-rata Nilai Tertimbang</p>
          <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-[#0B4EA2]">
            {summaryStats.avg.toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-slate-500">Maksimal skor tiap KPI 120%</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Nilai Tertinggi</p>
          <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-700">
            {summaryStats.highest.toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-slate-500">Predikat ≥ 90% Sangat Baik</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Memenuhi Target (≥ 80%)</p>
          <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {summaryStats.goodCount}{' '}
            <span className="text-sm font-normal text-slate-500">
              / {summaryStats.totalCount}
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500">Kategori Baik / Sangat Baik</p>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="inline-flex bg-slate-200/70 p-1 rounded-xl gap-1">
        {[
          { id: 'lembar' as const, label: '1. Modul Job Description & Skoring KPI' },
          { id: 'rekap' as const, label: '2. Rekap Semua Staf Divisi' },
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

      {/* WORKSPACE (4th child inside KpiEvaluationView): MODUL JOB DESCRIPTION & KPI SKORING */}
      <div>
        {subTab === 'lembar' && (
          <div className="space-y-4">
            {/* Staff & Action Bar */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs font-semibold text-slate-700">Pilih Staf Dinilai:</label>
                <select
                  value={activeRecord?.id || ''}
                  onChange={(e) => setSelectedRecordId(e.target.value)}
                  className="h-9 px-3 text-xs font-semibold text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded-lg"
                >
                  {divisionRecords.map((rec) => (
                    <option key={rec.id} value={rec.id}>
                      {rec.employeeName} ({rec.branch} · {rec.periodLabel})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingJobdesk((v) => !v)}
                  className={`h-9 px-3 text-xs font-semibold border rounded-lg inline-flex items-center gap-1.5 ${
                    editingJobdesk
                      ? 'bg-blue-50 border-[#0B4EA2] text-[#0B4EA2]'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>{editingJobdesk ? 'Selesai Edit Jobdesk' : 'Edit Jobdesk'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditingIndicatorMeta((v) => !v)}
                  className={`h-9 px-3 text-xs font-semibold border rounded-lg inline-flex items-center gap-1.5 ${
                    editingIndicatorMeta
                      ? 'bg-blue-50 border-[#0B4EA2] text-[#0B4EA2]'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>{editingIndicatorMeta ? 'Selesai Edit Indikator' : 'Edit Indikator KPI'}</span>
                </button>
                {activeRecord && (() => {
                  const sum = computeKpiSummary(activeRecord, divisionIndicators);
                  return (
                    <button
                      type="button"
                      onClick={() =>
                        downloadKpiEvaluationPDF(
                          activeRecord,
                          divisionMeta.sheetTitle,
                          divisionJobItems,
                          divisionIndicators,
                          computeKpiItemScore,
                          sum.finalScore,
                          sum.predicate
                        )
                      }
                      className="h-9 px-3.5 text-xs font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] rounded-lg inline-flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Unduh PDF</span>
                    </button>
                  );
                })()}
              </div>
            </div>

            {activeRecord ? (() => {
              const sum = computeKpiSummary(activeRecord, divisionIndicators);
              return (
                <div className="bg-white border border-slate-300 rounded-xl overflow-hidden shadow-xs">
                  {/* Top Navy Header Banner matching uploaded sheet */}
                  <div className="bg-[#1B365D] text-white px-5 py-3 text-center">
                    <h3 className="text-sm sm:text-base font-bold tracking-wide">
                      MODUL KPI &amp; JOB DESCRIPTION — {divisionMeta.sheetTitle}
                    </h3>
                  </div>

                  {/* Periode Penilaian & Staff Metadata Strip */}
                  <div className="border-b border-slate-300 grid grid-cols-1 lg:grid-cols-12 text-xs">
                    <div className="lg:col-span-5 px-4 py-2.5 flex items-center justify-between gap-3 border-b lg:border-b-0 lg:border-r border-slate-200">
                      <span className="font-bold text-slate-800 whitespace-nowrap">
                        Nama Staf / Unit :
                      </span>
                      <div className="flex items-center gap-2 flex-1 justify-end">
                        <input
                          type="text"
                          value={activeRecord.employeeName}
                          onChange={(e) =>
                            handleRecordFieldUpdate(activeRecord.id, {
                              employeeName: e.target.value,
                            })
                          }
                          className="h-7 px-2 text-xs font-semibold text-blue-700 bg-[#EFF6FF] border border-slate-300 rounded w-48"
                        />
                        <select
                          value={activeRecord.branch}
                          onChange={(e) =>
                            handleRecordFieldUpdate(activeRecord.id, {
                              branch: e.target.value as BranchName,
                            })
                          }
                          className="h-7 px-2 text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-300 rounded"
                        >
                          {BRANCHES.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="lg:col-span-3 px-4 py-2.5 flex items-center gap-2 border-b lg:border-b-0 lg:border-r border-slate-200">
                      <span className="font-bold text-slate-800 whitespace-nowrap">Evaluator :</span>
                      <input
                        type="text"
                        value={activeRecord.evaluatorName}
                        onChange={(e) =>
                          handleRecordFieldUpdate(activeRecord.id, {
                            evaluatorName: e.target.value,
                          })
                        }
                        className="h-7 px-2 text-xs text-blue-700 bg-[#EFF6FF] border border-slate-300 rounded w-full"
                      />
                    </div>

                    <div className="lg:col-span-4 px-4 py-2.5 flex items-center gap-2 bg-[#EFF6FF]/60">
                      <span className="font-bold text-slate-900 whitespace-nowrap">
                        Periode Penilaian :
                      </span>
                      <input
                        type="text"
                        value={activeRecord.periodLabel}
                        onChange={(e) =>
                          handleRecordFieldUpdate(activeRecord.id, {
                            periodLabel: e.target.value,
                          })
                        }
                        placeholder="(isi: Bulan - Tahun)"
                        className="h-7 px-2.5 text-xs font-semibold text-blue-700 bg-[#EFF6FF] border border-blue-200 rounded w-full"
                      />
                    </div>
                  </div>

                  {/* SECTION A: JOB DESCRIPTION (URAIAN TUGAS POKOK) */}
                  <div className="bg-[#2B4C8C] text-white px-4 py-2 flex items-center justify-between">
                    <h4 className="text-xs sm:text-sm font-bold tracking-wide">
                      A. JOB DESCRIPTION (URAIAN TUGAS POKOK)
                    </h4>
                    {editingJobdesk && (
                      <button
                        type="button"
                        onClick={handleAddJobdeskItem}
                        className="px-2.5 py-1 text-[11px] font-semibold bg-white/15 hover:bg-white/25 rounded inline-flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Tambah Tugas</span>
                      </button>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <tbody className="divide-y divide-slate-200">
                        {divisionJobItems.map((job, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="w-10 px-3 py-2 text-center font-mono text-slate-700 border-r border-slate-200">
                              {idx + 1}
                            </td>
                            <td className="px-3.5 py-2 text-slate-900">
                              {editingJobdesk ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={job}
                                    onChange={(e) => handleUpdateJobdeskItem(idx, e.target.value)}
                                    className="w-full h-8 px-2.5 text-xs text-blue-800 bg-[#EFF6FF] border border-slate-300 rounded"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveJobdeskItem(idx)}
                                    title="Hapus baris tugas"
                                    className="p-1.5 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <span>{job}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* SECTION B: KEY PERFORMANCE INDICATOR (KPI) & SKORING */}
                  <div className="bg-[#2B4C8C] text-white px-4 py-2 mt-3 flex items-center justify-between">
                    <h4 className="text-xs sm:text-sm font-bold tracking-wide">
                      B. KEY PERFORMANCE INDICATOR (KPI) &amp; SKORING
                    </h4>
                    <span
                      className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded ${
                        totalDivisionWeight === 100
                          ? 'bg-emerald-900/50 text-emerald-200'
                          : 'bg-rose-900/60 text-rose-200'
                      }`}
                    >
                      Total Bobot: {totalDivisionWeight}%
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse border-b border-slate-300">
                      <thead>
                        <tr className="bg-[#34599E] text-white border-b border-[#24427A]">
                          <th className="px-2.5 py-2.5 text-center font-semibold w-10 border-r border-white/15">
                            No
                          </th>
                          <th className="px-3 py-2.5 font-semibold min-w-[180px] border-r border-white/15">
                            Indikator KPI
                          </th>
                          <th className="px-3 py-2.5 font-semibold min-w-[270px] border-r border-white/15">
                            Definisi / Cara Hitung Realisasi
                          </th>
                          <th className="px-2.5 py-2.5 text-center font-semibold w-24 border-r border-white/15">
                            Tipe
                          </th>
                          <th className="px-2.5 py-2.5 text-center font-semibold w-24 border-r border-white/15">
                            Bobot (%)
                          </th>
                          <th className="px-2.5 py-2.5 text-center font-semibold w-24 border-r border-white/15">
                            Target
                          </th>
                          <th className="px-2.5 py-2.5 text-center font-semibold w-20 border-r border-white/15">
                            Satuan
                          </th>
                          <th className="px-2.5 py-2.5 text-center font-semibold w-28 border-r border-white/15">
                            Realisasi
                            <div className="text-[10px] font-normal text-blue-100">
                              (diisi tiap periode)
                            </div>
                          </th>
                          <th className="px-2.5 py-2.5 text-center font-semibold w-28 border-r border-white/15">
                            Skor
                            <div className="text-[10px] font-normal text-blue-100">
                              Pencapaian (%)
                            </div>
                          </th>
                          <th className="px-2.5 py-2.5 text-center font-semibold w-28">
                            Nilai
                            <div className="text-[10px] font-normal text-blue-100">
                              Tertimbang (%)
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {divisionIndicators.map((ind, idx) => {
                          const realVal = activeRecord.scores[ind.code];
                          const calc = computeKpiItemScore(ind, realVal);
                          return (
                            <tr key={ind.code} className="hover:bg-slate-50/70 align-middle">
                              <td className="px-2.5 py-3 text-center font-mono text-slate-700 border-r border-slate-200">
                                {idx + 1}
                              </td>
                              <td className="px-3 py-3 font-bold text-slate-900 border-r border-slate-200">
                                {editingIndicatorMeta ? (
                                  <input
                                    type="text"
                                    value={ind.kpiName}
                                    onChange={(e) =>
                                      handleUpdateIndicator(ind.code, { kpiName: e.target.value })
                                    }
                                    className="w-full h-8 px-2 text-xs font-semibold text-blue-800 bg-[#EFF6FF] border border-slate-300 rounded"
                                  />
                                ) : (
                                  <span>{ind.kpiName}</span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-slate-700 leading-relaxed border-r border-slate-200">
                                {editingIndicatorMeta ? (
                                  <textarea
                                    rows={2}
                                    value={ind.definition}
                                    onChange={(e) =>
                                      handleUpdateIndicator(ind.code, {
                                        definition: e.target.value,
                                      })
                                    }
                                    className="w-full p-1.5 text-xs text-blue-800 bg-[#EFF6FF] border border-slate-300 rounded"
                                  />
                                ) : (
                                  <span>{ind.definition}</span>
                                )}
                              </td>
                              <td className="px-2.5 py-3 text-center text-slate-800 font-medium border-r border-slate-200">
                                {editingIndicatorMeta ? (
                                  <select
                                    value={ind.type}
                                    onChange={(e) =>
                                      handleUpdateIndicator(ind.code, {
                                        type: e.target.value as KpiType,
                                      })
                                    }
                                    className="h-8 px-1.5 text-xs text-blue-800 bg-[#EFF6FF] border border-slate-300 rounded"
                                  >
                                    <option value="Maximize">Maximize</option>
                                    <option value="Minimize">Minimize</option>
                                  </select>
                                ) : (
                                  <span>{ind.type}</span>
                                )}
                              </td>
                              {/* Bobot (%) - Cream Editable */}
                              <td className="px-2 py-2 text-center bg-[#EFF6FF] border-r border-slate-200">
                                <div className="inline-flex items-center justify-center gap-0.5">
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={ind.weight}
                                    onChange={(e) =>
                                      handleUpdateIndicator(ind.code, {
                                        weight: Math.max(0, Number(e.target.value) || 0),
                                      })
                                    }
                                    className="w-12 h-7 text-right font-mono font-semibold text-xs text-blue-700 bg-transparent border border-blue-200 rounded px-1 focus:outline-none focus:bg-white"
                                  />
                                  <span className="text-xs font-mono text-blue-700">%</span>
                                </div>
                              </td>
                              {/* Target - Cream Editable */}
                              <td className="px-2 py-2 text-center bg-[#EFF6FF] border-r border-slate-200">
                                <div className="inline-flex items-center justify-center gap-0.5">
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.1"
                                    value={ind.target}
                                    onChange={(e) =>
                                      handleUpdateIndicator(ind.code, {
                                        target: Math.max(0, Number(e.target.value) || 0),
                                      })
                                    }
                                    className="w-14 h-7 text-right font-mono font-semibold text-xs text-blue-700 bg-transparent border border-blue-200 rounded px-1 focus:outline-none focus:bg-white"
                                  />
                                  {ind.unit === '%' && (
                                    <span className="text-xs font-mono text-blue-700">%</span>
                                  )}
                                </div>
                              </td>
                              {/* Satuan */}
                              <td className="px-2.5 py-3 text-center text-slate-800 border-r border-slate-200">
                                {editingIndicatorMeta ? (
                                  <input
                                    type="text"
                                    value={ind.unit}
                                    onChange={(e) =>
                                      handleUpdateIndicator(ind.code, { unit: e.target.value })
                                    }
                                    className="w-16 h-7 px-1.5 text-center text-xs text-blue-800 bg-[#EFF6FF] border border-slate-300 rounded"
                                  />
                                ) : (
                                  <span>{ind.unit}</span>
                                )}
                              </td>
                              {/* Realisasi - Cream Editable */}
                              <td className="px-2 py-2 text-center bg-[#EFF6FF] border-r border-slate-200">
                                <div className="inline-flex items-center justify-center gap-0.5">
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.1"
                                    value={realVal ?? ''}
                                    placeholder="—"
                                    onChange={(e) =>
                                      handleRealizationUpdate(
                                        activeRecord.id,
                                        ind.code,
                                        e.target.value
                                      )
                                    }
                                    className="w-14 h-7 text-right font-mono font-semibold text-xs text-blue-700 bg-transparent border border-blue-200 rounded px-1 focus:outline-none focus:bg-white"
                                  />
                                  {ind.unit === '%' && realVal !== null && realVal !== undefined && (
                                    <span className="text-xs font-mono text-blue-700">%</span>
                                  )}
                                </div>
                              </td>
                              {/* Skor Pencapaian (%) */}
                              <td className="px-2.5 py-3 text-center font-mono tabular-nums text-slate-900 border-r border-slate-200">
                                {calc.achievement !== null ? `${calc.achievement.toFixed(1)}%` : '—'}
                              </td>
                              {/* Nilai Tertimbang (%) */}
                              <td className="px-2.5 py-3 text-center font-mono tabular-nums font-semibold text-slate-900">
                                {calc.weighted !== null ? `${calc.weighted.toFixed(1)}%` : '—'}
                              </td>
                            </tr>
                          );
                        })}

                        {/* TOTAL ROW */}
                        <tr className="bg-slate-200/80 font-bold text-slate-900 border-t-2 border-slate-400">
                          <td colSpan={4} className="px-3 py-2.5 text-right tracking-wide border-r border-slate-300">
                            TOTAL
                          </td>
                          <td
                            className={`px-2.5 py-2.5 text-center font-mono tabular-nums border-r border-slate-300 ${
                              totalDivisionWeight === 100 ? 'text-slate-900' : 'text-rose-700'
                            }`}
                          >
                            {totalDivisionWeight}%
                          </td>
                          <td colSpan={4} className="border-r border-slate-300" />
                          <td className="px-2.5 py-2.5 text-center font-mono tabular-nums text-slate-900">
                            {sum.finalScore !== null ? `${sum.finalScore.toFixed(1)}%` : '—'}
                          </td>
                        </tr>

                        {/* PREDIKAT PENCAPAIAN KPI ROW */}
                        <tr className="bg-white">
                          <td colSpan={7} className="px-3 py-2.5" />
                          <td
                            colSpan={2}
                            className="px-3 py-2.5 text-right font-bold text-slate-900 text-xs"
                          >
                            PREDIKAT PENCAPAIAN KPI
                          </td>
                          <td
                            className={`px-2.5 py-2.5 text-center font-bold text-xs tracking-wide ${
                              sum.predicate === 'SANGAT BAIK'
                                ? 'text-rose-600'
                                : sum.predicate === 'BAIK'
                                ? 'text-emerald-700'
                                : sum.predicate === 'CUKUP'
                                ? 'text-amber-700'
                                : sum.predicate === 'PERLU PEMBINAAN'
                                ? 'text-rose-700'
                                : 'text-slate-400'
                            }`}
                          >
                            {sum.predicate}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Explanatory Footnotes + Evaluator Notes */}
                  <div className="px-4 py-3.5 bg-slate-50/70 space-y-3">
                    <ul className="space-y-1 text-[11px] italic text-slate-600">
                      <li>
                        • Keterangan Tipe Indikator: &ldquo;Maximize&rdquo; = semakin tinggi realisasi
                        semakin baik (Skor = Realisasi/Target, maks 120%). &ldquo;Minimize&rdquo; =
                        semakin rendah realisasi semakin baik (Skor = Target/Realisasi, maks 120%).
                      </li>
                      <li>
                        • Kolom berwarna kuning (Bobot, Target, Realisasi) adalah kolom input yang
                        wajib disesuaikan setiap periode penilaian oleh atasan langsung/HR.
                      </li>
                      <li>
                        • Nilai Realisasi bawaan dapat disesuaikan dengan data aktual periode berjalan
                        masing-masing staf.
                      </li>
                      <li>• Total Bobot pada setiap jabatan harus selalu berjumlah 100%.</li>
                    </ul>

                    <div className="pt-2 border-t border-slate-200">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Catatan Evaluator &amp; Rencana Tindak Lanjut
                      </label>
                      <textarea
                        rows={2}
                        value={activeRecord.notes}
                        onChange={(e) =>
                          handleRecordFieldUpdate(activeRecord.id, { notes: e.target.value })
                        }
                        placeholder="Tuliskan umpan balik performa, target perbaikan, atau rekomendasi insentif KPI..."
                        className="w-full p-2.5 text-xs text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                </div>
              );
            })() : (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-500">
                Belum ada evaluasi pada divisi ini. Klik &ldquo;Tambah Penilaian&rdquo; untuk memulai.
              </div>
            )}
          </div>
        )}

        {/* SUBTAB 2: REKAP SEMUA STAF DIVISI */}
        {subTab === 'rekap' && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-900">
                Rekap Penilaian Staf — {divisionMeta.label}
              </h3>
              <p className="text-xs text-slate-500">
                Ringkasan realisasi tiap indikator, total nilai tertimbang (%), serta predikat
                pencapaian KPI seluruh staf pada divisi ini.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#1B365D] text-white">
                    <th className="px-3 py-2.5 font-semibold sticky left-0 bg-[#1B365D] z-10 min-w-[180px]">
                      Nama Staf &amp; Cabang
                    </th>
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Periode</th>
                    {divisionIndicators.map((ind) => (
                      <th
                        key={ind.code}
                        className="px-2.5 py-2.5 font-semibold min-w-[140px] max-w-[175px] border-l border-white/15 align-top"
                      >
                        <div className="flex items-center justify-between gap-1 font-mono text-[11px] text-blue-200">
                          <span>{ind.code} ({ind.type})</span>
                          <span>{ind.weight}%</span>
                        </div>
                        <div className="text-[11px] font-medium text-white leading-snug mt-0.5 whitespace-normal">
                          {ind.kpiName}
                        </div>
                        <div className="text-[10px] font-mono text-blue-200 mt-0.5">
                          Target: {formatTargetOrRealization(ind.target, ind.unit)} {ind.unit !== '%' ? ind.unit : ''}
                        </div>
                      </th>
                    ))}
                    <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap border-l border-white/15">
                      Nilai Tertimbang
                    </th>
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Predikat KPI</th>
                    <th className="px-3 py-2.5 font-semibold min-w-[180px]">Catatan Evaluator</th>
                    <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {divisionRecords.map((rec) => {
                    const sum = computeKpiSummary(rec, divisionIndicators);
                    return (
                      <tr key={rec.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2.5 sticky left-0 bg-white border-r border-slate-200 z-10">
                          <div className="font-semibold text-slate-900">{rec.employeeName}</div>
                          <div className="text-[11px] text-slate-500">
                            {rec.branch} · {formatDateID(rec.evaluatedDate)}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-700 whitespace-nowrap">
                          {rec.periodLabel}
                        </td>
                        {divisionIndicators.map((ind) => {
                          const val = rec.scores[ind.code];
                          const calc = computeKpiItemScore(ind, val);
                          return (
                            <td
                              key={ind.code}
                              className="px-2.5 py-2 border-l border-slate-100 text-center"
                            >
                              <input
                                type="number"
                                min={0}
                                step="0.1"
                                value={val ?? ''}
                                onChange={(e) =>
                                  handleRealizationUpdate(rec.id, ind.code, e.target.value)
                                }
                                placeholder="Realisasi"
                                className="w-16 h-7 text-center font-mono font-bold text-xs text-blue-700 bg-[#EFF6FF] border border-slate-300 rounded"
                              />
                              <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                                Skor: {calc.achievement !== null ? `${calc.achievement.toFixed(1)}%` : '—'}
                              </div>
                            </td>
                          );
                        })}
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums font-bold text-[#0B4EA2] border-l border-slate-200 whitespace-nowrap">
                          {sum.finalScore !== null ? `${sum.finalScore.toFixed(1)}%` : '—'}
                        </td>
                        <td
                          className={`px-3 py-2.5 font-bold whitespace-nowrap ${
                            sum.predicate === 'SANGAT BAIK'
                              ? 'text-rose-600'
                              : sum.predicate === 'BAIK'
                              ? 'text-emerald-700'
                              : sum.predicate === 'CUKUP'
                              ? 'text-amber-700'
                              : sum.predicate === 'PERLU PEMBINAAN'
                              ? 'text-rose-700'
                              : 'text-slate-400'
                          }`}
                        >
                          {sum.predicate}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={rec.notes}
                            onChange={(e) =>
                              handleRecordFieldUpdate(rec.id, { notes: e.target.value })
                            }
                            placeholder="Catatan evaluasi..."
                            className="w-full h-8 px-2 text-xs text-blue-900 bg-[#EFF6FF] border border-slate-300 rounded"
                          />
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedRecordId(rec.id);
                                setSubTab('lembar');
                              }}
                              className="px-2 py-1 text-[11px] font-semibold text-[#0B4EA2] hover:bg-blue-50 rounded"
                            >
                              Buka Lembar
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                downloadKpiEvaluationPDF(
                                  rec,
                                  divisionMeta.sheetTitle,
                                  divisionJobItems,
                                  divisionIndicators,
                                  computeKpiItemScore,
                                  sum.finalScore,
                                  sum.predicate
                                )
                              }
                              title="Unduh Rapor KPI PDF"
                              className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteRecord(rec.id)}
                              title="Hapus evaluasi"
                              className="p-1.5 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {divisionRecords.length === 0 && (
                    <tr>
                      <td
                        colSpan={divisionIndicators.length + 6}
                        className="px-4 py-10 text-center text-slate-500"
                      >
                        Belum ada data evaluasi untuk {divisionMeta.label}. Klik &ldquo;Tambah
                        Penilaian&rdquo; untuk memulai.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* MODAL: TAMBAH EVALUASI KPI */}
      {addOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setAddOpen(false);
          }}
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleCreateEvaluation}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-slate-900">
                Tambah {divisionMeta.label}
              </h3>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                title="Tutup"
                className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Pilih Staf / Kru dari Database (Opsional)
              </label>
              <select
                value={selectedEmpId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedEmpId(id);
                  const found = employees.find((emp) => emp.id === id);
                  if (found) {
                    setManualName(found.name);
                    setManualBranch(found.branch);
                  }
                }}
                className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg"
              >
                <option value="">-- Input Nama Manual --</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} ({emp.branch} · {emp.position})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nama Staf yang Dinilai
              </label>
              <input
                type="text"
                required
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Nama lengkap staf / kepala outlet"
                className="w-full h-9 px-3 text-sm bg-[#EFF6FF] border border-slate-300 rounded-lg"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Cabang / Unit
                </label>
                <select
                  value={manualBranch}
                  onChange={(e) => setManualBranch(e.target.value as BranchName)}
                  className="w-full h-9 px-3 text-sm bg-[#EFF6FF] border border-slate-300 rounded-lg"
                >
                  {BRANCHES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Periode Penilaian
                </label>
                <input
                  type="text"
                  required
                  value={manualPeriod}
                  onChange={(e) => setManualPeriod(e.target.value)}
                  placeholder="Oktober 2026"
                  className="w-full h-9 px-3 text-sm bg-[#EFF6FF] border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Evaluator
                </label>
                <input
                  type="text"
                  required
                  value={manualEvaluator}
                  onChange={(e) => setManualEvaluator(e.target.value)}
                  className="w-full h-9 px-3 text-sm bg-[#EFF6FF] border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tanggal Evaluasi
                </label>
                <input
                  type="date"
                  required
                  value={manualDate}
                  onChange={(e) => setManualDate(e.target.value)}
                  className="w-full h-9 px-3 text-sm bg-[#EFF6FF] border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="h-9 px-4 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
              >
                Batal
              </button>
              <button
                type="submit"
                className="h-9 px-4 text-xs font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] rounded-lg inline-flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Simpan Evaluasi</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
