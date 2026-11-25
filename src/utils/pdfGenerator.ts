import { jsPDF } from 'jspdf';
import {
  EvaluationSettings,
  KpiEvaluationRecord,
  KpiIndicatorItem,
  PayrollEntry,
  PayrollPeriod,
  TraineeRecord,
  TrainingBatch,
} from '../types/hc';
import {
  ASPECT_KEYS,
  ASPECT_LABELS,
  formatDateID,
  formatRupiah,
  TraineeEvaluationSummary,
} from './calculations';

function triggerDownloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadCSV(
  fileName: string,
  headers: string[],
  rows: Array<Array<string | number>>
) {
  const escapeCell = (val: string | number) => {
    const str = String(val ?? '');
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csvContent =
    '\uFEFF' +
    [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join(
      '\r\n'
    );
  triggerDownloadBlob(
    new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }),
    fileName
  );
}

export function buildPayslipPDF(entry: PayrollEntry, period: PayrollPeriod): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a5',
  });

  const pageW = doc.internal.pageSize.getWidth();
  let y = 14;

  doc.setDrawColor(28, 25, 23);
  doc.setLineWidth(0.5);
  doc.rect(10, 10, pageW - 20, 188);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('SLIP GAJI', pageW / 2, y + 2, { align: 'center' });
  y += 6.5;
  doc.setFontSize(12);
  doc.text('KOPI TUJU', pageW / 2, y + 2, { align: 'center' });

  y += 6;
  doc.setLineWidth(0.4);
  doc.line(10, y, pageW - 10, y);

  y += 8;
  doc.setFontSize(9.5);

  const drawRow = (label: string, value: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(label, 15, y);
    doc.text('=', 65, y);
    doc.text(value, pageW - 15, y, { align: 'right' });
    y += 6.5;
  };

  drawRow('NAMA', entry.name, true);
  drawRow('CABANG', entry.branch);
  drawRow('PERIODE', period.label);
  drawRow('HARI KERJA', String(entry.hariKerja));
  drawRow('IZIN/SAKIT', String(entry.izinSakit));

  y += 1.5;
  doc.setDrawColor(214, 211, 209);
  doc.line(15, y - 4, pageW - 15, y - 4);

  drawRow('GAJI POKOK', formatRupiah(entry.gajiPokokDibayar));
  drawRow('INSENTIF PENJUALAN', formatRupiah(entry.insentifPenjualan));
  drawRow('UANG LEMBUR', formatRupiah(entry.uangLembur));
  drawRow('UANG TRAINING', formatRupiah(entry.uangTraining));
  drawRow('POTONGAN (SELISIH)', formatRupiah(entry.potonganSelisih));
  drawRow('POTONGAN (KETIDAKHADIRAN)', formatRupiah(entry.potonganKetidakhadiran));
  drawRow('POTONGAN (KASBON)', formatRupiah(entry.potonganKasbon));
  drawRow('POTONGAN (KETERLAMBATAN)', formatRupiah(entry.potonganKeterlambatan));

  y += 1;
  doc.setDrawColor(28, 25, 23);
  doc.line(15, y - 4, pageW - 15, y - 4);
  drawRow('TOTAL GAJI', formatRupiah(entry.totalGaji), true);

  y += 3;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(87, 83, 78);
  doc.text(`Rekening Transfer: ${entry.bank} - ${entry.rekening || '—'}`, 15, y);
  doc.setTextColor(28, 25, 23);

  y += 9;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('KETERANGAN:', 15, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.text('1. GAJI HARIAN', 15, y);
  doc.text('=', 65, y);
  doc.text(formatRupiah(period.gajiHarianStandar), pageW - 15, y, { align: 'right' });
  y += 5;
  doc.text('2. UANG TRAINING PERHARI', 15, y);
  doc.text('=', 65, y);
  doc.text(formatRupiah(period.uangTrainingPerHari), pageW - 15, y, { align: 'right' });

  y += 14;
  doc.setFontSize(9);
  doc.text(period.slipDateLabel || `Makassar, ${period.label}`, pageW - 15, y, { align: 'right' });
  y += 14;
  doc.setFont('helvetica', 'bold');
  doc.text('Pengelola Kopi Tuju', pageW - 15, y, { align: 'right' });
  doc.setLineWidth(0.3);
  doc.line(pageW - 48, y + 1, pageW - 15, y + 1);

  return doc;
}

