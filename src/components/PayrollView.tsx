import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Lock,
  Mail,
  Plus,
  Search,
  Send,
  X,
} from 'lucide-react';
import {
  Employee,
  HoldingIncentiveEntry,
  PayrollEntry,
  PayrollPeriod,
  PayslipDispatchLog,
} from '../types/hc';
import {
  formatRupiah,
  recalculateHoldingIncentive,
  recalculatePayrollEntry,
} from '../utils/calculations';
import {
  downloadPayslipPDF,
  exportPayrollExcel,
  getPayslipPDFBase64,
} from '../utils/pdfGenerator';
import { GoogleSignInButton } from './GoogleSignInButton';

interface PayrollViewProps {
  periods: PayrollPeriod[];
  employees: Employee[];
  dispatchLogs: PayslipDispatchLog[];
  authToken: string;
  gmailToken: string | null;
  gmailUserEmail: string | null;
  readOnly?: boolean;
  initialFocusEmployeeId?: string | null;
  onConnectGmail: () => Promise<void>;
  onDisconnectGmail: () => Promise<void>;
  onSavePeriods: (next: PayrollPeriod[]) => Promise<void>;
  onRefreshState: () => Promise<void>;
}

type PayrollSubTab = 'utama' | 'holding' | 'riwayat';

