import React, { useMemo, useState } from 'react';
import { Award, Calendar, CheckCircle2, Download, FileText, Lock, User } from 'lucide-react';
import { HcAppState, UserAccount } from '../types/hc';
import {
  addDaysISO,
  ASPECT_KEYS,
  ASPECT_LABELS,
  evaluateBatchTrainees,
  formatDateID,
  formatRupiah,
} from '../utils/calculations';
import { downloadPayslipPDF, downloadRaporPDF } from '../utils/pdfGenerator';
import { LiveAttendanceView } from './LiveAttendanceView';

interface BaristaSelfServiceViewProps {
  currentUser: UserAccount;
  state: HcAppState;
  authToken: string;
  mapsApiKey: string;
  onRefreshState: () => Promise<void>;
}

export const BaristaSelfServiceView: React.FC<BaristaSelfServiceViewProps> = ({
  currentUser,
  state,
  authToken,
  mapsApiKey,
  onRefreshState,
}) => {
  const { permissions, employees, batches, indicators, payrollPeriods } = state;
  const selfEmployee = useMemo(
    () =>
      employees.find(
        (e) =>
          e.id === currentUser.employeeId ||
          e.email.toLowerCase() === currentUser.email.toLowerCase()
      ) || employees[0],
    [employees, currentUser]
  );

  const [phoneInput, setPhoneInput] = useState(selfEmployee?.phone || '');
  const [emailInput, setEmailInput] = useState(selfEmployee?.email || '');
  const [contactSaved, setContactSaved] = useState(false);

  const myPayslips = useMemo(() => {
    const list: Array<{ period: (typeof payrollPeriods)[number]; entry: (typeof payrollPeriods)[number]['entries'][number] }> = [];
    for (const p of payrollPeriods) {
      for (const e of p.entries) {
        list.push({ period: p, entry: e });
      }
    }
    return list;
  }, [payrollPeriods]);

  const myTrainings = useMemo(() => {
    return batches.flatMap((batch) => {
      const summaries = evaluateBatchTrainees(batch.trainees, indicators, batch.settings);
      return batch.trainees.map((trainee) => ({
        batch,
        trainee,
        summary: summaries[trainee.id],
      }));
    });
  }, [batches, indicators]);

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setContactSaved(false);
    const res = await fetch('/api/me/contact', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ phone: phoneInput, email: emailInput }),
    });
    if (res.ok) {
      setContactSaved(true);
      await onRefreshState();
    }
  };

  return (
    <div className="space-y-6">
      {/* Personal Profile */}
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
                {selfEmployee ? `${selfEmployee.code} · ${selfEmployee.branch} · ${selfEmployee.position}` : currentUser.role}
              </p>
            </div>
          </div>

          {selfEmployee && (
            <div className="text-xs text-right text-slate-600">
              <div>
                Status: <span className="font-semibold text-slate-900">{selfEmployee.status}</span>
              </div>
              <div className="font-mono mt-0.5">
                Masuk: {formatDateID(selfEmployee.startDate)}
              </div>
            </div>
          )}
        </div>

        {permissions.baristaCanEditOwnContact && selfEmployee && (
          <form
            onSubmit={handleSaveContact}
            className="mt-5 pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end text-xs"
          >
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Email Penerima Slip Gaji
              </label>
              <input
                type="email"
                required
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="w-full h-9 px-3 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">No. HP / WhatsApp</label>
              <input
                type="text"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                className="w-full h-9 px-3 border border-slate-300 rounded-lg font-mono"
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                className="h-9 px-4 font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] rounded-lg"
              >
                Simpan Kontak
              </button>
              {contactSaved && (
                <span className="text-emerald-700 font-semibold">Tersimpan</span>
              )}
            </div>
          </form>
        )}
      </div>

      {/* Live Attendance Clock-In / Clock-Out with Google Maps Geofence */}
      {permissions.baristaCanUseLiveAttendance !== false ? (
        <LiveAttendanceView
          currentUser={currentUser}
          employees={employees}
          outletLocations={state.outletLocations || []}
          liveAttendanceRecords={state.liveAttendanceRecords || []}
          myTodayClockState={state.myTodayClockState ?? null}
          authToken={authToken}
          mapsApiKey={mapsApiKey}
          compactForBarista
          onRefreshState={onRefreshState}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-3 text-xs text-slate-500">
          <Lock className="w-4 h-4 shrink-0" />
          <span>Akses Absensi Kehadiran (Validasi Maps) saat ini dinonaktifkan oleh Manager HC.</span>
        </div>
      )}

      {/* Payslip Section */}
      {permissions.baristaCanViewOwnPayslip ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#0B4EA2]" />
            <h3 className="text-sm font-bold text-slate-900">Slip Gaji Saya</h3>
          </div>

          {myPayslips.length === 0 ? (
            <p className="text-xs text-slate-500">
              Belum ada data slip gaji untuk akun Anda pada periode ini.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {myPayslips.map(({ period, entry }) => (
                <div
                  key={entry.id}
                  className="border border-slate-300 rounded-xl p-5 text-xs space-y-3"
                >
                  <div className="flex items-center justify-between pb-2.5 border-b border-slate-200">
                    <div>
                      <p className="font-bold text-sm text-slate-900">
                        Slip Gaji · {period.label}
                      </p>
                      <p className="text-slate-500">
                        {entry.branch} · {entry.hariKerja} Hari Kerja · {entry.izinSakit} Izin/Sakit
                      </p>
                    </div>
                    {permissions.baristaCanDownloadPayslip && (
                      <button
                        type="button"
                        onClick={() => downloadPayslipPDF(entry, period)}
                        className="h-8 px-3 font-semibold text-white bg-[#0B4EA2] hover:bg-[#093E82] rounded-lg inline-flex items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Unduh PDF</span>
                      </button>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Gaji Pokok</span>
                      <span className="font-mono tabular-nums">
                        {formatRupiah(entry.gajiPokokDibayar)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Uang Lembur ({entry.jumlahHariLembur} hari)</span>
                      <span className="font-mono tabular-nums">
                        {formatRupiah(entry.uangLembur)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Uang Training ({entry.jumlahHariTraining} hari)</span>
                      <span className="font-mono tabular-nums">
                        {formatRupiah(entry.uangTraining)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Insentif Penjualan</span>
                      <span className="font-mono tabular-nums">
                        {formatRupiah(entry.insentifPenjualan)}
                      </span>
                    </div>
                    <div className="flex justify-between text-red-700">
                      <span>Total Potongan (Selisih/Absen/Kasbon/Telat)</span>
                      <span className="font-mono tabular-nums">
                        -
                        {formatRupiah(
                          entry.potonganSelisih +
                            entry.potonganKetidakhadiran +
                            entry.potonganKasbon +
                            entry.potonganKeterlambatan
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-slate-200 flex justify-between text-sm font-bold text-slate-900">
                    <span>Total Gaji Diterima</span>
                    <span className="font-mono tabular-nums">{formatRupiah(entry.totalGaji)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-3 text-xs text-slate-500">
          <Lock className="w-4 h-4 shrink-0" />
          <span>Akses Slip Gaji saat ini dinonaktifkan oleh Pengelola HC.</span>
        </div>
      )}

      {/* Onboarding & Training Progress Section */}
      {permissions.baristaCanViewOwnTraining && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-[#0B4EA2]" />
            <h3 className="text-sm font-bold text-slate-900">
              Progres Onboarding &amp; Training Barista
            </h3>
          </div>

          {myTrainings.length === 0 ? (
            <p className="text-xs text-slate-500">
              Anda belum terdaftar dalam batch training onboarding aktif.
            </p>
          ) : (
            myTrainings.map(({ batch, trainee, summary }) => (
              <div key={trainee.id} className="space-y-4 border-t border-slate-100 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs">
                    <p className="font-bold text-slate-900">{batch.name}</p>
                    <p className="text-slate-500">
                      Trainer: {batch.trainer} · Kehadiran: {summary?.attendancePercent ?? 0}% ·
                      Indikator: {summary?.filledCount ?? 0}/30
                    </p>
                  </div>
                  {summary && (
                    <button
                      type="button"
                      onClick={() =>
                        downloadRaporPDF(batch, trainee, summary, batch.settings)
                      }
                      className="h-8 px-3 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Unduh Rapor PDF</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
                  {ASPECT_KEYS.map((k) => (
                    <div key={k} className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                      <p className="text-[11px] text-slate-500 truncate">{ASPECT_LABELS[k]}</p>
                      <p className="mt-1 font-mono text-base font-bold text-slate-900">
                        {summary?.aspectScores[k] !== null && summary?.aspectScores[k] !== undefined
                          ? summary.aspectScores[k]!.toFixed(1)
                          : '—'}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 text-xs bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <div>
                    <span className="text-slate-500">Nilai Akhir: </span>
                    <span className="font-mono font-bold text-slate-900">
                      {summary?.finalScore !== null && summary?.finalScore !== undefined
                        ? summary.finalScore.toFixed(1)
                        : 'Menunggu kelengkapan'}
                    </span>
                    <span className="mx-2 text-slate-300">|</span>
                    <span className="font-semibold text-slate-800">{summary?.decision}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-700">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                    <span>Sertifikasi: {trainee.certifications.join(' · ') || '—'}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Optional Schedule */}
      {permissions.baristaCanViewTrainingSchedule && batches[0]?.schedule?.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#0B4EA2]" />
            <h3 className="text-sm font-bold text-slate-900">
              Jadwal Training 14 Hari ({batches[0].name})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                  <th className="py-2 px-3">Hari</th>
                  <th className="py-2 px-3">Tanggal</th>
                  <th className="py-2 px-3">Materi</th>
                  <th className="py-2 px-3">Trainer</th>
                  <th className="py-2 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {batches[0].schedule.map((d, idx) => (
                  <tr key={d.day}>
                    <td className="py-2 px-3 font-mono font-semibold">Hari {d.day}</td>
                    <td className="py-2 px-3 font-mono">
                      {formatDateID(addDaysISO(batches[0].startDate, idx))}
                    </td>
                    <td className="py-2 px-3">{d.topic}</td>
                    <td className="py-2 px-3">{d.trainer}</td>
                    <td className="py-2 px-3 font-semibold">{d.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Optional Crew Directory (No salaries shown) */}
      {permissions.baristaCanViewCrewDirectory && employees.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <h3 className="text-sm font-bold text-slate-900">Direktori Kru Toko Kopi Tuju</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            {employees.map((e) => (
              <div key={e.id} className="p-3 border border-slate-200 rounded-lg">
                <p className="font-semibold text-slate-900">{e.name}</p>
                <p className="text-slate-500">
                  {e.branch} · {e.position}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