export function downloadPayslipPDF(entry: PayrollEntry, period: PayrollPeriod) {
  const doc = buildPayslipPDF(entry, period);
  const safeName = entry.name.replace(/[^a-zA-Z0-9]+/g, '_');
  const safePeriod = period.label.replace(/[^a-zA-Z0-9]+/g, '_');
  doc.save(`Slip_Gaji_${safeName}_${safePeriod}.pdf`);
}

export function getPayslipPDFBase64(entry: PayrollEntry, period: PayrollPeriod): string {
  const doc = buildPayslipPDF(entry, period);
  const dataUri = doc.output('datauristring');
  const commaIdx = dataUri.indexOf(',');
  return commaIdx >= 0 ? dataUri.slice(commaIdx + 1) : '';
}

export function downloadRaporPDF(
  batch: TrainingBatch,
  trainee: TraineeRecord,
  summary: TraineeEvaluationSummary,
  settings: EvaluationSettings
) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageW = doc.internal.pageSize.getWidth();
  let y = 18;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('RAPOR INDIVIDU ONBOARDING & TRAINING BARISTA', pageW / 2, y, { align: 'center' });
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Toko Kopi Tuju — Human Capital Management', pageW / 2, y, { align: 'center' });

  y += 6;
  doc.setDrawColor(68, 64, 60);
  doc.line(16, y, pageW - 16, y);
  y += 9;

  doc.setFontSize(10);
  const metaLeft: Array<[string, string]> = [
    ['Nama Peserta', trainee.name],
    ['Cabang Penempatan', trainee.branch],
    ['Batch Training', batch.name],
    ['Trainer PJ', batch.trainer],
  ];
  const metaRight: Array<[string, string]> = [
    ['Tanggal Mulai', formatDateID(trainee.startDate)],
    ['Tanggal Selesai', formatDateID(trainee.completionDate)],
    ['Kehadiran (14 Hari)', `${summary.hadirCount} hari (${summary.attendancePercent}%)`],
    ['Peringkat Batch', summary.rank ? `#${summary.rank}` : '—'],
  ];

  metaLeft.forEach(([k, v], idx) => {
    const rowY = y + idx * 6.5;
    doc.setFont('helvetica', 'normal');
    doc.text(k, 16, rowY);
    doc.text(': ' + v, 56, rowY);

    const [rk, rv] = metaRight[idx];
    doc.text(rk, 112, rowY);
    doc.text(': ' + rv, 152, rowY);
  });

  y += 32;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Rekap Nilai Per Aspek Penilaian', 16, y);
  y += 6;

  doc.setFillColor(245, 245, 244);
  doc.rect(16, y, pageW - 32, 8, 'F');
  doc.setFontSize(9.5);
  doc.text('Aspek Penilaian', 19, y + 5.5);
  doc.text('Bobot', 120, y + 5.5, { align: 'right' });
  doc.text('Nilai (0-100)', 155, y + 5.5, { align: 'right' });
  doc.text('Status', pageW - 19, y + 5.5, { align: 'right' });
  y += 8;

  doc.setFont('helvetica', 'normal');
  ASPECT_KEYS.forEach((key) => {
    const val = summary.aspectScores[key];
    const weight = settings.weights[key];
    const isCritical = key === 'kebersihan';
    let statusTxt = val === null ? 'Belum Lengkap' : 'Memenuhi';
    if (isCritical && val !== null && val < settings.criticalHygieneMin) {
      statusTxt = `Di bawah min (${settings.criticalHygieneMin})`;
    }

    doc.rect(16, y, pageW - 32, 8);
    doc.text(ASPECT_LABELS[key], 19, y + 5.5);
    doc.text(`${weight}%`, 120, y + 5.5, { align: 'right' });
    doc.text(val !== null ? val.toFixed(1) : '—', 155, y + 5.5, { align: 'right' });
    doc.text(statusTxt, pageW - 19, y + 5.5, { align: 'right' });
    y += 8;
  });

  y += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(
    `Nilai Akhir: ${summary.finalScore !== null ? summary.finalScore.toFixed(1) : '—'}   |   Kategori: ${summary.category}   |   Keputusan: ${summary.decision}`,
    16,
    y
  );

  y += 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Sertifikasi & Kompetensi Tercapai:', 16, y);
  y += 5.5;
  doc.setFont('helvetica', 'normal');
  doc.text(
    trainee.certifications.length > 0 ? trainee.certifications.join(', ') : 'Belum ada sertifikasi tercatat.',
    16,
    y
  );

  y += 10;
  doc.setFont('helvetica', 'bold');
  doc.text('Catatan Trainer / HC Manager:', 16, y);
  y += 5.5;
  doc.setFont('helvetica', 'normal');
  const noteLines = doc.splitTextToSize(
    trainee.trainerNotes || 'Tidak ada catatan tambahan.',
    pageW - 32
  );
  doc.text(noteLines, 16, y);

  y = 245;
  doc.setFontSize(9.5);
  doc.text('Trainer Lapangan', 35, y, { align: 'center' });
  doc.text('Manager HC Kopi Tuju', pageW / 2, y, { align: 'center' });
  doc.text('Peserta Training', pageW - 35, y, { align: 'center' });

  y += 22;
  doc.line(18, y, 52, y);
  doc.line(pageW / 2 - 20, y, pageW / 2 + 20, y);
  doc.line(pageW - 52, y, pageW - 18, y);

  doc.setFontSize(8.5);
  doc.text(batch.trainer, 35, y + 4.5, { align: 'center' });
  doc.text('Pengelola Kopi Tuju', pageW / 2, y + 4.5, { align: 'center' });
  doc.text(trainee.name, pageW - 35, y + 4.5, { align: 'center' });

  const safeName = trainee.name.replace(/[^a-zA-Z0-9]+/g, '_');
  doc.save(`Rapor_Training_${safeName}.pdf`);
}

