import ExcelJS from 'exceljs';
import type {
  AttendanceLateRule,
  AttendanceLogRecord,
  Employee,
} from '../types/hc';

export const DEFAULT_ATTENDANCE_RULE: AttendanceLateRule = {
  mode: 'tiered_hourly',
  graceMinutes: 0,
  penaltyPerOccurrence: 2700,
  penaltyPerMinute: 1000,
  blockMinutes: 15,
  penaltyPerBlock: 2700,
  defaultShiftStart: '06:05',
  shiftMode: 'three_shifts',
  shift1Start: '06:05',
  shift2Start: '11:05',
  shift3Start: '15:05',
  shiftMorningStart: '06:05',
  shiftAfternoonStart: '15:05',
  tier1Penalty: 2700,
  tier2Penalty: 5400,
  hourlyPenalty: 5400,
  convertWibToWita: true,
};

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_ROWS = 5000;

export function parseTimeToMinutes(
  timeStr: string,
  convertWibToWita = true
): number | null {
  const clean = timeStr.trim().toUpperCase();
  if (!clean || clean === '-' || clean === '—') return null;

  const isWib = /\bWIB\b/.test(clean);
  const stripped = clean.replace(/\b(WITA|WIB|WIT)\b/g, '').trim();
  const match = stripped.match(/^(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?$/);
  if (!match) return null;

  let h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  if (isWib && convertWibToWita) {
    h = (h + 1) % 24;
  }
  return h * 60 + m;
}

export function resolveShiftStartForCheckIn(
  checkIn: string,
  explicitShiftStart: string | undefined,
  rule: AttendanceLateRule
): string {
  if (explicitShiftStart && parseTimeToMinutes(explicitShiftStart, false) !== null) {
    return explicitShiftStart;
  }
  const shiftMode = rule.shiftMode || 'three_shifts';
  if (shiftMode === 'single_shift') {
    return rule.defaultShiftStart || rule.shift1Start || '06:05';
  }

  const checkInMins = parseTimeToMinutes(checkIn, rule.convertWibToWita ?? true);

  if (shiftMode === 'two_shifts') {
    if (checkInMins === null) {
      return rule.shiftMorningStart || '06:05';
    }
    return checkInMins < 11 * 60
      ? rule.shiftMorningStart || '06:05'
      : rule.shiftAfternoonStart || '15:05';
  }

  // three_shifts: Shift 1 = 06:05 (< 09:30), Shift 2 = 11:05 (09:30 - 13:29), Shift 3 = 15:05 (>= 13:30)
  if (checkInMins === null) {
    return rule.shift1Start || '06:05';
  }
  if (checkInMins < 9 * 60 + 30) {
    return rule.shift1Start || '06:05';
  }
  if (checkInMins < 13 * 60 + 30) {
    return rule.shift2Start || '11:05';
  }
  return rule.shift3Start || '15:05';
}

export function calculateLateMinutesFromTimes(
  shiftStart: string,
  checkIn: string,
  convertWibToWita = true
): number {
  const s = parseTimeToMinutes(shiftStart, false);
  const c = parseTimeToMinutes(checkIn, convertWibToWita);
  if (s === null || c === null) return 0;
  return Math.max(0, c - s);
}

export function computePenaltyForMinutes(
  lateMinutes: number,
  status: AttendanceLogRecord['status'],
  rule: AttendanceLateRule
): number {
  if (status === 'Izin' || status === 'Sakit' || status === 'Alpha') return 0;
  const billableMinutes = Math.max(0, lateMinutes - Math.max(0, rule.graceMinutes || 0));
  if (billableMinutes <= 0) return 0;

  if (rule.mode === 'tiered_hourly') {
    const t1 = Math.max(0, Math.round(rule.tier1Penalty ?? 2700));
    const t2 = Math.max(0, Math.round(rule.tier2Penalty ?? 5400));
    const hourly = Math.max(0, Math.round(rule.hourlyPenalty ?? 5400));
    if (billableMinutes <= 29) return t1;
    if (billableMinutes <= 59) return t2;
    return Math.floor(billableMinutes / 60) * hourly;
  }
  if (rule.mode === 'per_occurrence') {
    return Math.max(0, Math.round(rule.penaltyPerOccurrence || 0));
  }
  if (rule.mode === 'per_minute') {
    return Math.max(0, Math.round(billableMinutes * (rule.penaltyPerMinute || 0)));
  }
  const blockSize = Math.max(1, rule.blockMinutes || 15);
  const blocks = Math.ceil(billableMinutes / blockSize);
  return Math.max(0, Math.round(blocks * (rule.penaltyPerBlock || 0)));
}

export function recalculateAttendanceRecords(
  records: AttendanceLogRecord[],
  rule: AttendanceLateRule
): AttendanceLogRecord[] {
  const convertWib = rule.convertWibToWita ?? true;
  return records.map((rec) => {
    if (rec.status === 'Izin' || rec.status === 'Sakit' || rec.status === 'Alpha') {
      return { ...rec, lateMinutes: 0, penaltyAmount: 0 };
    }
    const shiftStart = resolveShiftStartForCheckIn(rec.checkIn, undefined, rule);
    let lateMinutes = rec.lateMinutes;
    if (rec.checkIn) {
      lateMinutes = calculateLateMinutesFromTimes(shiftStart, rec.checkIn, convertWib);
    }
    const billable = Math.max(0, lateMinutes - Math.max(0, rule.graceMinutes || 0));
    const nextStatus: AttendanceLogRecord['status'] =
      billable > 0 ? 'Terlambat' : 'Hadir';
    const penaltyAmount = computePenaltyForMinutes(lateMinutes, nextStatus, rule);
    return {
      ...rec,
      shiftStart,
      status: nextStatus,
      lateMinutes,
      penaltyAmount,
    };
  });
}

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function formatCellValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) {
    if (val.getUTCFullYear() <= 1900) {
      const hh = String(val.getUTCHours()).padStart(2, '0');
      const mm = String(val.getUTCMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    }
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === 'object') {
    const obj = val as { text?: string; result?: unknown; richText?: Array<{ text: string }> };
    if (typeof obj.text === 'string') return obj.text.trim();
    if (Array.isArray(obj.richText)) return obj.richText.map((r) => r.text).join('').trim();
    if (obj.result !== undefined) return formatCellValue(obj.result);
    return '';
  }
  if (typeof val === 'number') {
    if (val > 0 && val < 1) {
      const totalMins = Math.round(val * 24 * 60);
      const hh = String(Math.floor(totalMins / 60) % 24).padStart(2, '0');
      const mm = String(totalMins % 60).padStart(2, '0');
      return `${hh}:${mm}`;
    }
    return String(val);
  }
  return String(val).trim();
}

