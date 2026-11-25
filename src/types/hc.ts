export type ConfigurableRole =
  | 'Manager Operasional'
  | 'Manager Marketing'
  | 'Manager Akunting & Finance'
  | 'Manager SCM'
  | 'Staf HC'
  | 'Staf Admin Operasional'
  | 'Staf Marketing'
  | 'Staf Akunting'
  | 'Staf General Affair'
  | 'Staf Bisnis Development'
  | 'Staf Gudang'
  | 'Supervisor';

export type UserRole = 'Admin' | 'HR Manager' | ConfigurableRole | 'Barista';

export type BranchName =
  | 'Abdesir'
  | 'Agus Salim'
  | 'Djemma'
  | 'Holding'
  | 'Perintis'
  | 'Tamalate';

export type EmploymentStatus = 'Aktif' | 'Onboarding' | 'Probation' | 'Non-Aktif';

export type AttendanceCode = 'H' | 'I' | 'S' | 'A' | '';

export type AspectKey =
  | 'teknis'
  | 'layanan'
  | 'pengetahuan'
  | 'kebersihan'
  | 'kasir'
  | 'sikap';

export interface RoleFeatureAccess {
  canAccessCrew: boolean;
  canAccessOnboarding: boolean;
  canAccessPayroll: boolean;
  canAccessAttendance: boolean;
  canAccessLiveAttendance?: boolean;
  canAccessKpi: boolean;
  canAccessAccessControl: boolean;
  canViewOwnPayslip: boolean;
  canDownloadOwnPayslip: boolean;
}

export interface FeaturePermissions {
  baristaCanUseLiveAttendance?: boolean;
  baristaCanViewOwnPayslip: boolean;
  baristaCanDownloadPayslip: boolean;
  baristaCanViewOwnTraining: boolean;
  baristaCanViewTrainingSchedule: boolean;
  baristaCanViewCrewDirectory: boolean;
  baristaCanViewIncentiveSummary: boolean;
  baristaCanEditOwnContact: boolean;
  managerFeatures?: RoleFeatureAccess;
  supervisorFeatures: RoleFeatureAccess;
  roleFeatures: Record<ConfigurableRole, RoleFeatureAccess>;
}

export interface UserAccount {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: UserRole;
  employeeId?: string;
  hasPassword?: boolean;
  active: boolean;
  createdAt: string;
}

export interface Employee {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string;
  branch: BranchName;
  position: string;
  role: UserRole;
  status: EmploymentStatus;
  startDate: string;
  trainingCompletedDate: string;
  certifications: string[];
  baseSalary: number;
  dailyRate: number;
  trainingRatePerDay: number;
  payMode: 'bulanan' | 'prorata_harian';
  bankAccount: string;
  bankName: string;
}

export interface EvaluationIndicator {
  code: string; // A1..F5
  aspect: AspectKey;
  aspectLabel: string;
  standard: string;
  method: string;
}

export interface TrainingScheduleDay {
  day: number; // 1..14
  topic: string;
  trainer: string;
  status: 'Terjadwal' | 'Berjalan' | 'Selesai';
  notes: string;
}

export interface TraineeRecord {
  id: string;
  employeeId?: string;
  name: string;
  email: string;
  branch: BranchName;
  startDate: string;
  completionDate: string;
  certifications: string[];
  attendance: AttendanceCode[]; // length 14
  scores: Record<string, number | null>; // key: A1..F5, value: 1..5 or null
  trainerNotes: string;
  isExample?: boolean;
}

export interface EvaluationSettings {
  weights: Record<AspectKey, number>;
  thresholds: {
    sangatBaik: number; // 90
    baik: number; // 80
    cukup: number; // 70
  };
  criticalHygieneMin: number; // 70
}

export interface TrainingBatch {
  id: string;
  name: string;
  startDate: string;
  trainer: string;
  schedule: TrainingScheduleDay[];
  trainees: TraineeRecord[]; // max 25
  settings: EvaluationSettings;
}

export interface PayrollEntry {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  branch: BranchName;
  hariKerja: number;
  izinSakit: number;
  gajiPokokDasar: number;
  gajiPokokDibayar: number;
  payMode: 'bulanan' | 'prorata_harian';
  insentifPenjualan: number;
  jumlahHariLembur: number;
  uangLembur: number;
  jumlahHariTraining: number;
  uangTraining: number;
  potonganSelisih: number;
  potonganKetidakhadiran: number;
  potonganKasbon: number;
  potonganKeterlambatan: number;
  totalGaji: number;
  rekening: string;
  bank: string;
  slipSentAt?: string;
  slipSentTo?: string;
  slipStatus?: 'Belum Dikirim' | 'Terkirim' | 'Gagal';
  slipError?: string;
}

export interface HoldingIncentiveEntry {
  id: string;
  employeeId: string;
  name: string;
  branch: BranchName;
  jabatan: string;
  kpiPercent: number;
  insentifKpi: number;
  uangTransport: number;
  insentifPenjualan: number;
  bonusLainnya: number;
  totalInsentif: number;
}