export function exportPayrollExcel(period: PayrollPeriod) {
  const headers = [
    'No.',
    'Nama',
    'Email',
    'Cabang',
    'HARI KERJA',
    'IZIN/SAKIT',
    'Gaji Pokok',
    'Insentif Penjualan',
    'JUMLAH HARI LEMBUR',
    'Uang Lembur',
    'JUMLAH HARI TRAINING',
    'Uang Training',
    'Potongan (Selisih)',
    'Potongan (Ketidakhadiran)',
    'Potongan (Kasbon)',
    'Potongan (Keterlambatan)',
    'Total Gaji',
    'Rekening',
    'Keterangan',
    'Status Slip',
  ];
  const rows = period.entries.map((e, idx) => [
    idx + 1,
    e.name,
    e.email,
    e.branch,
    e.hariKerja,
    e.izinSakit,
    e.gajiPokokDibayar,
    e.insentifPenjualan,
    e.jumlahHariLembur,
    e.uangLembur,
    e.jumlahHariTraining,
    e.uangTraining,
    e.potonganSelisih,
    e.potonganKetidakhadiran,
    e.potonganKasbon,
    e.potonganKeterlambatan,
    e.totalGaji,
    e.rekening,
    e.bank,
    e.slipStatus || 'Belum Dikirim',
  ]);

  const safePeriod = period.label.replace(/[^a-zA-Z0-9]+/g, '_');
  downloadCSV(`Payroll_Kopi_Tuju_${safePeriod}.csv`, headers, rows);
}

