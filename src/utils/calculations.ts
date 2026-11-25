import type {
  AspectKey,
  AttendanceCode,
  EvaluationIndicator,
  EvaluationSettings,
  HoldingIncentiveEntry,
  PayrollEntry,
  TraineeRecord,
} from '../types/hc';

export const ASPECT_LABELS: Record<AspectKey, string> = {
  teknis: 'Teknis Barista & Ekstraksi',
  layanan: 'Layanan Pelanggan',
  pengetahuan: 'Pengetahuan Kopi & Menu',
  kebersihan: 'Kebersihan, Keamanan Pangan & SOP',
  kasir: 'Operasional Kasir & POS',
  sikap: 'Sikap Kerja & Disiplin',
};

export const ASPECT_KEYS: AspectKey[] = [
  'teknis',
  'layanan',
  'pengetahuan',
  'kebersihan',
  'kasir',
  'sikap',
];

export const SCORE_SCALE_DESC: Record<number, { label: string; desc: string }> = {
  5: { label: 'Sangat Baik', desc: 'Sesuai standar secara mandiri, konsisten, tanpa kesalahan.' },
  4: { label: 'Baik', desc: 'Sesuai standar dengan kesalahan minor; tidak perlu dibimbing.' },
  3: { label: 'Cukup', desc: 'Cukup sesuai standar; masih perlu pengingat/bimbingan sesekali.' },
  2: { label: 'Kurang', desc: 'Sering salah; perlu bimbingan terus-menerus.' },
  1: { label: 'Sangat Kurang', desc: 'Belum mampu atau tidak sesuai standar.' },
};

export interface TraineeEvaluationSummary {
  traineeId: string;
  filledCount: number;
  totalIndicators: number;
  isComplete: boolean;
  attendancePercent: number;
  hadirCount: number;
  aspectScores: Record<AspectKey, number | null>;
  finalScore: number | null;
  category: 'Sangat Baik' | 'Baik' | 'Cukup' | 'Perlu Pembinaan' | 'Belum Lengkap';
  criticalHygienePassed: boolean | null;
  decision: 'Lulus' | 'Belum Lulus (Syarat Kritis)' | 'Belum Lulus' | 'Menunggu Kelengkapan';
  rank: number | null;
}

export function calculateAttendancePercent(attendance: AttendanceCode[]): {
  hadir: number;
  recorded: number;
  percent: number;
} {
  const recorded = attendance.filter((c) => c !== '').length;
  const hadir = attendance.filter((c) => c === 'H').length;
  if (recorded === 0) return { hadir: 0, recorded: 0, percent: 0 };
  return {
    hadir,
    recorded,
    percent: Math.round((hadir / recorded) * 100),
  };
}

