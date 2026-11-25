import React, { useMemo } from 'react';
import { Award, Download, FileText, Lock, User } from 'lucide-react';
import type {
  Employee,
  HoldingIncentiveEntry,
  PayrollEntry,
  PayrollPeriod,
  UserAccount,
} from '../types/hc';
import { formatDateID, formatRupiah } from '../utils/calculations';
import { downloadPayslipPDF } from '../utils/pdfGenerator';

interface PersonalPayslipViewProps {
  currentUser: UserAccount;
  employees: Employee[];
  personalPayrollPeriods: PayrollPeriod[];
  canDownloadPdf: boolean;
}

export const PersonalPayslipView: React.FC<PersonalPayslipViewProps> = ({
  currentUser,
  employees,
  personalPayrollPeriods,
  canDownloadPdf,
}) => {
  const selfEmployee = useMemo(
    () =>
      employees.find(
        (e) =>
          (currentUser.employeeId && e.id === currentUser.employeeId) ||
          e.email.toLowerCase() === currentUser.email.toLowerCase()
      ),
    [employees, currentUser]
  );

  const myPayslips = useMemo(() => {
    const items: Array<{ period: PayrollPeriod; entry: PayrollEntry }> = [];
    for (const period of personalPayrollPeriods) {
      for (const entry of period.entries) {
        if (
          (selfEmployee?.id && entry.employeeId === selfEmployee.id) ||
          entry.email.toLowerCase() === currentUser.email.toLowerCase()
        ) {
          items.push({ period, entry });
        }
      }
    }
    return items;
  }, [personalPayrollPeriods, selfEmployee, currentUser.email]);

  const myIncentives = useMemo(() => {
    const items: Array<{ period: PayrollPeriod; incentive: HoldingIncentiveEntry }> = [];
    for (const period of personalPayrollPeriods) {
      for (const inc of period.holdingIncentives) {
        if (selfEmployee?.id && inc.employeeId === selfEmployee.id) {
          items.push({ period, incentive: inc });
        }
      }
    }
    return items;
  }, [personalPayrollPeriods, selfEmployee]);

  return (
    <div className="space-y-6">
      {/* Personal Profile Summary */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-[#0B4EA2]">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {selfEmployee?.name || currentUser.fullName}
              </h2>
              <p className="text-xs text-slate-500">
                {selfEmployee
                  ? `${selfEmployee.code} · ${selfEmployee.branch} · ${selfEmployee.position} (${currentUser.role})`
                  : `${currentUser.role} · ${currentUser.email}`}
              </p>
            </div>
          </div>

          {selfEmployee && (
            <div className="text-xs text-right text-slate-600">
              <div>
                Status:{' '}
                <span className="font-semibold text-slate-900">{selfEmployee.status}</span>
              </div>
              <div className="font-mono mt-0.5">
                Masuk: {formatDateID(selfEmployee.startDate)}
              </div>
              {selfEmployee.bankAccount && selfEmployee.bankAccount !== '—' && (
                <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                  {selfEmployee.bankName} · {selfEmployee.bankAccount}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Personal Payslips */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#0B4EA2]" />
            <h3 className="text-sm font-bold text-slate-900">
              Slip Gaji Pribadi ({currentUser.role})
            </h3>
          </div>
          {!canDownloadPdf && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md">
              <Lock className="w-3 h-3" />
              <span>Unduh PDF dinonaktifkan oleh Admin/Manager</span>
            </span>
          )}
        </div>

        {myPayslips.length === 0 ? (
          <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 space-y-1">
            <p className="font-semibold text-slate-800">
              Belum ada slip gaji pribadi untuk akun Anda pada periode saat ini.
            </p>
            <p className="text-slate-500">
              Sistem mencocokkan slip gaji berdasarkan tautan karyawan atau email akun (
              <span className="font-mono">{currentUser.email}</span>). Hubungi Admin/HR Manager jika
              akun Anda belum ditautkan ke data karyawan.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {myPayslips.map(({ period, entry }) => {
              const totalPotongan =
                entry.potonganSelisih +
                entry.potonganKetidakhadiran +
                entry.potonganKasbon +
                entry.potonganKeterlambatan;

              return (
                <div
                  key={`${period.id}-${entry.id}`}
                  className="border border-slate-300 rounded-xl p-5 text-xs space-y-3 bg-white"
                >
                  <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-200">
                    <div>
                      <p className="font-bold text-sm text-slate-900">
                        Slip Gaji · {period.label}
                      </p>
                      <p className="text-slate-500 mt-0.5">
                        {entry.branch} · {entry.hariKerja} Hari Kerja · {entry.izinSakit} Izin/Sakit
                      </p>
                    </div>
                    {canDownloadPdf && (
                      <button
                        type="button"
                        onClick={() => downloadPayslipPDF(entry, period)}
                        className="h-8 px-3 font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] rounded-lg inline-flex items-center gap-1.5 shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Unduh PDF</span>
                      </button>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Gaji Pokok</span>
                      <span className="font-mono tabular-nums font-medium text-slate-900">
                        {formatRupiah(entry.gajiPokokDibayar)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">
                        Uang Lembur ({entry.jumlahHariLembur} hari)
                      </span>
                      <span className="font-mono tabular-nums font-medium text-slate-900">
                        {formatRupiah(entry.uangLembur)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">
                        Uang Training ({entry.jumlahHariTraining} hari)
                      </span>
                      <span className="font-mono tabular-nums font-medium text-slate-900">
                        {formatRupiah(entry.uangTraining)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Insentif Penjualan</span>
                      <span className="font-mono tabular-nums font-medium text-slate-900">
                        {formatRupiah(entry.insentifPenjualan)}
                      </span>
                    </div>

                    <div className="pt-1.5 mt-1.5 border-t border-slate-100 space-y-1 text-red-700">
                      <div className="flex justify-between">
                        <span>Potongan Selisih</span>
                        <span className="font-mono tabular-nums">
                          -{formatRupiah(entry.potonganSelisih)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Potongan Ketidakhadiran</span>
                        <span className="font-mono tabular-nums">
                          -{formatRupiah(entry.potonganKetidakhadiran)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Potongan Kasbon</span>
                        <span className="font-mono tabular-nums">
                          -{formatRupiah(entry.potonganKasbon)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Potongan Keterlambatan</span>
                        <span className="font-mono tabular-nums">
                          -{formatRupiah(entry.potonganKeterlambatan)}
                        </span>
                      </div>
                      <div className="flex justify-between font-semibold">
                        <span>Total Potongan</span>
                        <span className="font-mono tabular-nums">
                          -{formatRupiah(totalPotongan)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-sm font-bold text-slate-900">
                    <span>Total Gaji Diterima</span>
                    <span className="font-mono tabular-nums text-[#0B4EA2]">
                      {formatRupiah(entry.totalGaji)}
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-500 flex justify-between pt-1">
                    <span>
                      Transfer: {entry.bank} - {entry.rekening || '—'}
                    </span>
                    <span>{period.slipDateLabel}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Personal Holding / Supervisor Incentive Summary */}
      {myIncentives.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-[#0B4EA2]" />
            <h3 className="text-sm font-bold text-slate-900">
              Rincian Insentif KPI &amp; Tunjangan Pribadi
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {myIncentives.map(({ period, incentive }) => (
              <div
                key={`${period.id}-${incentive.id}`}
                className="border border-slate-200 rounded-xl p-4 text-xs space-y-2 bg-slate-50/50"
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <div>
                    <p className="font-bold text-slate-900">{period.label}</p>
                    <p className="text-slate-500">
                      {incentive.jabatan} · {incentive.branch}
                    </p>
                  </div>
                  <span className="font-mono font-semibold text-[#0B4EA2]">
                    KPI {incentive.kpiPercent}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Insentif KPI</span>
                  <span className="font-mono tabular-nums">
                    {formatRupiah(incentive.insentifKpi)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Uang Transport</span>
                  <span className="font-mono tabular-nums">
                    {formatRupiah(incentive.uangTransport)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Insentif Penjualan</span>
                  <span className="font-mono tabular-nums">
                    {formatRupiah(incentive.insentifPenjualan)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Bonus Lainnya</span>
                  <span className="font-mono tabular-nums">
                    {formatRupiah(incentive.bonusLainnya)}
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-200 flex justify-between font-bold text-slate-900">
                  <span>Total Insentif</span>
                  <span className="font-mono tabular-nums text-[#0B4EA2]">
                    {formatRupiah(incentive.totalInsentif)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