function normalizeDateString(raw: string): string {
  const clean = raw.trim();
  if (!clean) return new Date().toISOString().slice(0, 10);
  // DD-MM-YYYY or DD/MM/YYYY
  const dmy = clean.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  }
  // YYYY-MM-DD
  const ymd = clean.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  }
  return clean;
}

function normalizeBranchName(rawBranch: string, fallbackBranch?: string): string {
  const clean = rawBranch.trim();
  if (!clean) return fallbackBranch || 'Holding';
  const stripped = clean.replace(/^toko\s+kopi\s+tuju\s*/i, '').trim();
  const lower = stripped.toLowerCase();
  if (lower.includes('jemma')) return 'Djemma';
  if (lower.includes('abdesir')) return 'Abdesir';
  if (lower.includes('agus salim')) return 'Agus Salim';
  if (lower.includes('tamalanrea') || lower.includes('perintis')) return 'Perintis';
  if (lower.includes('tamalate')) return 'Tamalate';
  if (lower.includes('holding')) return 'Holding';
  return stripped || fallbackBranch || 'Holding';
}

function parseDelimitedText(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const firstLine = clean.split(/\r?\n/)[0] || '';
  const semiCount = (firstLine.match(/;/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delimiter = tabCount >= semiCount && tabCount >= commaCount && tabCount > 0
    ? '\t'
    : semiCount > commaCount
    ? ';'
    : ',';

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (ch === '"') {
      if (inQuotes && clean[i + 1] === '"') {
        currentCell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && clean[i + 1] === '\n') i += 1;
      currentRow.push(currentCell.trim());
      if (currentRow.some((c) => c !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
      if (rows.length >= MAX_ROWS) break;
    } else {
      currentCell += ch;
    }
  }
  if (currentCell !== '' || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c !== '')) {
      rows.push(currentRow);
    }
  }
  return rows;
}

function normalizeStatus(
  raw: string,
  checkIn: string,
  lateMinutes: number,
  graceMinutes: number
): AttendanceLogRecord['status'] {
  const s = raw.trim().toLowerCase();
  if (s === 'i' || s.includes('izin')) return 'Izin';
  if (s === 's' || s.includes('sakit')) return 'Sakit';
  if (s === 'a' || s.includes('alpha') || s.includes('alfa') || s.includes('mangkir') || s.includes('tidak hadir')) {
    return 'Alpha';
  }
  if (s.includes('telat') || s.includes('terlambat') || s === 'l' || s === 'late') {
    return lateMinutes > graceMinutes || !checkIn ? 'Terlambat' : 'Hadir';
  }
  if (!checkIn && (s === '' || s === '-')) {
    return 'Alpha';
  }
  return lateMinutes > graceMinutes ? 'Terlambat' : 'Hadir';
}

function parseMinutesNumber(raw: string): number {
  const clean = raw.trim();
  if (!clean) return 0;
  const hhmm = clean.match(/^(\d{1,2})[:.](\d{2})$/);
  if (hhmm) {
    return Number(hhmm[1]) * 60 + Number(hhmm[2]);
  }
  const numMatch = clean.match(/(\d+(?:[.,]\d+)?)/);
  if (!numMatch) return 0;
  return Math.max(0, Math.round(Number(numMatch[1].replace(',', '.')) || 0));
}

function matchEmployee(
  name: string,
  empCode: string,
  employees: Employee[]
): Employee | undefined {
  const needle = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const codeClean = empCode.toLowerCase().replace(/^(crew|crow)/, '').replace(/[^a-z0-9]/g, '');

  if (needle) {
    const exact = employees.find(
      (e) => e.name.toLowerCase().replace(/[^a-z0-9]/g, '') === needle
    );
    if (exact) return exact;
  }

  // Match word/token (e.g. "Dinda" -> "Adinda Larasati", "Aziz" -> "Muhammad Nur Aziz", "Mei" -> "Shinta Mei Rosha")
  const tokens = [name.trim().toLowerCase(), codeClean].filter((t) => t.length >= 3);
  for (const tok of tokens) {
    const wordHit = employees.find((e) =>
      e.name
        .toLowerCase()
        .split(/\s+/)
        .some((part) => part === tok || part.includes(tok))
    );
    if (wordHit) return wordHit;
  }
  return undefined;
}

export async function parseAttendanceFile(
  file: File,
  employees: Employee[],
  rule: AttendanceLateRule
): Promise<AttendanceLogRecord[]> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('Ukuran file maksimal 5 MB.');
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  let rawRows: string[][] = [];

  if (ext === 'xlsx') {
    const buffer = await file.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error('File Excel tidak memiliki sheet yang terbaca.');
    }
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      if (rawRows.length >= MAX_ROWS) return;
      const vals = row.values as unknown[];
      const cells = vals.slice(1).map(formatCellValue);
      if (cells.some((c) => c !== '')) {
        rawRows.push(cells);
      }
    });
  } else if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    const text = await file.text();
    rawRows = parseDelimitedText(text);
  } else if (ext === 'xls') {
    const text = await file.text();
    if (text.trim().startsWith('<')) {
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const trs = Array.from(doc.querySelectorAll('tr')).slice(0, MAX_ROWS);
      rawRows = trs
        .map((tr) =>
          Array.from(tr.querySelectorAll('th,td')).map((cell) =>
            (cell.textContent || '').trim()
          )
        )
        .filter((r) => r.some((c) => c !== ''));
    } else {
      rawRows = parseDelimitedText(text);
    }
  } else {
    throw new Error('Format file belum didukung. Gunakan file .xlsx, .csv, atau .tsv.');
  }

  if (rawRows.length < 2) {
    throw new Error('File absensi kosong atau hanya berisi header tanpa baris data.');
  }

  // Locate header row (supports metadata header rows like Daftar Kehadiran rows 1..6)
  let headerIdx = rawRows.findIndex((r) =>
    r.some((c) => {
      const h = normalizeHeader(c);
      return (
        h === 'nama karyawan' ||
        h === 'nama' ||
        h === 'name' ||
        h.includes('nama karyawan') ||
        h.includes('karyawan')
      );
    }) &&
    r.some((c) => {
      const h = normalizeHeader(c);
      return h.includes('masuk') || h.includes('tanggal') || h.includes('cabang');
    })
  );
  if (headerIdx === -1) {
    headerIdx = rawRows.findIndex((r) =>
      r.some((c) => {
        const h = normalizeHeader(c);
        return h.includes('nama') || h === 'name' || h.includes('karyawan') || h.includes('pegawai');
      })
    );
  }
  if (headerIdx === -1) headerIdx = 0;

  const headers = rawRows[headerIdx].map(normalizeHeader);
  const findCol = (exactKeys: string[], partialKeys: string[]) => {
    const exactIdx = headers.findIndex((h) => exactKeys.includes(h));
    if (exactIdx !== -1) return exactIdx;
    return headers.findIndex((h) => partialKeys.some((kw) => h.includes(kw)));
  };

  const empCodeCol = findCol(['id karyawan', 'id'], ['id karyawan', 'nip', 'kode']);
  const nameCol = findCol(['nama karyawan', 'nama', 'name'], ['nama', 'karyawan', 'pegawai', 'kru']);
  const branchCol = findCol(['cabang masuk', 'cabang', 'branch'], ['cabang', 'outlet', 'unit']);
  const dateCol = findCol(['tanggal masuk', 'tanggal', 'tgl', 'date'], ['tanggal masuk', 'tanggal', 'tgl', 'date']);
  const shiftCol = findCol(['jadwal masuk', 'jadwal', 'shift'], ['jadwal', 'shift', 'schedule']);
  const inCol = findCol(['jam masuk', 'scan masuk', 'check in', 'masuk'], ['jam masuk', 'scan masuk', 'check in', 'checkin', 'clock in']);
  const outCol = findCol(['jam pulang', 'scan pulang', 'check out', 'pulang'], ['jam pulang', 'scan pulang', 'check out', 'checkout', 'clock out']);
  const workDurCol = findCol(['jam kerja', 'durasi'], ['jam kerja', 'durasi']);
  const statusCol = findCol(['status', 'kehadiran', 'keterangan'], ['status', 'kehadiran', 'keterangan']);
  const lateCol = findCol(['menit terlambat', 'terlambat', 'telat', 'late'], ['menit terlambat', 'terlambat', 'telat', 'late']);
  const noteCol = findCol(['catatan', 'note', 'notes'], ['catatan', 'note']);

  if (nameCol === -1) {
    throw new Error(
      'Kolom "Nama Karyawan" / "Nama" tidak ditemukan. Pastikan file sesuai dengan template Daftar Kehadiran.'
    );
  }

  const parsed: AttendanceLogRecord[] = [];
  const dataRows = rawRows.slice(headerIdx + 1);
  const convertWib = rule.convertWibToWita ?? true;

  dataRows.forEach((row, idx) => {
    const employeeNameRaw = (row[nameCol] || '').trim();
    if (!employeeNameRaw) return;
    // Skip potential footer summary rows
    const lowerName = employeeNameRaw.toLowerCase();
    if (lowerName === 'total' || lowerName.startsWith('total ')) return;

    const employeeCode = empCodeCol >= 0 ? (row[empCodeCol] || '').trim() : undefined;
    const matched = matchEmployee(employeeNameRaw, employeeCode || '', employees);
    const branchRaw = branchCol >= 0 ? row[branchCol] || '' : '';
    const branch = normalizeBranchName(branchRaw, matched?.branch);
    const date = normalizeDateString(dateCol >= 0 ? row[dateCol] || '' : '');
    const checkIn = inCol >= 0 ? (row[inCol] || '').trim() : '';
    const checkOut = outCol >= 0 ? (row[outCol] || '').trim() : '';
    const workDuration = workDurCol >= 0 ? (row[workDurCol] || '').trim() : undefined;
    const explicitShift = shiftCol >= 0 ? (row[shiftCol] || '').trim() : undefined;
    const shiftStart = resolveShiftStartForCheckIn(checkIn, explicitShift, rule);

    const rawStatus = statusCol >= 0 ? row[statusCol] || '' : '';
    const explicitLate = lateCol >= 0 ? parseMinutesNumber(row[lateCol] || '') : 0;

    const calculatedLate =
      checkIn && shiftStart
        ? calculateLateMinutesFromTimes(shiftStart, checkIn, convertWib)
        : 0;
    const lateMinutes = explicitLate > 0 ? explicitLate : calculatedLate;
    const status = normalizeStatus(rawStatus, checkIn, lateMinutes, rule.graceMinutes);
    const finalLate =
      status === 'Izin' || status === 'Sakit' || status === 'Alpha' ? 0 : lateMinutes;
    const penaltyAmount = computePenaltyForMinutes(finalLate, status, rule);

    parsed.push({
      id: `att-${Date.now()}-${idx}`,
      employeeId: matched?.id,
      employeeCode,
      employeeName: matched?.name || employeeNameRaw,
      branch,
      date,
      shiftStart,
      checkIn,
      checkOut,
      workDuration,
      status,
      lateMinutes: finalLate,
      penaltyAmount,
      note: noteCol >= 0 ? (row[noteCol] || '').trim() : undefined,
    });
  });

  if (parsed.length === 0) {
    throw new Error('Tidak ada baris data kehadiran valid yang berhasil dibaca.');
  }

  return parsed;
}