export function evaluateBatchTrainees(
  trainees: TraineeRecord[],
  indicators: EvaluationIndicator[],
  settings: EvaluationSettings
): Record<string, TraineeEvaluationSummary> {
  const totalIndicators = indicators.length;
  const summaries: TraineeEvaluationSummary[] = trainees.map((trainee) => {
    let filledCount = 0;
    const aspectTotals: Record<AspectKey, { sum: number; count: number; totalInAspect: number }> = {
      teknis: { sum: 0, count: 0, totalInAspect: 0 },
      layanan: { sum: 0, count: 0, totalInAspect: 0 },
      pengetahuan: { sum: 0, count: 0, totalInAspect: 0 },
      kebersihan: { sum: 0, count: 0, totalInAspect: 0 },
      kasir: { sum: 0, count: 0, totalInAspect: 0 },
      sikap: { sum: 0, count: 0, totalInAspect: 0 },
    };

    for (const ind of indicators) {
      aspectTotals[ind.aspect].totalInAspect += 1;
      const val = trainee.scores[ind.code];
      if (typeof val === 'number' && val >= 1 && val <= 5) {
        filledCount += 1;
        aspectTotals[ind.aspect].sum += val;
        aspectTotals[ind.aspect].count += 1;
      }
    }

    const aspectScores: Record<AspectKey, number | null> = {
      teknis: null,
      layanan: null,
      pengetahuan: null,
      kebersihan: null,
      kasir: null,
      sikap: null,
    };

    for (const key of ASPECT_KEYS) {
      const bucket = aspectTotals[key];
      if (bucket.count > 0 && bucket.count === bucket.totalInAspect) {
        aspectScores[key] = Math.round(((bucket.sum / bucket.count) / 5) * 100 * 10) / 10;
      }
    }

    const isComplete = totalIndicators > 0 && filledCount === totalIndicators;
    const att = calculateAttendancePercent(trainee.attendance);

    let finalScore: number | null = null;
    let category: TraineeEvaluationSummary['category'] = 'Belum Lengkap';
    let criticalHygienePassed: boolean | null = null;
    let decision: TraineeEvaluationSummary['decision'] = 'Menunggu Kelengkapan';

    if (isComplete) {
      const totalWeight = ASPECT_KEYS.reduce((acc, k) => acc + (settings.weights[k] || 0), 0) || 100;
      const weighted = ASPECT_KEYS.reduce((acc, k) => {
        const score = aspectScores[k] ?? 0;
        const w = (settings.weights[k] || 0) / totalWeight;
        return acc + score * w;
      }, 0);
      finalScore = Math.round(weighted * 10) / 10;

      if (finalScore >= settings.thresholds.sangatBaik) category = 'Sangat Baik';
      else if (finalScore >= settings.thresholds.baik) category = 'Baik';
      else if (finalScore >= settings.thresholds.cukup) category = 'Cukup';
      else category = 'Perlu Pembinaan';

      const hygieneScore = aspectScores.kebersihan ?? 0;
      criticalHygienePassed = hygieneScore >= settings.criticalHygieneMin;

      if (!criticalHygienePassed) {
        decision = 'Belum Lulus (Syarat Kritis)';
      } else if (finalScore >= settings.thresholds.cukup) {
        decision = 'Lulus';
      } else {
        decision = 'Belum Lulus';
      }
    }

    return {
      traineeId: trainee.id,
      filledCount,
      totalIndicators,
      isComplete,
      attendancePercent: att.percent,
      hadirCount: att.hadir,
      aspectScores,
      finalScore,
      category,
      criticalHygienePassed,
      decision,
      rank: null,
    };
  });

  const ranked = [...summaries]
    .filter((s) => s.isComplete && s.finalScore !== null)
    .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));

  ranked.forEach((item, idx) => {
    item.rank = idx + 1;
  });

  const map: Record<string, TraineeEvaluationSummary> = {};
  for (const s of summaries) {
    map[s.traineeId] = s;
  }
  return map;
}