export const PayrollView: React.FC<PayrollViewProps> = ({
  periods,
  employees,
  dispatchLogs,
  authToken,
  gmailToken,
  gmailUserEmail,
  readOnly = false,
  initialFocusEmployeeId,
  onConnectGmail,
  onDisconnectGmail,
  onSavePeriods,
  onRefreshState,
}) => {
  const [activePeriodId, setActivePeriodId] = useState<string>(periods[0]?.id || '');
  const [subTab, setSubTab] = useState<PayrollSubTab>('utama');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [saving, setSaving] = useState(false);

  const activePeriod = useMemo(
    () => periods.find((p) => p.id === activePeriodId) || periods[0],
    [periods, activePeriodId]
  );

  // Slip preview modal
  const [previewEntry, setPreviewEntry] = useState<PayrollEntry | null>(() => {
    if (initialFocusEmployeeId && activePeriod) {
      return activePeriod.entries.find((e) => e.employeeId === initialFocusEmployeeId) || null;
    }
    return null;
  });

  // New Period modal
  const [newPeriodOpen, setNewPeriodOpen] = useState(false);
  const [newPeriodLabel, setNewPeriodLabel] = useState('November 2026');

  // Mandatory Explicit Confirmation Modal before sending emails via Gmail API
  const [confirmTargets, setConfirmTargets] = useState<PayrollEntry[] | null>(null);
  const [finalizeAfterConfirm, setFinalizeAfterConfirm] = useState(false);
  const [sendingProgress, setSendingProgress] = useState<{
    active: boolean;
    current: number;
    total: number;
    currentName: string;
    results: Array<{ name: string; email: string; ok: boolean; msg: string }>;
  } | null>(null);
  const [gmailError, setGmailError] = useState<string | null>(null);

  const positionByEmployeeId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const emp of employees) {
      map[emp.id] = emp.position;
    }
    return map;
  }, [employees]);

  const filteredEntries = useMemo(() => {
    if (!activePeriod) return [];
    const q = search.trim().toLowerCase();
    return activePeriod.entries.filter((e) => {
      if (branchFilter !== 'ALL' && e.branch !== branchFilter) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.branch.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        e.bank.toLowerCase().includes(q)
      );
    });
  }, [activePeriod, search, branchFilter]);

  const totals = useMemo(() => {
    if (!activePeriod) {
      return {
        totalNet: 0,
        totalLembur: 0,
        totalTraining: 0,
        totalPotongan: 0,
        sentCount: 0,
      };
    }
    return activePeriod.entries.reduce(
      (acc, e) => {
        acc.totalNet += e.totalGaji;
        acc.totalLembur += e.uangLembur;
        acc.totalTraining += e.uangTraining;
        acc.totalPotongan +=
          e.potonganSelisih +
          e.potonganKetidakhadiran +
          e.potonganKasbon +
          e.potonganKeterlambatan;
        if (e.slipStatus === 'Terkirim') acc.sentCount += 1;
        return acc;
      },
      { totalNet: 0, totalLembur: 0, totalTraining: 0, totalPotongan: 0, sentCount: 0 }
    );
  }, [activePeriod]);

  const updatePeriod = async (updater: (p: PayrollPeriod) => PayrollPeriod) => {
    if (readOnly || !activePeriod) return;
    setSaving(true);
    try {
      const next = periods.map((p) => (p.id === activePeriod.id ? updater(p) : p));
      await onSavePeriods(next);
    } finally {
      setSaving(false);
    }
  };

  const handleEntryFieldChange = (
    entryId: string,
    patch: Partial<PayrollEntry>
  ) => {
    if (readOnly || !activePeriod || activePeriod.status === 'Finalized') return;
    updatePeriod((p) => ({
      ...p,
      entries: p.entries.map((item) =>
        item.id === entryId
          ? recalculatePayrollEntry(
              { ...item, ...patch },
              p.gajiHarianStandar,
              p.uangTrainingPerHari
            )
          : item
      ),
    }));
  };

  const handleHoldingFieldChange = (
    itemId: string,
    patch: Partial<HoldingIncentiveEntry>
  ) => {
    if (readOnly || !activePeriod || activePeriod.status === 'Finalized') return;
    updatePeriod((p) => ({
      ...p,
      holdingIncentives: p.holdingIncentives.map((h) =>
        h.id === itemId ? recalculateHoldingIncentive({ ...h, ...patch }) : h
      ),
    }));
  };

  const handleCreatePeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || !newPeriodLabel.trim()) return;
    const gajiHarian = activePeriod?.gajiHarianStandar || 54000;
    const trainingHarian = activePeriod?.uangTrainingPerHari || 15000;

    const entries: PayrollEntry[] = employees
      .filter((emp) => emp.status !== 'Non-Aktif')
      .map((emp, idx) =>
        recalculatePayrollEntry(
          {
            id: `pay-${Date.now()}-${idx}`,
            employeeId: emp.id,
            name: emp.name,
            email: emp.email,
            branch: emp.branch,
            hariKerja: 26,
            izinSakit: 0,
            gajiPokokDasar: emp.baseSalary,
            gajiPokokDibayar: emp.baseSalary,
            payMode: emp.payMode,
            insentifPenjualan: 0,
            jumlahHariLembur: 0,
            uangLembur: 0,
            jumlahHariTraining: 0,
            uangTraining: 0,
            potonganSelisih: 0,
            potonganKetidakhadiran: 0,
            potonganKasbon: 0,
            potonganKeterlambatan: 0,
            totalGaji: emp.baseSalary,
            rekening: emp.bankAccount,
            bank: emp.bankName,
            slipStatus: 'Belum Dikirim',
          },
          gajiHarian,
          trainingHarian
        )
      );

    const holdingIncentives: HoldingIncentiveEntry[] = employees
      .filter((emp) => emp.branch === 'Holding' && emp.status !== 'Non-Aktif')
      .map((emp, idx) =>
        recalculateHoldingIncentive({
          id: `hold-${Date.now()}-${idx}`,
          employeeId: emp.id,
          name: emp.name,
          branch: emp.branch,
          jabatan: emp.position,
          kpiPercent: 0,
          insentifKpi: 0,
          uangTransport: 0,
          insentifPenjualan: 0,
          bonusLainnya: 0,
          totalInsentif: 0,
        })
      );

    const created: PayrollPeriod = {
      id: `period-${Date.now()}`,
      label: newPeriodLabel.trim(),
      slipDateLabel: `Makassar, ${newPeriodLabel.trim()}`,
      status: 'Draft',
      gajiHarianStandar: gajiHarian,
      uangTrainingPerHari: trainingHarian,
      entries,
      holdingIncentives,
    };

    setSaving(true);
    try {
      await onSavePeriods([created, ...periods]);
      setActivePeriodId(created.id);
      setNewPeriodOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const requestSendEmails = (targets: PayrollEntry[], finalize = false) => {
    if (readOnly) return;
    setGmailError(null);
    const validTargets = targets.filter((t) => t.email && t.email.includes('@'));
    if (validTargets.length === 0) {
      setGmailError('Tidak ada kru dengan alamat email valid untuk dikirimkan slip gaji.');
      return;
    }
    setFinalizeAfterConfirm(finalize);
    setConfirmTargets(validTargets);
  };

  const executeConfirmedGmailSend = async () => {
    if (readOnly || !confirmTargets || !activePeriod) return;
    if (!gmailToken) {
      setGmailError('Silakan hubungkan akun Google (Gmail) terlebih dahulu.');
      return;
    }

    const targets = [...confirmTargets];
    setConfirmTargets(null);

    if (finalizeAfterConfirm && activePeriod.status !== 'Finalized') {
      await updatePeriod((p) => ({
        ...p,
        status: 'Finalized',
        finalizedAt: new Date().toISOString(),
      }));
    }

    const results: Array<{ name: string; email: string; ok: boolean; msg: string }> = [];
    setSendingProgress({
      active: true,
      current: 0,
      total: targets.length,
      currentName: targets[0]?.name || '',
      results: [],
    });

    for (let i = 0; i < targets.length; i++) {
      const entry = targets[i];
      setSendingProgress({
        active: true,
        current: i + 1,
        total: targets.length,
        currentName: entry.name,
        results: [...results],
      });

      try {
        const pdfBase64 = getPayslipPDFBase64(entry, activePeriod);
        const safeName = entry.name.replace(/[^a-zA-Z0-9]+/g, '_');
        const safePeriod = activePeriod.label.replace(/[^a-zA-Z0-9]+/g, '_');
        const fileName = `Slip_Gaji_${safeName}_${safePeriod}.pdf`;
        const subject = `Slip Gaji Kopi Tuju — ${activePeriod.label} (${entry.name})`;
        const htmlBody = `
          <div style="font-family: Arial, sans-serif; color: #1c1917; max-width: 560px; line-height: 1.6;">
            <h2 style="margin-bottom: 4px; color: #0B4EA2;">Slip Gaji Toko Kopi Tuju</h2>
            <p style="margin-top: 0; color: #57534e; font-size: 13px;">Periode: <strong>${activePeriod.label}</strong></p>
            <p>Halo <strong>${entry.name}</strong>,</p>
            <p>Terlampir adalah Slip Gaji resmi Anda untuk periode <strong>${activePeriod.label}</strong> (Cabang ${entry.branch}).</p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px;">
              <tr><td style="padding: 6px 0; border-bottom: 1px solid #e7e5e4;">Hari Kerja</td><td style="text-align: right; border-bottom: 1px solid #e7e5e4;"><strong>${entry.hariKerja} hari</strong></td></tr>
              <tr><td style="padding: 6px 0; border-bottom: 1px solid #e7e5e4;">Gaji Pokok</td><td style="text-align: right; border-bottom: 1px solid #e7e5e4;">${formatRupiah(entry.gajiPokokDibayar)}</td></tr>
              <tr><td style="padding: 6px 0; border-bottom: 1px solid #e7e5e4;">Uang Lembur + Training + Insentif</td><td style="text-align: right; border-bottom: 1px solid #e7e5e4;">${formatRupiah(entry.uangLembur + entry.uangTraining + entry.insentifPenjualan)}</td></tr>
              <tr><td style="padding: 6px 0; border-bottom: 1px solid #e7e5e4;">Total Potongan</td><td style="text-align: right; border-bottom: 1px solid #e7e5e4;">${formatRupiah(entry.potonganSelisih + entry.potonganKetidakhadiran + entry.potonganKasbon + entry.potonganKeterlambatan)}</td></tr>
              <tr><td style="padding: 10px 0; font-size: 15px;"><strong>Total Gaji Diterima</strong></td><td style="text-align: right; padding: 10px 0; font-size: 15px;"><strong>${formatRupiah(entry.totalGaji)}</strong></td></tr>
            </table>
            <p style="font-size: 12px; color: #57534e;">Detail lengkap tersedia pada lampiran PDF. Jika terdapat pertanyaan terkait rincian gaji, silakan hubungi Pengelola HC Toko Kopi Tuju.</p>
            <p style="font-size: 12px; color: #1c1917; margin-top: 20px;">Salam hangat,<br/><strong>Manager HC — Toko Kopi Tuju</strong></p>
          </div>
        `;

        const resp = await fetch('/api/gmail/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
            'X-Gmail-Token': gmailToken,
          },
          body: JSON.stringify({
            periodId: activePeriod.id,
            entryId: entry.id,
            employeeId: entry.employeeId,
            employeeName: entry.name,
            toEmail: entry.email,
            subject,
            htmlBody,
            pdfBase64,
            fileName,
          }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          results.push({
            name: entry.name,
            email: entry.email,
            ok: false,
            msg: data.error || 'Gagal kirim',
          });
        } else {
          results.push({
            name: entry.name,
            email: entry.email,
            ok: true,
            msg: 'Terkirim',
          });
        }
      } catch (err) {
        results.push({
          name: entry.name,
          email: entry.email,
          ok: false,
          msg: err instanceof Error ? err.message : 'Network error',
        });
      }
    }

    setSendingProgress({
      active: false,
      current: targets.length,
      total: targets.length,
      currentName: 'Selesai',
      results,
    });
    await onRefreshState();
  };

  if (!activePeriod) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
        Belum ada periode payroll.
      </div>
    );
  }

  const isLocked = activePeriod.status === 'Finalized';
  const fieldDisabled = readOnly || isLocked;

  return (
    <div className="space-y-6">
      {readOnly && (
        <div className="px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs text-slate-700 flex items-center gap-2">
          <Lock className="w-3.5 h-3.5 text-slate-600 shrink-0" />
          <span>
            <strong className="text-slate-900">Mode Hanya Lihat:</strong> Anda dapat melihat rekap
            payroll, pratinjau/unduh PDF slip gaji, dan ekspor CSV, namun perubahan angka,
            finalisasi periode, atau pengiriman email hanya dapat dilakukan oleh Admin / Manager HC.
          </span>
        </div>
      )}

      {/* Gmail Connection & Period Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <label className="block text-[11px] font-medium text-slate-500">Periode Payroll</label>
            <select
              value={activePeriod.id}
              onChange={(e) => setActivePeriodId(e.target.value)}
              className="mt-0.5 h-9 px-3 text-xs font-bold bg-slate-50 border border-slate-300 rounded-lg"
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} · {p.status}
                </option>
              ))}
            </select>
          </div>

          <div className="text-xs text-slate-600 pl-3 border-l border-slate-200">
            <div>
              Gaji Harian: <span className="font-mono font-semibold text-slate-900">{formatRupiah(activePeriod.gajiHarianStandar)}</span>
            </div>
            <div>
              Uang Training/Hari: <span className="font-mono font-semibold text-slate-900">{formatRupiah(activePeriod.uangTrainingPerHari)}</span>
            </div>
          </div>

          {!readOnly && (
            <div className="pl-3 border-l border-slate-200">
              {gmailToken ? (
                <div className="flex items-center gap-2 text-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                  <div>
                    <p className="font-semibold text-slate-900">Gmail Terhubung</p>
                    <p className="text-[11px] text-slate-500">
                      {gmailUserEmail || 'Siap mengirim slip'} ·{' '}
                      <button
                        type="button"
                        onClick={onDisconnectGmail}
                        className="text-slate-700 underline hover:text-slate-900"
                      >
                        Putuskan
                      </button>
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2.5">
                  <GoogleSignInButton
                    onClick={onConnectGmail}
                    label="Hubungkan Gmail Pengelola"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {saving && <span className="text-xs text-amber-700 font-medium">Menyimpan...</span>}
          <button
            type="button"
            onClick={() => exportPayrollExcel(activePeriod)}
            className="h-9 px-3 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Export CSV (Excel)</span>
          </button>
          {!readOnly && (
            <>
              <button
                type="button"
                onClick={() => setNewPeriodOpen(true)}
                className="h-9 px-3 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Periode Baru</span>
              </button>

              {!isLocked ? (
                <button
                  type="button"
                  onClick={() => {
                    if (gmailToken) {
                      requestSendEmails(activePeriod.entries, true);
                    } else {
                      updatePeriod((p) => ({
                        ...p,
                        status: 'Finalized',
                        finalizedAt: new Date().toISOString(),
                      }));
                    }
                  }}
                  className="h-9 px-4 text-xs font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>
                    {gmailToken
                      ? 'Finalisasi & Kirim Semua Slip'
                      : 'Finalisasi Periode'}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => requestSendEmails(activePeriod.entries, false)}
                  disabled={!gmailToken}
                  className="h-9 px-4 text-xs font-semibold text-white bg-[#0F172A] hover:bg-slate-800 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap"
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>Kirim Semua Slip ke Email</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {gmailError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-medium text-red-800 flex items-center justify-between">
          <span>{gmailError}</span>
          <button type="button" onClick={() => setGmailError(null)} className="text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Total Payroll Bersih</p>
          <p className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900">
            {formatRupiah(totals.totalNet)}
          </p>
          <p className="mt-1 text-xs text-slate-500">{activePeriod.entries.length} kru &amp; staf</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Total Lembur &amp; Training</p>
          <p className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900">
            {formatRupiah(totals.totalLembur + totals.totalTraining)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Lembur {formatRupiah(totals.totalLembur)} · Training {formatRupiah(totals.totalTraining)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Total Potongan</p>
          <p className="mt-1 text-xl font-bold font-mono tabular-nums text-red-700">
            {formatRupiah(totals.totalPotongan)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Selisih, absen, kasbon, telat</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Distribusi Slip Gaji</p>
          <p className="mt-1 text-xl font-bold font-mono tabular-nums text-emerald-700">
            {totals.sentCount} / {activePeriod.entries.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Status Periode:{' '}
            <span className="font-semibold text-slate-800">{activePeriod.status}</span>
            {isLocked && ' (Terkunci)'}
          </p>
        </div>
      </div>

      {/* Sub-navigation & Search */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => setSubTab('utama')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              subTab === 'utama' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Rekap Payroll Utama
          </button>
          <button
            type="button"
            onClick={() => setSubTab('holding')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              subTab === 'holding' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Insentif Holding &amp; Staf ({activePeriod.holdingIncentives.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('riwayat')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              subTab === 'riwayat' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Riwayat Kirim Email ({dispatchLogs.length})
          </button>
        </div>

        {subTab === 'utama' && (
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly && isLocked && (
              <button
                type="button"
                onClick={() => updatePeriod((p) => ({ ...p, status: 'Draft' }))}
                className="h-8 px-2.5 text-[11px] font-semibold text-slate-600 border border-slate-300 rounded-lg inline-flex items-center gap-1 hover:bg-slate-50"
              >
                <Lock className="w-3 h-3" />
                <span>Buka Kunci Edit</span>
              </button>
            )}
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="h-8 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg"
            >
              <option value="ALL">Semua Cabang</option>
              <option value="Abdesir">Abdesir</option>
              <option value="Agus Salim">Agus Salim</option>
              <option value="Djemma">Djemma</option>
              <option value="Holding">Holding</option>
              <option value="Perintis">Perintis</option>
              <option value="Tamalate">Tamalate</option>
            </select>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari kru..."
                className="h-8 pl-8 pr-3 text-xs bg-slate-50 border border-slate-200 rounded-lg"
              />
            </div>
          </div>
        )}
      </div>

      {/* TAB 1: REKAP PAYROLL UTAMA */}
      {subTab === 'utama' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                  <th className="py-2.5 px-2.5">No.</th>
                  <th className="py-2.5 px-2.5 sticky left-0 bg-slate-50 z-10 min-w-[170px]">
                    Nama &amp; Email
                  </th>
                  <th className="py-2.5 px-2.5">Cabang</th>
                  <th className="py-2.5 px-2.5 whitespace-nowrap">Jabatan</th>
                  <th className="py-2.5 px-2 text-right whitespace-nowrap">Hari Kerja</th>
                  <th className="py-2.5 px-2 text-right whitespace-nowrap">Izin/Sakit</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Gaji Pokok</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Insentif Jual</th>
                  <th className="py-2.5 px-2 text-right whitespace-nowrap">Hari Lembur</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Uang Lembur</th>
                  <th className="py-2.5 px-2 text-right whitespace-nowrap">Hari Training</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Uang Training</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Pot. Selisih</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Pot. Absen</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Pot. Kasbon</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Pot. Telat</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Total Gaji</th>
                  <th className="py-2.5 px-2.5 whitespace-nowrap">Rekening · Bank</th>
                  <th className="py-2.5 px-2.5 whitespace-nowrap">Slip</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEntries.map((e, idx) => (
                  <tr key={e.id} className="hover:bg-slate-50/70">
                    <td className="py-2 px-2.5 font-mono text-slate-500">{idx + 1}</td>
                    <td className="py-2 px-2.5 sticky left-0 bg-white z-10">
                      <div className="font-semibold text-slate-900 whitespace-nowrap">{e.name}</div>
                      {readOnly ? (
                        <div className="w-40 mt-0.5 text-[10px] text-slate-500 truncate">
                          {e.email}
                        </div>
                      ) : (
                        <input
                          type="email"
                          disabled={fieldDisabled}
                          value={e.email}
                          onChange={(ev) =>
                            handleEntryFieldChange(e.id, { email: ev.target.value })
                          }
                          className="w-40 mt-0.5 text-[10px] text-slate-500 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-[#0B4EA2] focus:outline-none"
                        />
                      )}
                    </td>
                    <td className="py-2 px-2.5 whitespace-nowrap text-slate-700">{e.branch}</td>
                    <td className="py-2 px-2.5 whitespace-nowrap text-slate-700">
                      {positionByEmployeeId[e.employeeId] || '—'}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <input
                        type="number"
                        disabled={fieldDisabled}
                        min={0}
                        max={31}
                        value={e.hariKerja}
                        onChange={(ev) =>
                          handleEntryFieldChange(e.id, { hariKerja: Number(ev.target.value) })
                        }
                        className="w-12 h-7 px-1 text-right font-mono bg-[#EFF6FF] border border-slate-200 rounded disabled:bg-slate-50 disabled:text-slate-700"
                      />
                    </td>
                    <td className="py-2 px-2 text-right">
                      <input
                        type="number"
                        disabled={fieldDisabled}
                        min={0}
                        max={31}
                        value={e.izinSakit}
                        onChange={(ev) =>
                          handleEntryFieldChange(e.id, { izinSakit: Number(ev.target.value) })
                        }
                        className="w-12 h-7 px-1 text-right font-mono bg-[#EFF6FF] border border-slate-200 rounded disabled:bg-slate-50 disabled:text-slate-700"
                      />
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono tabular-nums font-medium whitespace-nowrap text-slate-900">
                      {formatRupiah(e.gajiPokokDibayar)}
                    </td>
                    <td className="py-2 px-2.5 text-right">
                      <input
                        type="number"
                        disabled={fieldDisabled}
                        min={0}
                        value={e.insentifPenjualan}
                        onChange={(ev) =>
                          handleEntryFieldChange(e.id, {
                            insentifPenjualan: Number(ev.target.value),
                          })
                        }
                        className="w-20 h-7 px-1.5 text-right font-mono bg-[#EFF6FF] border border-slate-200 rounded disabled:bg-slate-50 disabled:text-slate-700"
                      />
                    </td>
                    <td className="py-2 px-2 text-right">
                      <input
                        type="number"
                        disabled={fieldDisabled}
                        min={0}
                        value={e.jumlahHariLembur}
                        onChange={(ev) =>
                          handleEntryFieldChange(e.id, {
                            jumlahHariLembur: Number(ev.target.value),
                          })
                        }
                        className="w-12 h-7 px-1 text-right font-mono bg-[#EFF6FF] border border-slate-200 rounded disabled:bg-slate-50 disabled:text-slate-700"
                      />
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatRupiah(e.uangLembur)}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <input
                        type="number"
                        disabled={fieldDisabled}
                        min={0}
                        value={e.jumlahHariTraining}
                        onChange={(ev) =>
                          handleEntryFieldChange(e.id, {
                            jumlahHariTraining: Number(ev.target.value),
                          })
                        }
                        className="w-12 h-7 px-1 text-right font-mono bg-[#EFF6FF] border border-slate-200 rounded disabled:bg-slate-50 disabled:text-slate-700"
                      />
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatRupiah(e.uangTraining)}
                    </td>
                    <td className="py-2 px-2.5 text-right">
                      <input
                        type="number"
                        disabled={fieldDisabled}
                        min={0}
                        value={e.potonganSelisih}
                        onChange={(ev) =>
                          handleEntryFieldChange(e.id, {
                            potonganSelisih: Number(ev.target.value),
                          })
                        }
                        className="w-20 h-7 px-1.5 text-right font-mono bg-[#EFF6FF] border border-slate-200 rounded disabled:bg-slate-50 disabled:text-slate-700"
                      />
                    </td>
                    <td className="py-2 px-2.5 text-right">
                      <input
                        type="number"
                        disabled={fieldDisabled}
                        min={0}
                        value={e.potonganKetidakhadiran}
                        onChange={(ev) =>
                          handleEntryFieldChange(e.id, {
                            potonganKetidakhadiran: Number(ev.target.value),
                          })
                        }
                        className="w-20 h-7 px-1.5 text-right font-mono bg-[#EFF6FF] border border-slate-200 rounded disabled:bg-slate-50 disabled:text-slate-700"
                      />
                    </td>
                    <td className="py-2 px-2.5 text-right">
                      <input
                        type="number"
                        disabled={fieldDisabled}
                        min={0}
                        value={e.potonganKasbon}
                        onChange={(ev) =>
                          handleEntryFieldChange(e.id, {
                            potonganKasbon: Number(ev.target.value),
                          })
                        }
                        className="w-20 h-7 px-1.5 text-right font-mono bg-[#EFF6FF] border border-slate-200 rounded disabled:bg-slate-50 disabled:text-slate-700"
                      />
                    </td>
                    <td className="py-2 px-2.5 text-right">
                      <input
                        type="number"
                        disabled={fieldDisabled}
                        min={0}
                        value={e.potonganKeterlambatan}
                        onChange={(ev) =>
                          handleEntryFieldChange(e.id, {
                            potonganKeterlambatan: Number(ev.target.value),
                          })
                        }
                        className="w-20 h-7 px-1.5 text-right font-mono bg-[#EFF6FF] border border-slate-200 rounded disabled:bg-slate-50 disabled:text-slate-700"
                      />
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono tabular-nums font-bold text-slate-900 whitespace-nowrap">
                      {formatRupiah(e.totalGaji)}
                    </td>
                    <td className="py-2 px-2.5 whitespace-nowrap">
                      <div className="font-semibold text-slate-800">{e.bank}</div>
                      <div className="font-mono text-[10px] text-slate-500">{e.rekening}</div>
                    </td>
                    <td className="py-2 px-2.5 whitespace-nowrap">
                      <span
                        className={`font-semibold ${
                          e.slipStatus === 'Terkirim'
                            ? 'text-emerald-700'
                            : e.slipStatus === 'Gagal'
                            ? 'text-red-700'
                            : 'text-slate-500'
                        }`}
                      >
                        {e.slipStatus || 'Belum Dikirim'}
                      </span>
                    </td>
                    <td className="py-2 px-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setPreviewEntry(e)}
                          className="px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 rounded"
                        >
                          Slip
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadPayslipPDF(e, activePeriod)}
                          title="Download PDF Slip Gaji"
                          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => requestSendEmails([e], false)}
                            disabled={!gmailToken}
                            title={
                              gmailToken
                                ? `Kirim slip ke ${e.email}`
                                : 'Hubungkan Gmail terlebih dahulu'
                            }
                            className="p-1.5 text-[#0B4EA2] hover:bg-blue-50 rounded disabled:opacity-35"
                          >
                            <Mail className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: REKAP INSENTIF HOLDING & STAF */}
      {subTab === 'holding' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200">
            <h3 className="text-sm font-bold text-slate-900">
              Rekap Insentif Holding &amp; Staf Operasional
            </h3>
            <p className="text-xs text-slate-500">
              Format rincian KPI, Insentif KPI, Uang Transport, Insentif Penjualan, dan Bonus lainnya.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-3">No.</th>
                  <th className="py-2.5 px-3">Nama</th>
                  <th className="py-2.5 px-3">Cabang</th>
                  <th className="py-2.5 px-3">Jabatan</th>
                  <th className="py-2.5 px-3 text-right">KPI (%)</th>
                  <th className="py-2.5 px-3 text-right">Insentif KPI</th>
                  <th className="py-2.5 px-3 text-right">Uang Transport</th>
                  <th className="py-2.5 px-3 text-right">Insentif Penjualan</th>
                  <th className="py-2.5 px-3 text-right">Bonus Lainnya</th>
                  <th className="py-2.5 px-3 text-right">Total Insentif</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activePeriod.holdingIncentives.map((h, idx) => (
                  <tr key={h.id}>
                    <td className="py-2 px-3 font-mono text-slate-500">{idx + 1}</td>
                    <td className="py-2 px-3 font-semibold text-slate-900">{h.name}</td>
                    <td className="py-2 px-3 text-slate-700">{h.branch}</td>
                    <td className="py-2 px-3 text-slate-700">{h.jabatan}</td>
                    <td className="py-2 px-3 text-right">
                      <input
                        type="number"
                        disabled={fieldDisabled}
                        value={h.kpiPercent}
                        onChange={(e) =>
                          handleHoldingFieldChange(h.id, { kpiPercent: Number(e.target.value) })
                        }
                        className="w-16 h-8 px-2 text-right font-mono bg-[#EFF6FF] border border-slate-200 rounded disabled:bg-slate-50 disabled:text-slate-700"
                      />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <input
                        type="number"
                        disabled={fieldDisabled}
                        value={h.insentifKpi}
                        onChange={(e) =>
                          handleHoldingFieldChange(h.id, { insentifKpi: Number(e.target.value) })
                        }
                        className="w-24 h-8 px-2 text-right font-mono bg-[#EFF6FF] border border-slate-200 rounded disabled:bg-slate-50 disabled:text-slate-700"
                      />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <input
                        type="number"
                        disabled={fieldDisabled}
                        value={h.uangTransport}
                        onChange={(e) =>
                          handleHoldingFieldChange(h.id, { uangTransport: Number(e.target.value) })
                        }
                        className="w-24 h-8 px-2 text-right font-mono bg-[#EFF6FF] border border-slate-200 rounded disabled:bg-slate-50 disabled:text-slate-700"
                      />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <input
                        type="number"
                        disabled={fieldDisabled}
                        value={h.insentifPenjualan}
                        onChange={(e) =>
                          handleHoldingFieldChange(h.id, {
                            insentifPenjualan: Number(e.target.value),
                          })
                        }
                        className="w-24 h-8 px-2 text-right font-mono bg-[#EFF6FF] border border-slate-200 rounded disabled:bg-slate-50 disabled:text-slate-700"
                      />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <input
                        type="number"
                        disabled={fieldDisabled}
                        value={h.bonusLainnya}
                        onChange={(e) =>
                          handleHoldingFieldChange(h.id, { bonusLainnya: Number(e.target.value) })
                        }
                        className="w-24 h-8 px-2 text-right font-mono bg-[#EFF6FF] border border-slate-200 rounded disabled:bg-slate-50 disabled:text-slate-700"
                      />
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                      {formatRupiah(h.totalInsentif)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: RIWAYAT PENGIRIMAN EMAIL */}
      {subTab === 'riwayat' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200">
            <h3 className="text-sm font-bold text-slate-900">
              Riwayat Pengiriman Slip Gaji Otomatis via Gmail
            </h3>
          </div>
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-4">Waktu</th>
                <th className="py-2.5 px-4">Periode</th>
                <th className="py-2.5 px-4">Kru / Staf</th>
                <th className="py-2.5 px-4">Email Tujuan</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Keterangan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dispatchLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Belum ada pengiriman slip gaji ke email kru.
                  </td>
                </tr>
              ) : (
                dispatchLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString('id-ID')}
                    </td>
                    <td className="py-2.5 px-4">{log.periodLabel}</td>
                    <td className="py-2.5 px-4 font-semibold text-slate-900">{log.employeeName}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-600">{log.email}</td>
                    <td className="py-2.5 px-4 font-semibold">
                      <span
                        className={
                          log.status === 'Terkirim' ? 'text-emerald-700' : 'text-red-700'
                        }
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">{log.message}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* SLIP GAJI PREVIEW MODAL (EXACT FORMAT FROM IMAGE 2) */}
      {previewEntry && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreviewEntry(null);
          }}
          className="fixed inset-0 z-50 bg-slate-950/45 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-300 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-900">Pratinjau Slip Gaji Resmi</h3>
              <button
                type="button"
                onClick={() => setPreviewEntry(null)}
                className="p-1 text-slate-500 hover:text-slate-900 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 border-2 border-slate-900 p-5 text-xs bg-white">
              <div className="text-center font-bold text-sm tracking-wide pb-3 border-b-2 border-slate-900">
                <div>SLIP GAJI</div>
                <div>KOPI TUJU</div>
              </div>

              <div className="mt-3 space-y-1.5">
                {[
                  ['NAMA', previewEntry.name, true],
                  ['CABANG', previewEntry.branch, false],
                  ['PERIODE', activePeriod.label, false],
                  ['HARI KERJA', String(previewEntry.hariKerja), false],
                  ['IZIN/SAKIT', String(previewEntry.izinSakit), false],
                ].map(([k, v, bold]) => (
                  <div key={String(k)} className="flex justify-between">
                    <span className="font-semibold text-slate-700">{k}</span>
                    <span className={`font-mono ${bold ? 'font-bold text-slate-900' : ''}`}>
                      {v}
                    </span>
                  </div>
                ))}
              </div>

              <div className="my-3 border-t border-slate-200 pt-2.5 space-y-1.5">
                {[
                  ['GAJI POKOK', formatRupiah(previewEntry.gajiPokokDibayar)],
                  ['INSENTIF PENJUALAN', formatRupiah(previewEntry.insentifPenjualan)],
                  ['UANG LEMBUR', formatRupiah(previewEntry.uangLembur)],
                  ['UANG TRAINING', formatRupiah(previewEntry.uangTraining)],
                  ['POTONGAN (SELISIH)', formatRupiah(previewEntry.potonganSelisih)],
                  ['POTONGAN (KETIDAKHADIRAN)', formatRupiah(previewEntry.potonganKetidakhadiran)],
                  ['POTONGAN (KASBON)', formatRupiah(previewEntry.potonganKasbon)],
                  ['POTONGAN (KETERLAMBATAN)', formatRupiah(previewEntry.potonganKeterlambatan)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-slate-700">{k}</span>
                    <span className="font-mono tabular-nums">{v}</span>
                  </div>
                ))}
              </div>

              <div className="border-t-2 border-slate-900 pt-2 flex justify-between font-bold text-sm">
                <span>TOTAL GAJI</span>
                <span className="font-mono tabular-nums">
                  {formatRupiah(previewEntry.totalGaji)}
                </span>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-200 text-[11px] space-y-1 text-slate-700">
                <p className="font-bold">KETERANGAN:</p>
                <div className="flex justify-between">
                  <span>1. GAJI HARIAN</span>
                  <span className="font-mono">{formatRupiah(activePeriod.gajiHarianStandar)}</span>
                </div>
                <div className="flex justify-between">
                  <span>2. UANG TRAINING PERHARI</span>
                  <span className="font-mono">{formatRupiah(activePeriod.uangTrainingPerHari)}</span>
                </div>
              </div>

              <div className="mt-6 text-right text-[11px]">
                <p>{activePeriod.slipDateLabel}</p>
                <p className="mt-8 font-bold underline">Pengelola Kopi Tuju</p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => downloadPayslipPDF(previewEntry, activePeriod)}
                className="h-9 px-4 text-xs font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] rounded-lg inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download PDF</span>
              </button>
              {!readOnly && gmailToken && (
                <button
                  type="button"
                  onClick={() => {
                    const target = previewEntry;
                    setPreviewEntry(null);
                    requestSendEmails([target], false);
                  }}
                  className="h-9 px-4 text-xs font-semibold text-white bg-[#0F172A] hover:bg-slate-800 rounded-lg inline-flex items-center gap-1.5"
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>Kirim ke Email</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MANDATORY CONFIRMATION MODAL BEFORE GMAIL DISPATCH */}
      {confirmTargets && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmTargets(null);
          }}
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-bold text-slate-900">
                Konfirmasi Pengiriman Slip Gaji Otomatis via Gmail
              </h3>
              <button
                type="button"
                onClick={() => setConfirmTargets(null)}
                title="Tutup"
                className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
              Aplikasi akan mengirim email beserta lampiran PDF Slip Gaji periode{' '}
              <strong className="text-slate-900">{activePeriod.label}</strong> dari akun Gmail{' '}
              <strong className="text-slate-900">{gmailUserEmail || 'terhubung'}</strong> ke{' '}
              <strong className="text-slate-900">{confirmTargets.length} penerima</strong> berikut:
            </p>

            <div className="mt-4 max-h-52 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
              {confirmTargets.map((t) => (
                <div key={t.id} className="px-3 py-2 flex items-center justify-between">
                  <span className="font-semibold text-slate-900">{t.name}</span>
                  <span className="font-mono text-slate-600">{t.email}</span>
                </div>
              ))}
            </div>

            {finalizeAfterConfirm && (
              <p className="mt-3 text-xs font-medium text-amber-800">
                Periode payroll juga akan dikunci menjadi status Finalized.
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmTargets(null)}
                className="h-9 px-4 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Batalkan
              </button>
              <button
                type="button"
                onClick={executeConfirmedGmailSend}
                className="h-9 px-5 text-xs font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] rounded-lg"
              >
                Konfirmasi &amp; Kirim ({confirmTargets.length} Email)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LIVE PROGRESS MODAL */}
      {sendingProgress && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && !sendingProgress.active) setSendingProgress(null);
          }}
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-bold text-slate-900">
                {sendingProgress.active
                  ? `Mengirim Slip Gaji (${sendingProgress.current}/${sendingProgress.total})...`
                  : 'Pengiriman Slip Gaji Selesai'}
              </h3>
              {!sendingProgress.active && (
                <button
                  type="button"
                  onClick={() => setSendingProgress(null)}
                  title="Tutup"
                  className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-600">
              {sendingProgress.active
                ? `Memproses: ${sendingProgress.currentName}`
                : 'Ringkasan status pengiriman via Gmail:'}
            </p>
            <div className="mt-4 max-h-56 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
              {sendingProgress.results.map((r, i) => (
                <div key={i} className="px-3 py-2 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-slate-900">{r.name}</div>
                    <div className="text-[11px] font-mono text-slate-500">{r.email}</div>
                  </div>
                  <span
                    className={`font-semibold ${
                      r.ok ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {r.msg}
                  </span>
                </div>
              ))}
            </div>
            {!sendingProgress.active && (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSendingProgress(null)}
                  className="h-9 px-4 text-xs font-semibold text-white bg-[#0F172A] rounded-lg"
                >
                  Tutup
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* NEW PERIOD MODAL */}
      {newPeriodOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setNewPeriodOpen(false);
          }}
          className="fixed inset-0 z-50 bg-slate-950/40 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-slate-900">Buat Periode Payroll Baru</h3>
              <button
                type="button"
                onClick={() => setNewPeriodOpen(false)}
                title="Tutup"
                className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreatePeriod} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Label Periode</label>
                <input
                  type="text"
                  required
                  value={newPeriodLabel}
                  onChange={(e) => setNewPeriodLabel(e.target.value)}
                  placeholder="contoh: November 2026"
                  className="w-full h-9 px-3 border border-slate-300 rounded-lg"
                />
              </div>
              <p className="text-slate-500">
                Daftar kru aktif akan ditarik otomatis dari Database Kru &amp; Staf Toko Kopi Tuju.
              </p>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNewPeriodOpen(false)}
                  className="h-9 px-4 font-semibold text-slate-700 border border-slate-300 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="h-9 px-4 font-semibold text-white bg-[#0B4EA2] rounded-lg"
                >
                  Buat Periode
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