function toBranchFullLabel(branch: string): string {
  const b = branch.toLowerCase();
  if (b.includes('djemma') || b.includes('jemma')) return 'Toko Kopi Tuju Andi Jemma';
  if (b.includes('perintis') || b.includes('tamalanrea')) return 'Toko Kopi Tuju Tamalanrea';
  if (b.includes('abdesir')) return 'Toko Kopi Tuju Abdesir';
  if (b.includes('agus salim')) return 'Toko Kopi Tuju Agus Salim';
  if (b.includes('tamalate')) return 'Toko Kopi Tuju Tamalate';
  return `Toko Kopi Tuju ${branch}`;
}

export async function downloadAttendanceTemplateXlsx(employees: Employee[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Daftar Kehadiran');

  // Row 1 & 2: Title & Brand (matching uploaded image_5b8c7d94.png)
  sheet.getCell('A1').value = 'Daftar Kehadiran';
  sheet.getCell('A1').font = { bold: true, size: 14 };
  sheet.getCell('A2').value = 'Toko Kopi Tuju';
  sheet.getCell('A2').font = { bold: true, size: 11 };

  // Row 4 & 5: Metadata
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const generatedStr = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ${pad(
    now.getHours()
  )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  sheet.getCell('A4').value = 'Tanggal Generate';
  sheet.getCell('C4').value = generatedStr;
  sheet.getCell('A5').value = 'Periode';
  sheet.getCell('C5').value = '26-10-2026 - 24-11-2026';

  // Row 7: Exact Table Header
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
  const headerRow = sheet.getRow(7);
  headerRow.values = headers;
  headerRow.font = { bold: true, size: 10 };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF3F4F6' },
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD6D3D1' } },
      left: { style: 'thin', color: { argb: 'FFD6D3D1' } },
      bottom: { style: 'thin', color: { argb: 'FFD6D3D1' } },
      right: { style: 'thin', color: { argb: 'FFD6D3D1' } },
    };
  });

  // Sample rows mirroring Daftar Kehadiran Toko Kopi Tuju
  const sampleSeeds = [
    { code: 'crewdinda', short: 'Dinda', branch: 'Toko Kopi Tuju Andi Jemma', inT: '05:56 WITA', outT: '15:53 WITA', dur: '9 Jam 56 Menit' },
    { code: 'crewanas', short: 'Anas', branch: 'Toko Kopi Tuju Tamalate', inT: '05:44 WITA', outT: '15:30 WITA', dur: '9 Jam 46 Menit' },
    { code: 'crewaziz', short: 'Aziz', branch: 'Toko Kopi Tuju Abdesir', inT: '06:14 WITA', outT: '16:01 WITA', dur: '9 Jam 47 Menit' },
    { code: 'crewaffan', short: 'Affan', branch: 'Toko Kopi Tuju Abdesir', inT: '06:10 WITA', outT: '16:10 WITA', dur: '10 Jam 0 Menit' },
    { code: 'crewqayyum', short: 'Qayyum', branch: 'Toko Kopi Tuju Abdesir', inT: '14:04 WITA', outT: '23:54 WITA', dur: '9 Jam 50 Menit' },
    { code: 'crewregina', short: 'Regina', branch: 'Toko Kopi Tuju Andi Jemma', inT: '14:15 WITA', outT: '23:53 WITA', dur: '9 Jam 38 Menit' },
  ];

  const rowsToWrite =
    employees.length >= 6
      ? sampleSeeds.map((s, idx) => [
          idx + 1,
          s.code,
          s.short,
          s.branch,
          '26-10-2026',
          s.inT,
          s.branch,
          '26-10-2026',
          s.outT,
          s.dur,
        ])
      : employees.slice(0, 6).map((emp, idx) => {
          const short = emp.name.split(' ')[0];
          const bLabel = toBranchFullLabel(emp.branch);
          const s = sampleSeeds[idx % sampleSeeds.length];
          return [
            idx + 1,
            `crew${short.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
            short,
            bLabel,
            '26-10-2026',
            s.inT,
            bLabel,
            '26-10-2026',
            s.outT,
            s.dur,
          ];
        });

  rowsToWrite.forEach((vals, i) => {
    const r = sheet.getRow(8 + i);
    r.values = vals;
    r.font = { size: 10 };
    r.eachCell((cell, colNumber) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE7E5E4' } },
        left: { style: 'thin', color: { argb: 'FFE7E5E4' } },
        bottom: { style: 'thin', color: { argb: 'FFE7E5E4' } },
        right: { style: 'thin', color: { argb: 'FFE7E5E4' } },
      };
      if (colNumber === 1 || colNumber === 5 || colNumber === 6 || colNumber === 8 || colNumber === 9) {
        cell.alignment = { horizontal: 'center' };
      }
    });
  });

  sheet.columns = [
    { width: 6 },
    { width: 16 },
    { width: 18 },
    { width: 28 },
    { width: 15 },
    { width: 14 },
    { width: 28 },
    { width: 15 },
    { width: 14 },
    { width: 16 },
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Template_Daftar_Kehadiran_Kopi_Tuju.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}