export interface PayrollPeriod {
  id: string;
  label: string;
  slipDateLabel: string;
  status: 'Draft' | 'Finalized';
  finalizedAt?: string;
  gajiHarianStandar: number;
  uangTrainingPerHari: number;
  entries: PayrollEntry[];
  holdingIncentives: HoldingIncentiveEntry[];
}

export type KpiDivisionKey =
  | 'admin_ops'
  | 'marketing'
  | 'supervisor'
  | 'akunting'
  | 'kepala_outlet';

export type KpiType = 'Maximize' | 'Minimize';

export interface KpiJobDescription {
  division: KpiDivisionKey;
  items: string[];
}

export interface KpiIndicatorItem {
  code: string;
  division: KpiDivisionKey;
  kpiName: string;
  definition: string;
  type: KpiType;
  weight: number;
  target: number;
  unit: string;
}

export interface KpiEvaluationRecord {
  id: string;
  division: KpiDivisionKey;
  periodLabel: string;
  employeeId?: string;
  employeeName: string;
  branch: BranchName;
  evaluatorName: string;
  evaluatedDate: string;
  scores: Record<string, number | null>;
  notes: string;
}

export interface PayslipDispatchLog {
  id: string;
  periodId: string;
  periodLabel: string;
  employeeId: string;
  employeeName: string;
  email: string;
  status: 'Terkirim' | 'Gagal';
  message: string;
  sentBy: string;
  timestamp: string;
}

export interface AttendanceLateRule {
  mode: 'tiered_hourly' | 'per_occurrence' | 'per_minute' | 'per_block';
  graceMinutes: number;
  penaltyPerOccurrence: number;
  penaltyPerMinute: number;
  blockMinutes: number;
  penaltyPerBlock: number;
  defaultShiftStart: string;
  shiftMode?: 'three_shifts' | 'two_shifts' | 'single_shift';
  shift1Start?: string;
  shift2Start?: string;
  shift3Start?: string;
  shiftMorningStart?: string;
  shiftAfternoonStart?: string;
  tier1Penalty?: number; // 0-29 menit
  tier2Penalty?: number; // 30-59 menit
  hourlyPenalty?: number; // >=60 menit kelipatan per jam
  convertWibToWita?: boolean;
}

export interface AttendanceLogRecord {
  id: string;
  employeeId?: string;
  employeeCode?: string;
  employeeName: string;
  branch: BranchName | string;
  date: string;
  shiftStart: string;
  checkIn: string;
  checkOut: string;
  workDuration?: string;
  status: 'Hadir' | 'Terlambat' | 'Izin' | 'Sakit' | 'Alpha';
  lateMinutes: number;
  penaltyAmount: number;
  note?: string;
}

export interface AttendanceUploadBatch {
  id: string;
  periodLabel: string;
  fileName: string;
  uploadedAt: string;
  rule: AttendanceLateRule;
  records: AttendanceLogRecord[];
}

export interface OutletLocationConfig {
  branch: BranchName;
  configured: boolean;
  lat: number | null;
  lng: number | null;
  radiusMeters: number;
  addressLabel: string;
  updatedBy?: string;
  updatedAt?: string;
}

export interface LiveAttendanceRecord {
  id: string;
  userId: string;
  employeeId?: string;
  employeeName: string;
  role: UserRole;
  branch: BranchName;
  date: string; // YYYY-MM-DD (Asia/Makassar WITA)
  shiftLabel: string;
  shiftStart: string; // HH:mm
  clockInTime?: string; // HH:mm
  clockInLat?: number;
  clockInLng?: number;
  clockInDistanceMeters?: number;
  clockOutTime?: string; // HH:mm
  clockOutLat?: number;
  clockOutLng?: number;
  clockOutDistanceMeters?: number;
  status: 'Hadir' | 'Terlambat';
  lateMinutes: number;
  penaltyAmount: number;
  workDuration?: string;
  note?: string;
}

export interface TodayClockState {
  date: string;
  branch: BranchName;
  hasClockedIn: boolean;
  hasClockedOut: boolean;
}

export interface HcAppState {
  employees: Employee[];
  batches: TrainingBatch[];
  indicators: EvaluationIndicator[];
  payrollPeriods: PayrollPeriod[];
  personalPayrollPeriods?: PayrollPeriod[];
  dispatchLogs: PayslipDispatchLog[];
  permissions: FeaturePermissions;
  users: UserAccount[];
  kpiJobDescriptions: KpiJobDescription[];
  kpiTemplates: KpiIndicatorItem[];
  kpiEvaluations: KpiEvaluationRecord[];
  attendanceBatches: AttendanceUploadBatch[];
  outletLocations?: OutletLocationConfig[];
  liveAttendanceRecords?: LiveAttendanceRecord[];
  myTodayClockState?: TodayClockState | null;
}