export function downloadKpiEvaluationPDF(
  record: KpiEvaluationRecord,
  divisionTitle: string,
  jobDescriptions: string[],
  indicators: KpiIndicatorItem[],
  computeItem: (ind: KpiIndicatorItem, val: number | null | undefined) => {
    achievement: number | null;
    weighted: number | null;
  },
  finalScore: number | null,
  predicate: string
) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageW = doc.internal.pageSize.getWidth();
  let y = 16;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.text(`MODUL KPI & JOB DESCRIPTION — ${divisionTitle.toUpperCase()}`, pageW / 2, y, {
    align: 'center',
  });
  y += 5.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text('Toko Kopi Tuju — Human Capital Management', pageW / 2, y, { align: 'center' });

  y += 5;
  doc.setDrawColor(68, 64, 60);
  doc.line(14, y, pageW - 14, y);
  y += 7;

  doc.setFontSize(9);
  const leftMeta: Array<[string, string]> = [
    ['Nama Staf', record.employeeName],
    ['Cabang / Unit', record.branch],
  ];
  const rightMeta: Array<[string, string]> = [
    ['Periode Penilaian', record.periodLabel],
    ['Evaluator', record.evaluatorName],
  ];

  leftMeta.forEach(([k, v], idx) => {
    const rowY = y + idx * 5.5;
    doc.setFont('helvetica', 'normal');
    doc.text(k, 14, rowY);
    doc.text(': ' + v, 44, rowY);

    const [rk, rv] = rightMeta[idx];
    doc.text(rk, 114, rowY);
    doc.text(': ' + rv, 148, rowY);
  });

  y += 15;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('A. JOB DESCRIPTION (URAIAN TUGAS POKOK)', 14, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  jobDescriptions.forEach((job, idx) => {
    const lines = doc.splitTextToSize(`${idx + 1}. ${job}`, pageW - 28);
    doc.text(lines, 14, y);
    y += lines.length * 4.2;
  });

  y += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('B. KEY PERFORMANCE INDICATOR (KPI) & SKORING', 14, y);
  y += 4;

  doc.setFillColor(30, 58, 138);
  doc.rect(14, y, pageW - 28, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.text('No', 16, y + 5.2);
  doc.text('Indikator KPI', 24, y + 5.2);
  doc.text('Tipe', 102, y + 5.2);
  doc.text('Bobot', 124, y + 5.2, { align: 'right' });
  doc.text('Target', 141, y + 5.2, { align: 'right' });
  doc.text('Realisasi', 159, y + 5.2, { align: 'right' });
  doc.text('Skor %', 177, y + 5.2, { align: 'right' });
  doc.text('Nilai', pageW - 16, y + 5.2, { align: 'right' });
  y += 8;

  doc.setTextColor(28, 25, 23);
  doc.setFont('helvetica', 'normal');
  indicators.forEach((ind, idx) => {
    const realVal = record.scores[ind.code];
    const calc = computeItem(ind, realVal);
    const label = ind.kpiName.length > 42 ? ind.kpiName.slice(0, 40) + '…' : ind.kpiName;
    const fmtUnit = (v: number | null | undefined) => {
      if (typeof v !== 'number') return '—';
      return ind.unit === '%' ? `${v}%` : `${v} ${ind.unit}`;
    };

    doc.rect(14, y, pageW - 28, 8);
    doc.text(String(idx + 1), 16, y + 5.2);
    doc.text(label, 24, y + 5.2);
    doc.text(ind.type, 102, y + 5.2);
    doc.text(`${ind.weight}%`, 124, y + 5.2, { align: 'right' });
    doc.text(fmtUnit(ind.target), 141, y + 5.2, { align: 'right' });
    doc.text(fmtUnit(realVal), 159, y + 5.2, { align: 'right' });
    doc.text(calc.achievement !== null ? `${calc.achievement.toFixed(1)}%` : '—', 177, y + 5.2, {
      align: 'right',
    });
    doc.text(calc.weighted !== null ? `${calc.weighted.toFixed(1)}%` : '—', pageW - 16, y + 5.2, {
      align: 'right',
    });
    y += 8;
  });

  y += 7;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text(
    `TOTAL NILAI TERTIMBANG: ${finalScore !== null ? `${finalScore.toFixed(1)}%` : '—'}   |   PREDIKAT PENCAPAIAN KPI: ${predicate}`,
    14,
    y
  );

  y += 8;
  doc.setFontSize(9);
  doc.text('Catatan & Rencana Tindak Lanjut:', 14, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  const noteLines = doc.splitTextToSize(record.notes || 'Tidak ada catatan tambahan.', pageW - 28);
  doc.text(noteLines, 14, y);
  y += noteLines.length * 4.5 + 12;

  doc.setFontSize(8.5);
  doc.text('Evaluator / Manager HC', 42, y, { align: 'center' });
  doc.text('Staf yang Dinilai', pageW - 42, y, { align: 'center' });
  y += 18;
  doc.line(20, y, 64, y);
  doc.line(pageW - 64, y, pageW - 20, y);
  doc.text(record.evaluatorName, 42, y + 4.5, { align: 'center' });
  doc.text(record.employeeName, pageW - 42, y + 4.5, { align: 'center' });

  const safeName = record.employeeName.replace(/[^a-zA-Z0-9]+/g, '_');
  doc.save(`Modul_KPI_${safeName}.pdf`);
}