export function addDaysISO(startDate: string, offsetDays: number): string {
  if (!startDate) return '';
  const d = new Date(startDate + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function formatDateID(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatWorkTenure(startDate: string): string {
  if (!startDate) return '—';
  const start = new Date(startDate + 'T00:00:00');
  if (Number.isNaN(start.getTime())) return '—';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (start > today) return 'Belum mulai';

  let years = today.getFullYear() - start.getFullYear();
  let months = today.getMonth() - start.getMonth();
  let days = today.getDate() - start.getDate();

  if (days < 0) {
    months -= 1;
    const prevMonthDays = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
    days += prevMonthDays;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  if (years > 0 && months > 0) return `${years} thn ${months} bln`;
  if (years > 0) return `${years} thn`;
  if (months > 0 && days > 0) return `${months} bln ${days} hr`;
  if (months > 0) return `${months} bln`;
  if (days > 0) return `${days} hari`;
  return 'Baru masuk';
}

export function formatRupiah(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  if (safe < 0) {
    return `-Rp${Math.abs(safe).toLocaleString('en-US')}`;
  }
  return `Rp${safe.toLocaleString('en-US')}`;
}

export function recalculatePayrollEntry(
  entry: PayrollEntry,
  gajiHarianStandar: number,
  uangTrainingPerHari: number
): PayrollEntry {
  const hariKerja = Math.max(0, Number(entry.hariKerja) || 0);
  const gajiPokokDasar = Math.max(0, Number(entry.gajiPokokDasar) || 0);

  const gajiPokokDibayar =
    entry.payMode === 'prorata_harian'
      ? Math.round(hariKerja * gajiHarianStandar)
      : gajiPokokDasar;

  const dailyBaseForOvertime =
    gajiPokokDasar >= 2000000
      ? 76000
      : gajiPokokDasar >= 1500000
      ? 57000
      : gajiHarianStandar;

  const jumlahHariLembur = Math.max(0, Number(entry.jumlahHariLembur) || 0);
  const uangLembur = jumlahHariLembur * dailyBaseForOvertime;

  const jumlahHariTraining = Math.max(0, Number(entry.jumlahHariTraining) || 0);
  const uangTraining = jumlahHariTraining * uangTrainingPerHari;

  const insentifPenjualan = Math.max(0, Number(entry.insentifPenjualan) || 0);
  const potonganSelisih = Math.max(0, Number(entry.potonganSelisih) || 0);
  const potonganKetidakhadiran = Math.max(0, Number(entry.potonganKetidakhadiran) || 0);
  const potonganKasbon = Math.max(0, Number(entry.potonganKasbon) || 0);
  const potonganKeterlambatan = Math.max(0, Number(entry.potonganKeterlambatan) || 0);

  const totalGaji =
    gajiPokokDibayar +
    insentifPenjualan +
    uangLembur +
    uangTraining -
    potonganSelisih -
    potonganKetidakhadiran -
    potonganKasbon -
    potonganKeterlambatan;

  return {
    ...entry,
    uangLembur,
    uangTraining,
    gajiPokokDibayar,
    totalGaji,
  };
}

export function recalculateHoldingIncentive(item: HoldingIncentiveEntry): HoldingIncentiveEntry {
  const totalInsentif =
    (Number(item.insentifKpi) || 0) +
    (Number(item.uangTransport) || 0) +
    (Number(item.insentifPenjualan) || 0) +
    (Number(item.bonusLainnya) || 0);
  return { ...item, totalInsentif };
}

export function calculateHaversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function parseHHmmToMinutes(hhmm: string): number {
  const match = String(hhmm || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function getWitaDateAndTime(now: Date = new Date()): {
  date: string;
  timeHHmm: string;
} {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Makassar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const timeParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Makassar',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const getPart = (parts: Intl.DateTimeFormatPart[], type: string) =>
    parts.find((p) => p.type === type)?.value || '00';

  const year = getPart(dateParts, 'year');
  const month = getPart(dateParts, 'month');
  const day = getPart(dateParts, 'day');
  const hour = getPart(timeParts, 'hour');
  const minute = getPart(timeParts, 'minute');

  return {
    date: `${year}-${month}-${day}`,
    timeHHmm: `${hour}:${minute}`,
  };
}

export function computeLiveClockInPenalty(
  clockInHHmm: string,
  shiftStartHHmm: string
): {
  status: 'Hadir' | 'Terlambat';
  lateMinutes: number;
  penaltyAmount: number;
} {
  const inMin = parseHHmmToMinutes(clockInHHmm);
  const startMin = parseHHmmToMinutes(shiftStartHHmm);
  const lateMinutes = Math.max(0, inMin - startMin);

  if (lateMinutes <= 0) {
    return { status: 'Hadir', lateMinutes: 0, penaltyAmount: 0 };
  }

  let penaltyAmount = 0;
  if (lateMinutes <= 29) {
    penaltyAmount = 2700;
  } else if (lateMinutes <= 59) {
    penaltyAmount = 5400;
  } else {
    penaltyAmount = Math.floor(lateMinutes / 60) * 5400;
  }

  return {
    status: 'Terlambat',
    lateMinutes,
    penaltyAmount,
  };
}

export function computeWorkDurationLabel(clockInHHmm: string, clockOutHHmm: string): string {
  const inMin = parseHHmmToMinutes(clockInHHmm);
  let outMin = parseHHmmToMinutes(clockOutHHmm);
  if (outMin < inMin) {
    outMin += 24 * 60;
  }
  const diff = Math.max(0, outMin - inMin);
  const hours = Math.floor(diff / 60);
  const mins = diff % 60;
  return `${hours} Jam ${mins} Menit`;
}
