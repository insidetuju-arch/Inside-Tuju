import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createInitialSeedState,
  DEFAULT_OUTLET_LOCATIONS,
  DEFAULT_ROLE_FEATURES,
  OWNER_FULL_FEATURES,
} from './server/seedData.ts';
import type {
  BranchName,
  ConfigurableRole,
  FeaturePermissions,
  HcAppState,
  LiveAttendanceRecord,
  OutletLocationConfig,
  PayrollPeriod,
  RoleFeatureAccess,
  UserAccount,
  UserRole,
} from './src/types/hc.ts';
import {
  calculateHaversineMeters,
  computeLiveClockInPenalty,
  computeWorkDurationLabel,
  getWitaDateAndTime,
} from './src/utils/calculations.ts';

interface StoredUser extends UserAccount {
  passwordHash: string;
}

interface StoredState extends Omit<HcAppState, 'users'> {
  users: StoredUser[];
  staffAccountsBulkProvisioned?: boolean;
}

interface SessionPayload {
  userId: string;
  role: UserRole;
  exp: number;
  jti: string;
}

interface AuthenticatedRequest extends Request {
  authUser?: StoredUser;
  authTokenJti?: string;
}

const PORT = Number(process.env.PORT) || 3000;

function resolveWritableDataDir(): string {
  const preferred = path.resolve(process.cwd(), 'data');
  try {
    if (!fs.existsSync(preferred)) {
      fs.mkdirSync(preferred, { recursive: true });
    }
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch {
    const fallback = path.join(os.tmpdir(), 'kopituju-hc-data');
    if (!fs.existsSync(fallback)) {
      fs.mkdirSync(fallback, { recursive: true });
    }
    return fallback;
  }
}

const DATA_DIR = resolveWritableDataDir();
const STORE_PATH = path.resolve(DATA_DIR, 'hc-store.json');
const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

const revokedTokens = new Set<string>();

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derived = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derived.length) return false;
  return crypto.timingSafeEqual(keyBuf, derived);
}

function signSessionToken(user: StoredUser): string {
  const payload: SessionPayload = {
    userId: user.id,
    role: user.role,
    exp: Date.now() + 1000 * 60 * 60 * 12, // 12 hours
    jti: crypto.randomBytes(12).toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload.userId || !payload.exp || payload.exp < Date.now()) return null;
    if (revokedTokens.has(payload.jti)) return null;
    return payload;
  } catch {
    return null;
  }
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function provisionMissingStaffAndBaristaUsers(
  state: StoredState,
  defaultPassword: string
): StoredUser[] {
  const existingUsernames = new Set(state.users.map((u) => u.username.toLowerCase()));
  const existingEmails = new Set(state.users.map((u) => u.email.toLowerCase()));
  const existingEmpIds = new Set(
    state.users.map((u) => u.employeeId).filter((id): id is string => Boolean(id))
  );

  const created: StoredUser[] = [];
  const now = new Date().toISOString();

  for (const emp of state.employees || []) {
    if (emp.role === 'Admin' || emp.role === 'HR Manager') continue;
    const emailLower = (emp.email || '').trim().toLowerCase();
    if (!emailLower || !emailLower.includes('@')) continue;
    if (existingEmpIds.has(emp.id) || existingEmails.has(emailLower)) continue;

    const baseUsername =
      emailLower.split('@')[0].replace(/[^a-z0-9._-]/g, '') ||
      emp.name.toLowerCase().replace(/[^a-z0-9]+/g, '.');
    let candidate = baseUsername;
    let suffix = 2;
    while (existingUsernames.has(candidate)) {
      candidate = `${baseUsername}${suffix}`;
      suffix += 1;
    }

    const user: StoredUser = {
      id: `usr-${emp.id}`,
      username: candidate,
      email: emailLower,
      fullName: emp.name,
      role: emp.role,
      employeeId: emp.id,
      active: emp.status !== 'Non-Aktif',
      createdAt: now,
      passwordHash: hashPassword(defaultPassword),
    };

    state.users.push(user);
    existingUsernames.add(candidate);
    existingEmails.add(emailLower);
    existingEmpIds.add(emp.id);
    created.push(user);
  }

  return created;
}

function loadStore(): StoredState {
  ensureDataDir();
  if (!fs.existsSync(STORE_PATH)) {
    const seed = createInitialSeedState();
    const initial: StoredState = { ...seed, users: [], staffAccountsBulkProvisioned: true };
    provisionMissingStaffAndBaristaUsers(
      initial,
      process.env.DEFAULT_STAFF_PASSWORD || 'Keluargatuju'
    );
    saveStore(initial);
    return initial;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as StoredState;
    const firstBatch = parsed.batches?.[0];
    if (!firstBatch || firstBatch.id === 'batch-nov-2026' || 'categoryRules' in ((firstBatch.settings as unknown as Record<string, unknown>) || {})) {
      const fresh = createInitialSeedState();
      const migrated: StoredState = {
        ...parsed,
        batches: fresh.batches,
        indicators: fresh.indicators,
      };
      saveStore(migrated);
      return migrated;
    }
    const needsIndicatorMigration = (parsed.indicators || []).some(
      (ind) =>
        ind.code === 'A4' ||
        ind.code === 'A5' ||
        (ind.code === 'A3' && ind.standard.toLowerCase().includes('steaming susu'))
    );
    if (needsIndicatorMigration) {
      const migrated: StoredState = {
        ...parsed,
        indicators: (parsed.indicators || [])
          .filter(
            (ind) =>
              ind.code !== 'A4' &&
              !(ind.code === 'A3' && ind.standard.toLowerCase().includes('steaming susu'))
          )
          .map((ind) => (ind.code === 'A5' ? { ...ind, code: 'A3' } : ind)),
        batches: (parsed.batches || []).map((b) => ({
          ...b,
          schedule: b.schedule.map((s) =>
            s.day === 13 && s.topic.includes('30 Indikator')
              ? { ...s, topic: s.topic.replace('30 Indikator', '28 Indikator') }
              : s
          ),
          trainees: b.trainees.map((t) => {
            const nextScores = { ...t.scores };
            if (nextScores.A5 !== undefined) {
              nextScores.A3 = nextScores.A5;
            }
            delete nextScores.A4;
            delete nextScores.A5;
            return { ...t, scores: nextScores };
          }),
        })),
      };
      saveStore(migrated);
      return migrated;
    }
    const needsKpiMigration =
      !Array.isArray(parsed.kpiJobDescriptions) ||
      !Array.isArray(parsed.kpiTemplates) ||
      !Array.isArray(parsed.kpiEvaluations) ||
      !parsed.kpiTemplates.some((item) => 'type' in item && 'definition' in item);
    if (needsKpiMigration) {
      const fresh = createInitialSeedState();
      const migrated: StoredState = {
        ...parsed,
        kpiJobDescriptions: fresh.kpiJobDescriptions,
        kpiTemplates: fresh.kpiTemplates,
        kpiEvaluations: fresh.kpiEvaluations,
      };
      saveStore(migrated);
      return migrated;
    }
    const needsAttendanceMigration =
      !Array.isArray(parsed.attendanceBatches) ||
      (parsed.attendanceBatches.length === 1 &&
        parsed.attendanceBatches[0]?.id === 'att-batch-okt26' &&
        (parsed.attendanceBatches[0]?.fileName === 'Rekap_Fingerprint_Oktober_2026.xlsx' ||
          parsed.attendanceBatches[0]?.rule?.shiftMode !== 'three_shifts'));
    if (needsAttendanceMigration) {
      const fresh = createInitialSeedState();
      const migrated: StoredState = {
        ...parsed,
        attendanceBatches: fresh.attendanceBatches,
      };
      saveStore(migrated);
      return migrated;
    }
    const rawRoleFeatures = (parsed.permissions?.roleFeatures || {}) as Partial<
      Record<ConfigurableRole, RoleFeatureAccess>
    >;
    const needsPermissionsMigration =
      !parsed.permissions ||
      !parsed.permissions.roleFeatures ||
      CONFIGURABLE_ROLES.some((r) => !rawRoleFeatures[r]) ||
      parsed.permissions.managerFeatures?.canViewOwnPayslip !== false ||
      parsed.permissions.managerFeatures?.canDownloadOwnPayslip !== false;
    if (needsPermissionsMigration) {
      const fresh = createInitialSeedState();
      const legacySup = parsed.permissions?.supervisorFeatures;
      const mergedRoleFeatures = normalizeAllRoleFeatures(
        {
          ...rawRoleFeatures,
          Supervisor: rawRoleFeatures.Supervisor || legacySup,
        },
        DEFAULT_ROLE_FEATURES
      );
      const migrated: StoredState = {
        ...parsed,
        permissions: {
          ...fresh.permissions,
          ...(parsed.permissions || {}),
          managerFeatures: OWNER_FULL_FEATURES,
          supervisorFeatures: mergedRoleFeatures.Supervisor,
          roleFeatures: mergedRoleFeatures,
        },
      };
      saveStore(migrated);
      return migrated;
    }
    const needsOutletMigration =
      !Array.isArray(parsed.outletLocations) ||
      parsed.outletLocations.length < DEFAULT_OUTLET_LOCATIONS.length ||
      !Array.isArray(parsed.liveAttendanceRecords);
    if (needsOutletMigration) {
      const existingOutlets = Array.isArray(parsed.outletLocations) ? parsed.outletLocations : [];
      const mergedOutlets: OutletLocationConfig[] = DEFAULT_OUTLET_LOCATIONS.map((def) => {
        const found = existingOutlets.find((o) => o.branch === def.branch);
        return found
          ? {
              ...def,
              ...found,
              radiusMeters:
                Number.isFinite(found.radiusMeters) && found.radiusMeters >= 20
                  ? found.radiusMeters
                  : 100,
            }
          : def;
      });
      const migrated: StoredState = {
        ...parsed,
        outletLocations: mergedOutlets,
        liveAttendanceRecords: Array.isArray(parsed.liveAttendanceRecords)
          ? parsed.liveAttendanceRecords
          : [],
      };
      saveStore(migrated);
      return migrated;
    }
    if (!parsed.staffAccountsBulkProvisioned) {
      const next: StoredState = {
        ...parsed,
        permissions: {
          ...parsed.permissions,
          baristaCanUseLiveAttendance:
            parsed.permissions?.baristaCanUseLiveAttendance ?? true,
        },
        staffAccountsBulkProvisioned: true,
      };
      provisionMissingStaffAndBaristaUsers(
        next,
        process.env.DEFAULT_STAFF_PASSWORD || 'Keluargatuju'
      );
      saveStore(next);
      return next;
    }
    return parsed;
  } catch {
    const seed = createInitialSeedState();
    const initial: StoredState = { ...seed, users: [] };
    saveStore(initial);
    return initial;
  }
}

function saveStore(state: StoredState) {
  ensureDataDir();
  const resolved = path.resolve(STORE_PATH);
  if (!resolved.startsWith(DATA_DIR + path.sep)) {
    throw new Error('Invalid store path');
  }
  const tmpPath = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmpPath, resolved);
}

function sanitizeUser(u: StoredUser): UserAccount {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    employeeId: u.employeeId,
    hasPassword: Boolean(u.passwordHash),
    active: u.active,
    createdAt: u.createdAt,
  };
}

function buildMimeWithPdfAttachment(params: {
  to: string;
  subject: string;
  htmlBody: string;
  pdfBase64: string;
  fileName: string;
}): string {
  const boundary = `tuju_slip_${crypto.randomBytes(10).toString('hex')}`;
  const cleanTo = params.to.replace(/[\r\n]/g, '').trim();
  const cleanSubject = params.subject.replace(/[\r\n]/g, ' ').trim();
  const encodedSubject = `=?UTF-8?B?${Buffer.from(cleanSubject, 'utf8').toString('base64')}?=`;
  const cleanFileName = params.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');

  const lines = [
    `To: ${cleanTo}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(params.htmlBody, 'utf8').toString('base64'),
    '',
    `--${boundary}`,
    `Content-Type: application/pdf; name="${cleanFileName}"`,
    `Content-Disposition: attachment; filename="${cleanFileName}"`,
    'Content-Transfer-Encoding: base64',
    '',
    params.pdfBase64,
    '',
    `--${boundary}--`,
  ];

  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Sesi login diperlukan.' });
    return;
  }
  const token = header.slice(7).trim();
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Sesi tidak valid atau telah berakhir.' });
    return;
  }
  const store = loadStore();
  const user = store.users.find((u) => u.id === payload.userId && u.active);
  if (!user) {
    res.status(401).json({ error: 'Akun pengguna tidak aktif atau tidak ditemukan.' });
    return;
  }
  req.authUser = user;
  req.authTokenJti = payload.jti;
  next();
}

const CONFIGURABLE_ROLES: ConfigurableRole[] = [
  'Manager Operasional',
  'Manager Marketing',
  'Manager Akunting & Finance',
  'Manager SCM',
  'Staf HC',
  'Staf Admin Operasional',
  'Staf Marketing',
  'Staf Akunting',
  'Staf General Affair',
  'Staf Bisnis Development',
  'Staf Gudang',
  'Supervisor',
];

function isConfigurableRole(role: unknown): role is ConfigurableRole {
  return typeof role === 'string' && (CONFIGURABLE_ROLES as string[]).includes(role);
}

function isValidUserRole(role: unknown): role is UserRole {
  return role === 'Admin' || role === 'HR Manager' || role === 'Barista' || isConfigurableRole(role);
}

function normalizeRoleFeatureAccess(
  raw: Partial<RoleFeatureAccess> | undefined,
  fallback: RoleFeatureAccess
): RoleFeatureAccess {
  return {
    canAccessCrew:
      typeof raw?.canAccessCrew === 'boolean' ? raw.canAccessCrew : fallback.canAccessCrew,
    canAccessOnboarding:
      typeof raw?.canAccessOnboarding === 'boolean'
        ? raw.canAccessOnboarding
        : fallback.canAccessOnboarding,
    canAccessPayroll:
      typeof raw?.canAccessPayroll === 'boolean'
        ? raw.canAccessPayroll
        : fallback.canAccessPayroll,
    canAccessAttendance:
      typeof raw?.canAccessAttendance === 'boolean'
        ? raw.canAccessAttendance
        : fallback.canAccessAttendance,
    canAccessLiveAttendance:
      typeof raw?.canAccessLiveAttendance === 'boolean'
        ? raw.canAccessLiveAttendance
        : (fallback.canAccessLiveAttendance ?? true),
    canAccessKpi:
      typeof raw?.canAccessKpi === 'boolean' ? raw.canAccessKpi : fallback.canAccessKpi,
    canAccessAccessControl:
      typeof raw?.canAccessAccessControl === 'boolean'
        ? raw.canAccessAccessControl
        : fallback.canAccessAccessControl,
    canViewOwnPayslip:
      typeof raw?.canViewOwnPayslip === 'boolean'
        ? raw.canViewOwnPayslip
        : fallback.canViewOwnPayslip,
    canDownloadOwnPayslip:
      typeof raw?.canDownloadOwnPayslip === 'boolean'
        ? raw.canDownloadOwnPayslip
        : fallback.canDownloadOwnPayslip,
  };
}

function normalizeAllRoleFeatures(
  raw: Partial<Record<ConfigurableRole, Partial<RoleFeatureAccess>>> | undefined,
  fallback: Record<ConfigurableRole, RoleFeatureAccess>
): Record<ConfigurableRole, RoleFeatureAccess> {
  return {
    'Manager Operasional': normalizeRoleFeatureAccess(
      raw?.['Manager Operasional'],
      fallback['Manager Operasional']
    ),
    'Manager Marketing': normalizeRoleFeatureAccess(
      raw?.['Manager Marketing'],
      fallback['Manager Marketing']
    ),
    'Manager Akunting & Finance': normalizeRoleFeatureAccess(
      raw?.['Manager Akunting & Finance'],
      fallback['Manager Akunting & Finance']
    ),
    'Manager SCM': normalizeRoleFeatureAccess(raw?.['Manager SCM'], fallback['Manager SCM']),
    'Staf HC': normalizeRoleFeatureAccess(raw?.['Staf HC'], fallback['Staf HC']),
    'Staf Admin Operasional': normalizeRoleFeatureAccess(
      raw?.['Staf Admin Operasional'],
      fallback['Staf Admin Operasional']
    ),
    'Staf Marketing': normalizeRoleFeatureAccess(
      raw?.['Staf Marketing'],
      fallback['Staf Marketing']
    ),
    'Staf Akunting': normalizeRoleFeatureAccess(raw?.['Staf Akunting'], fallback['Staf Akunting']),
    'Staf General Affair': normalizeRoleFeatureAccess(
      raw?.['Staf General Affair'],
      fallback['Staf General Affair']
    ),
    'Staf Bisnis Development': normalizeRoleFeatureAccess(
      raw?.['Staf Bisnis Development'],
      fallback['Staf Bisnis Development']
    ),
    'Staf Gudang': normalizeRoleFeatureAccess(raw?.['Staf Gudang'], fallback['Staf Gudang']),
    Supervisor: normalizeRoleFeatureAccess(raw?.Supervisor, fallback.Supervisor),
  };
}

function getRoleFeatureAccess(role: UserRole, permissions: FeaturePermissions): RoleFeatureAccess {
  // Akun Admin & Manager HC sebagai akun Owner memiliki kontrol penuh dan tidak memerlukan slip gaji pribadi
  if (role === 'Admin' || role === 'HR Manager') {
    return OWNER_FULL_FEATURES;
  }
  if (isConfigurableRole(role)) {
    const raw =
      permissions.roleFeatures?.[role] ||
      (role === 'Supervisor' ? permissions.supervisorFeatures : undefined);
    return normalizeRoleFeatureAccess(raw, DEFAULT_ROLE_FEATURES[role]);
  }
  return {
    canAccessCrew: false,
    canAccessOnboarding: false,
    canAccessPayroll: false,
    canAccessAttendance: false,
    canAccessLiveAttendance: true,
    canAccessKpi: false,
    canAccessAccessControl: false,
    canViewOwnPayslip: Boolean(permissions.baristaCanViewOwnPayslip),
    canDownloadOwnPayslip: Boolean(permissions.baristaCanDownloadPayslip),
  };
}

function canManageTargetRole(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === 'Admin') return true;
  if (actorRole === 'HR Manager') {
    return targetRole !== 'Admin' && targetRole !== 'HR Manager';
  }
  if (isConfigurableRole(actorRole)) {
    return targetRole === 'Barista';
  }
  return false;
}

function requireOwnerRole(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const actor = req.authUser;
  if (!actor || (actor.role !== 'Admin' && actor.role !== 'HR Manager')) {
    res.status(403).json({
      error: 'Fitur ini hanya dapat dilihat. Perubahan data hanya diizinkan untuk Admin atau Manager HC (Owner).',
    });
    return;
  }
  next();
}

function requireModuleAccess(moduleKey: keyof RoleFeatureAccess) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const actor = req.authUser;
    if (!actor || actor.role === 'Barista') {
      res.status(403).json({ error: 'Akses ditolak. Khusus Pengelola, Manager, Staf HC, atau Supervisor.' });
      return;
    }
    const store = loadStore();
    const access = getRoleFeatureAccess(actor.role, store.permissions);
    if (!access[moduleKey]) {
      res.status(403).json({ error: 'Akses fitur ini dinonaktifkan untuk posisi Anda.' });
      return;
    }
    next();
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  // Ensure initial store file exists
  loadStore();

  // Auth status & bootstrap
  app.get('/api/auth/bootstrap-status', (_req, res) => {
    const store = loadStore();
    const envPasscode = (process.env.ADMIN_PASSCODE || '').trim();
    const hasAdmin = store.users.some((u) => u.role === 'Admin' && u.passwordHash);
    res.json({
      needsBootstrap: !hasAdmin && !envPasscode,
      envPasscodeActive: Boolean(envPasscode),
    });
  });

  app.post('/api/auth/bootstrap', (req, res) => {
    const store = loadStore();
    const envPasscode = (process.env.ADMIN_PASSCODE || '').trim();
    const hasAdmin = store.users.some((u) => u.role === 'Admin' && u.passwordHash);
    if (hasAdmin || envPasscode) {
      res.status(409).json({ error: 'Akun Admin sudah terdaftar.' });
      return;
    }

    const { fullName, email, username, password, createStarterAccounts, starterPassword } =
      req.body || {};

    if (
      typeof fullName !== 'string' ||
      !fullName.trim() ||
      typeof email !== 'string' ||
      !email.includes('@') ||
      typeof password !== 'string' ||
      password.length < 6
    ) {
      res.status(400).json({ error: 'Nama lengkap, email valid, dan password minimal 6 karakter wajib diisi.' });
      return;
    }

    const now = new Date().toISOString();
    const adminUser: StoredUser = {
      id: 'usr-admin-1',
      username: (typeof username === 'string' && username.trim()) || email.trim().toLowerCase(),
      email: email.trim().toLowerCase(),
      fullName: fullName.trim(),
      role: 'Admin',
      active: true,
      createdAt: now,
      passwordHash: hashPassword(password),
    };
    store.users.push(adminUser);

    if (createStarterAccounts && typeof starterPassword === 'string' && starterPassword.length >= 6) {
      const hrEmp = store.employees.find((e) => e.name === 'Rofifah') || store.employees[0];
      const baristaEmp =
        store.employees.find((e) => e.name === 'Affan Azzam Alghazali') || store.employees[2];

      store.users.push({
        id: 'usr-hr-1',
        username: 'hc.kopituju',
        email: hrEmp ? hrEmp.email : 'hc@kopituju.id',
        fullName: hrEmp ? `${hrEmp.name} (Manager HC)` : 'Manager HC Kopi Tuju',
        role: 'HR Manager',
        employeeId: hrEmp?.id,
        active: true,
        createdAt: now,
        passwordHash: hashPassword(starterPassword),
      });

      if (baristaEmp) {
        store.users.push({
          id: 'usr-barista-1',
          username: 'affan.barista',
          email: baristaEmp.email,
          fullName: baristaEmp.name,
          role: 'Barista',
          employeeId: baristaEmp.id,
          active: true,
          createdAt: now,
          passwordHash: hashPassword(starterPassword),
        });
      }
    }

    saveStore(store);
    const token = signSessionToken(adminUser);
    res.json({ token, user: sanitizeUser(adminUser) });
  });

  app.post('/api/auth/login', (req, res) => {
    const { identifier, password } = req.body || {};
    if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier.trim() || !password) {
      res.status(400).json({ error: 'Username/Email dan password wajib diisi.' });
      return;
    }

    const store = loadStore();
    const needle = identifier.trim().toLowerCase();
    const envPasscode = (process.env.ADMIN_PASSCODE || '').trim();

    if (envPasscode && (needle === 'admin' || needle === 'insidetuju@gmail.com')) {
      const a = Buffer.from(password);
      const b = Buffer.from(envPasscode);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        let adminUser = store.users.find((u) => u.role === 'Admin');
        if (!adminUser) {
          adminUser = {
            id: 'usr-admin-env',
            username: 'admin',
            email: 'insidetuju@gmail.com',
            fullName: 'Pengelola Utama Kopi Tuju',
            role: 'Admin',
            active: true,
            createdAt: new Date().toISOString(),
            passwordHash: hashPassword(envPasscode),
          };
          store.users.push(adminUser);
          saveStore(store);
        }
        const token = signSessionToken(adminUser);
        res.json({ token, user: sanitizeUser(adminUser) });
        return;
      }
    }

    const user = store.users.find(
      (u) =>
        u.active &&
        (u.username.toLowerCase() === needle || u.email.toLowerCase() === needle)
    );

    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: 'Username/email atau password salah.' });
      return;
    }

    const token = signSessionToken(user);
    res.json({ token, user: sanitizeUser(user) });
  });

  app.post('/api/auth/google-login', async (req, res) => {
    const { googleAccessToken } = req.body || {};
    if (typeof googleAccessToken !== 'string' || !googleAccessToken.trim()) {
      res.status(400).json({ error: 'Token Google tidak tersedia.' });
      return;
    }

    try {
      const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${googleAccessToken}` },
      });
      if (!resp.ok) {
        res.status(401).json({ error: 'Verifikasi akun Google gagal.' });
        return;
      }
      const profile = (await resp.json()) as {
        email?: string;
        email_verified?: boolean;
        name?: string;
      };
      if (!profile.email || !profile.email_verified) {
        res.status(401).json({ error: 'Email Google belum terverifikasi.' });
        return;
      }

      const emailLower = profile.email.toLowerCase();
      const store = loadStore();
      let user = store.users.find((u) => u.email.toLowerCase() === emailLower && u.active);

      if (!user) {
        // Match registered employee email or primary owner email
        const matchedEmp = store.employees.find((e) => e.email.toLowerCase() === emailLower);
        const isFirstAdmin = store.users.filter((u) => u.role === 'Admin').length === 0;

        if (isFirstAdmin || emailLower === 'insidetuju@gmail.com') {
          user = {
            id: `usr-google-${crypto.randomBytes(4).toString('hex')}`,
            username: emailLower,
            email: emailLower,
            fullName: profile.name || 'Pengelola Kopi Tuju',
            role: 'Admin',
            active: true,
            createdAt: new Date().toISOString(),
            passwordHash: '',
          };
          store.users.push(user);
          saveStore(store);
        } else if (matchedEmp) {
          user = {
            id: `usr-google-${crypto.randomBytes(4).toString('hex')}`,
            username: emailLower,
            email: emailLower,
            fullName: matchedEmp.name,
            role: matchedEmp.role,
            employeeId: matchedEmp.id,
            active: true,
            createdAt: new Date().toISOString(),
            passwordHash: '',
          };
          store.users.push(user);
          saveStore(store);
        } else {
          res.status(403).json({
            error: `Email ${emailLower} belum terdaftar di Database Kru atau Akun Sistem Kopi Tuju.`,
          });
          return;
        }
      }

      const token = signSessionToken(user);
      res.json({ token, user: sanitizeUser(user) });
    } catch {
      res.status(500).json({ error: 'Gagal memverifikasi akun Google.' });
    }
  });

  app.post('/api/auth/logout', requireAuth, (req: AuthenticatedRequest, res) => {
    if (req.authTokenJti) {
      revokedTokens.add(req.authTokenJti);
    }
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const store = loadStore();
    res.json({
      user: sanitizeUser(req.authUser!),
      permissions: store.permissions,
    });
  });

  // Main State endpoint with strict server-side RBAC filtering
  app.get('/api/state', requireAuth, (req: AuthenticatedRequest, res) => {
    const store = loadStore();
    const user = req.authUser!;

    if (user.role !== 'Barista') {
      const access = getRoleFeatureAccess(user.role, store.permissions);
      const ownEmployee = store.employees.find(
        (e) =>
          (user.employeeId && e.id === user.employeeId) ||
          e.email.toLowerCase() === user.email.toLowerCase()
      );
      const canReadEmployees =
        access.canAccessCrew ||
        access.canAccessOnboarding ||
        access.canAccessPayroll ||
        access.canAccessAttendance ||
        access.canAccessKpi;
      const canSeeSalaryAndBank = access.canAccessCrew || access.canAccessPayroll;
      const filteredEmployees = !canReadEmployees
        ? access.canViewOwnPayslip && ownEmployee
          ? [ownEmployee]
          : []
        : canSeeSalaryAndBank
        ? store.employees
        : store.employees.map((e) =>
            ownEmployee && e.id === ownEmployee.id
              ? e
              : {
                  ...e,
                  baseSalary: 0,
                  dailyRate: 0,
                  trainingRatePerDay: 0,
                  bankAccount: '—',
                  bankName: '—',
                }
          );

      const personalPayrollPeriods: PayrollPeriod[] = access.canViewOwnPayslip
        ? store.payrollPeriods
            .map((p) => ({
              ...p,
              entries: p.entries.filter(
                (e) =>
                  (ownEmployee?.id && e.employeeId === ownEmployee.id) ||
                  e.email.toLowerCase() === user.email.toLowerCase()
              ),
              holdingIncentives: p.holdingIncentives.filter(
                (h) => Boolean(ownEmployee?.id && h.employeeId === ownEmployee.id)
              ),
            }))
            .filter((p) => p.entries.length > 0 || p.holdingIncentives.length > 0)
        : [];

      const liveRecords = store.liveAttendanceRecords || [];
      const isOwner = user.role === 'Admin' || user.role === 'HR Manager';
      const todayWita = getWitaDateAndTime(new Date()).date;
      const ownTodayRec = liveRecords.find(
        (r) =>
          r.date === todayWita &&
          (r.userId === user.id || (ownEmployee?.id ? r.employeeId === ownEmployee.id : false))
      );

      res.json({
        employees: filteredEmployees,
        batches: access.canAccessOnboarding ? store.batches : [],
        indicators: access.canAccessOnboarding ? store.indicators : [],
        payrollPeriods: access.canAccessPayroll ? store.payrollPeriods : [],
        personalPayrollPeriods,
        dispatchLogs: access.canAccessPayroll ? store.dispatchLogs : [],
        permissions: store.permissions,
        users: access.canAccessAccessControl ? store.users.map(sanitizeUser) : [sanitizeUser(user)],
        kpiJobDescriptions: access.canAccessKpi ? store.kpiJobDescriptions : [],
        kpiTemplates: access.canAccessKpi ? store.kpiTemplates : [],
        kpiEvaluations: access.canAccessKpi ? store.kpiEvaluations : [],
        attendanceBatches: access.canAccessAttendance ? store.attendanceBatches : [],
        outletLocations: store.outletLocations || DEFAULT_OUTLET_LOCATIONS,
        liveAttendanceRecords: isOwner ? liveRecords : [],
        myTodayClockState: isOwner
          ? null
          : ownTodayRec
          ? {
              date: ownTodayRec.date,
              branch: ownTodayRec.branch,
              hasClockedIn: Boolean(ownTodayRec.clockInTime),
              hasClockedOut: Boolean(ownTodayRec.clockOutTime),
            }
          : null,
      } satisfies HcAppState);
      return;
    }

    // Barista role: strictly filter data on server based on employeeId & FeaturePermissions
    const empId = user.employeeId;
    const ownEmployee = store.employees.find(
      (e) => e.id === empId || e.email.toLowerCase() === user.email.toLowerCase()
    );

    const employees = store.permissions.baristaCanViewCrewDirectory
      ? store.employees.map((e) =>
          e.id === ownEmployee?.id
            ? e
            : {
                ...e,
                baseSalary: 0,
                dailyRate: 0,
                trainingRatePerDay: 0,
                bankAccount: '—',
                bankName: '—',
              }
        )
      : ownEmployee
      ? [ownEmployee]
      : [];

    const batches = store.batches.map((b) => ({
      ...b,
      schedule: store.permissions.baristaCanViewTrainingSchedule ? b.schedule : [],
      trainees: store.permissions.baristaCanViewOwnTraining
        ? b.trainees.filter(
            (t) =>
              t.employeeId === ownEmployee?.id ||
              t.email.toLowerCase() === user.email.toLowerCase()
          )
        : [],
    }));

    const payrollPeriods: PayrollPeriod[] = store.permissions.baristaCanViewOwnPayslip
      ? store.payrollPeriods.map((p) => ({
          ...p,
          entries: p.entries.filter(
            (e) =>
              e.employeeId === ownEmployee?.id ||
              e.email.toLowerCase() === user.email.toLowerCase()
          ),
          holdingIncentives: store.permissions.baristaCanViewIncentiveSummary
            ? p.holdingIncentives.filter((h) => h.employeeId === ownEmployee?.id)
            : [],
        }))
      : [];

    const todayWita = getWitaDateAndTime(new Date()).date;
    const ownTodayRec = (store.liveAttendanceRecords || []).find(
      (r) =>
        r.date === todayWita &&
        (r.userId === user.id || (ownEmployee?.id ? r.employeeId === ownEmployee.id : false))
    );

    res.json({
      employees,
      batches,
      indicators: store.permissions.baristaCanViewOwnTraining ? store.indicators : [],
      payrollPeriods,
      dispatchLogs: [],
      permissions: store.permissions,
      users: [sanitizeUser(user)],
      kpiJobDescriptions: [],
      kpiTemplates: [],
      kpiEvaluations: [],
      attendanceBatches: [],
      outletLocations: store.outletLocations || DEFAULT_OUTLET_LOCATIONS,
      liveAttendanceRecords: [],
      myTodayClockState: ownTodayRec
        ? {
            date: ownTodayRec.date,
            branch: ownTodayRec.branch,
            hasClockedIn: Boolean(ownTodayRec.clockInTime),
            hasClockedOut: Boolean(ownTodayRec.clockOutTime),
          }
        : null,
    } satisfies HcAppState);
  });

  // Expose Google Maps API Key cleanly to authenticated sessions when configured in runtime env
  app.get('/api/maps-config', requireAuth, (_req, res) => {
    const apiKey = (
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      ''
    ).trim();
    res.json({ apiKey });
  });

  // Update Outlet Location Geofence (Strictly Manager HC / Admin Owner only)
  app.put('/api/outlet-locations', requireAuth, requireOwnerRole, (req: AuthenticatedRequest, res) => {
    const validBranches: BranchName[] = [
      'Abdesir',
      'Agus Salim',
      'Djemma',
      'Holding',
      'Perintis',
      'Tamalate',
    ];
    const body = req.body || {};
    const { branch, configured, lat, lng, radiusMeters, addressLabel } = body;

    if (typeof branch !== 'string' || !validBranches.includes(branch as BranchName)) {
      res.status(400).json({ error: 'Outlet/cabang tidak valid.' });
      return;
    }

    const isConfigured = Boolean(configured);
    const parsedRadius = Math.round(Number(radiusMeters));
    if (!Number.isFinite(parsedRadius) || parsedRadius < 20 || parsedRadius > 5000) {
      res.status(400).json({ error: 'Radius toleransi outlet harus antara 20 sampai 5.000 meter.' });
      return;
    }

    let nextLat: number | null = null;
    let nextLng: number | null = null;
    if (isConfigured) {
      const nLat = Number(lat);
      const nLng = Number(lng);
      if (
        !Number.isFinite(nLat) ||
        !Number.isFinite(nLng) ||
        nLat < -90 ||
        nLat > 90 ||
        nLng < -180 ||
        nLng > 180
      ) {
        res.status(400).json({ error: 'Koordinat latitude dan longitude tidak valid.' });
        return;
      }
      nextLat = Number(nLat.toFixed(6));
      nextLng = Number(nLng.toFixed(6));
    }

    const store = loadStore();
    const list: OutletLocationConfig[] = Array.isArray(store.outletLocations)
      ? [...store.outletLocations]
      : [...DEFAULT_OUTLET_LOCATIONS];

    const updatedItem: OutletLocationConfig = {
      branch: branch as BranchName,
      configured: isConfigured,
      lat: nextLat,
      lng: nextLng,
      radiusMeters: parsedRadius,
      addressLabel:
        typeof addressLabel === 'string' && addressLabel.trim()
          ? addressLabel.trim().slice(0, 180)
          : isConfigured
          ? `Outlet ${branch}`
          : 'Belum diatur Manager HC',
      updatedBy: req.authUser!.fullName,
      updatedAt: new Date().toISOString(),
    };

    const idx = list.findIndex((o) => o.branch === branch);
    if (idx >= 0) {
      list[idx] = updatedItem;
    } else {
      list.push(updatedItem);
    }

    store.outletLocations = list;
    saveStore(store);
    res.json({ ok: true, outletLocations: list, updated: updatedItem });
  });

  // Live Clock-In / Clock-Out with strict server-side Google Maps geofence verification (Staff only; Manager HC views history & sets locations)
  app.post('/api/live-attendance/clock', requireAuth, (req: AuthenticatedRequest, res) => {
    const actor = req.authUser!;
    if (actor.role === 'Admin' || actor.role === 'HR Manager') {
      res.status(403).json({
        error:
          'Fitur absen datang dan pulang hanya digunakan oleh staf. Manager HC berperan mengatur titik lokasi outlet dan melihat riwayat absensi.',
      });
      return;
    }

    const store = loadStore();
    const access = getRoleFeatureAccess(actor.role, store.permissions);
    if (actor.role === 'Barista' && store.permissions.baristaCanUseLiveAttendance === false) {
      res.status(403).json({
        error: 'Fitur absensi kehadiran untuk Kru (Barista) saat ini dinonaktifkan oleh Manager HC.',
      });
      return;
    }
    if (actor.role !== 'Barista' && access.canAccessLiveAttendance === false) {
      res.status(403).json({ error: 'Fitur absensi kehadiran dinonaktifkan untuk posisi Anda.' });
      return;
    }

    const { action, branch, lat, lng, shiftLabel, shiftStart, note } = req.body || {};
    if (action !== 'clock_in' && action !== 'clock_out') {
      res.status(400).json({ error: 'Jenis absensi tidak valid (clock_in / clock_out).' });
      return;
    }

    const validBranches: BranchName[] = [
      'Abdesir',
      'Agus Salim',
      'Djemma',
      'Holding',
      'Perintis',
      'Tamalate',
    ];
    if (typeof branch !== 'string' || !validBranches.includes(branch as BranchName)) {
      res.status(400).json({ error: 'Outlet absensi tidak valid.' });
      return;
    }

    const nLat = Number(lat);
    const nLng = Number(lng);
    if (
      !Number.isFinite(nLat) ||
      !Number.isFinite(nLng) ||
      nLat < -90 ||
      nLat > 90 ||
      nLng < -180 ||
      nLng > 180
    ) {
      res.status(400).json({
        error: 'Koordinat GPS Anda belum terdeteksi. Aktifkan lokasi perangkat terlebih dahulu.',
      });
      return;
    }

    const { date, timeHHmm } = getWitaDateAndTime(new Date());
    const records: LiveAttendanceRecord[] = Array.isArray(store.liveAttendanceRecords)
      ? [...store.liveAttendanceRecords]
      : [];

    const existingIdx = records.findIndex((r) => r.userId === actor.id && r.date === date);
    const existingRecord = existingIdx >= 0 ? records[existingIdx] : undefined;

    if (action === 'clock_in' && existingRecord?.clockInTime) {
      res.status(409).json({
        error: `Anda sudah melakukan Absen Datang hari ini pada pukul ${existingRecord.clockInTime} WITA di outlet ${existingRecord.branch}.`,
      });
      return;
    }

    if (action === 'clock_out') {
      if (!existingRecord || !existingRecord.clockInTime) {
        res.status(400).json({
          error: 'Anda belum melakukan Absen Datang hari ini. Lakukan Absen Datang terlebih dahulu.',
        });
        return;
      }
      if (existingRecord.clockOutTime) {
        res.status(409).json({
          error: `Anda sudah melakukan Absen Pulang hari ini pada pukul ${existingRecord.clockOutTime} WITA.`,
        });
        return;
      }
    }

    const targetBranch =
      action === 'clock_out' && existingRecord ? existingRecord.branch : (branch as BranchName);
    const outlet = (store.outletLocations || DEFAULT_OUTLET_LOCATIONS).find(
      (o) => o.branch === targetBranch
    );

    if (!outlet || !outlet.configured || outlet.lat === null || outlet.lng === null) {
      res.status(403).json({
        error: `Titik lokasi Maps untuk outlet ${targetBranch} belum diatur oleh Manager HC. Absen datang dan pulang belum dapat diakses.`,
      });
      return;
    }

    const distanceMeters = Math.round(
      calculateHaversineMeters(nLat, nLng, outlet.lat, outlet.lng)
    );

    if (distanceMeters > outlet.radiusMeters) {
      res.status(403).json({
        error: `Lokasi Anda berjarak ${distanceMeters} meter dari titik outlet ${targetBranch} (batas toleransi ${outlet.radiusMeters} meter). Anda tidak dapat mengakses absen datang dan pulang di luar lokasi outlet.`,
        distanceMeters,
        radiusMeters: outlet.radiusMeters,
      });
      return;
    }

    const ownEmployee = store.employees.find(
      (e) =>
        (actor.employeeId && e.id === actor.employeeId) ||
        e.email.toLowerCase() === actor.email.toLowerCase()
    );

    const cleanNote = typeof note === 'string' ? note.trim().slice(0, 180) : '';

    if (action === 'clock_in') {
      const safeShiftStart =
        typeof shiftStart === 'string' && /^\d{2}:\d{2}$/.test(shiftStart)
          ? shiftStart
          : targetBranch === 'Holding'
          ? '09:00'
          : '06:05';
      const safeShiftLabel =
        typeof shiftLabel === 'string' && shiftLabel.trim()
          ? shiftLabel.trim().slice(0, 60)
          : `Shift (${safeShiftStart})`;

      const penalty = computeLiveClockInPenalty(timeHHmm, safeShiftStart);

      const newRecord: LiveAttendanceRecord = {
        id: `live-att-${crypto.randomBytes(5).toString('hex')}`,
        userId: actor.id,
        employeeId: ownEmployee?.id || actor.employeeId,
        employeeName: ownEmployee?.name || actor.fullName,
        role: actor.role,
        branch: targetBranch,
        date,
        shiftLabel: safeShiftLabel,
        shiftStart: safeShiftStart,
        clockInTime: timeHHmm,
        clockInLat: Number(nLat.toFixed(6)),
        clockInLng: Number(nLng.toFixed(6)),
        clockInDistanceMeters: distanceMeters,
        status: penalty.status,
        lateMinutes: penalty.lateMinutes,
        penaltyAmount: penalty.penaltyAmount,
        note: cleanNote || undefined,
      };

      records.unshift(newRecord);
      store.liveAttendanceRecords = records;
      saveStore(store);
      res.json({ ok: true, record: newRecord, distanceMeters });
      return;
    }

    // action === 'clock_out'
    const updatedRecord: LiveAttendanceRecord = {
      ...existingRecord!,
      clockOutTime: timeHHmm,
      clockOutLat: Number(nLat.toFixed(6)),
      clockOutLng: Number(nLng.toFixed(6)),
      clockOutDistanceMeters: distanceMeters,
      workDuration: computeWorkDurationLabel(existingRecord!.clockInTime!, timeHHmm),
      note: cleanNote || existingRecord!.note,
    };

    records[existingIdx] = updatedRecord;
    store.liveAttendanceRecords = records;
    saveStore(store);
    res.json({ ok: true, record: updatedRecord, distanceMeters });
  });

  // Update Employees (Owner only: Admin / Manager HC)
  app.put('/api/employees', requireAuth, requireOwnerRole, (req, res) => {
    const { employees } = req.body || {};
    if (!Array.isArray(employees)) {
      res.status(400).json({ error: 'Format data karyawan tidak valid.' });
      return;
    }
    const store = loadStore();
    store.employees = employees;
    saveStore(store);
    res.json({ ok: true, count: employees.length });
  });

  // Barista self-contact update
  app.patch('/api/me/contact', requireAuth, (req: AuthenticatedRequest, res) => {
    const store = loadStore();
    const user = req.authUser!;
    if (user.role === 'Barista' && !store.permissions.baristaCanEditOwnContact) {
      res.status(403).json({ error: 'Pengelola belum mengaktifkan izin ubah kontak mandiri.' });
      return;
    }
    const { phone, email } = req.body || {};
    const emp = store.employees.find(
      (e) => e.id === user.employeeId || e.email.toLowerCase() === user.email.toLowerCase()
    );
    if (!emp) {
      res.status(404).json({ error: 'Profil karyawan tidak ditemukan.' });
      return;
    }
    if (typeof phone === 'string') emp.phone = phone.trim();
    if (typeof email === 'string' && email.includes('@')) {
      emp.email = email.trim().toLowerCase();
    }
    saveStore(store);
    res.json({ ok: true, employee: emp });
  });

  // Self-service password change for all login accounts except Manager HC (HR Manager)
  app.patch('/api/me/password', requireAuth, (req: AuthenticatedRequest, res) => {
    const actor = req.authUser!;
    if (actor.role === 'HR Manager') {
      res.status(403).json({
        error: 'Akun Manager HC tidak menggunakan fitur ubah password di menu ini.',
      });
      return;
    }

    const envPasscode = (process.env.ADMIN_PASSCODE || '').trim();
    if (actor.id === 'usr-admin-env' && envPasscode) {
      res.status(400).json({
        error: 'Password Admin utama dikelola melalui environment variable server.',
      });
      return;
    }

    const { currentPassword, newPassword } = req.body || {};
    if (typeof newPassword !== 'string' || newPassword.length < 6 || newPassword.length > 128) {
      res.status(400).json({ error: 'Password baru harus terdiri dari 6 sampai 128 karakter.' });
      return;
    }

    const store = loadStore();
    const targetUser = store.users.find((u) => u.id === actor.id && u.active);
    if (!targetUser) {
      res.status(404).json({ error: 'Akun pengguna tidak ditemukan.' });
      return;
    }

    if (targetUser.passwordHash) {
      if (typeof currentPassword !== 'string' || !currentPassword) {
        res.status(400).json({ error: 'Password saat ini wajib diisi.' });
        return;
      }
      if (!verifyPassword(currentPassword, targetUser.passwordHash)) {
        res.status(400).json({ error: 'Password saat ini tidak sesuai.' });
        return;
      }
    }

    targetUser.passwordHash = hashPassword(newPassword);
    saveStore(store);
    res.json({ ok: true, user: sanitizeUser(targetUser) });
  });

  // Update Onboarding Batches & Indicators
  app.put('/api/onboarding', requireAuth, requireModuleAccess('canAccessOnboarding'), (req, res) => {
    const { batches, indicators } = req.body || {};
    if (!Array.isArray(batches)) {
      res.status(400).json({ error: 'Format data batch training tidak valid.' });
      return;
    }
    const store = loadStore();
    store.batches = batches;
    if (Array.isArray(indicators)) {
      store.indicators = indicators;
    }
    saveStore(store);
    res.json({ ok: true });
  });

  // Update Payroll Periods (Owner only: Admin / Manager HC)
  app.put('/api/payroll', requireAuth, requireOwnerRole, (req, res) => {
    const { payrollPeriods } = req.body || {};
    if (!Array.isArray(payrollPeriods)) {
      res.status(400).json({ error: 'Format data payroll tidak valid.' });
      return;
    }
    const store = loadStore();
    store.payrollPeriods = payrollPeriods;
    saveStore(store);
    res.json({ ok: true });
  });

  // Update KPI Job Descriptions, Templates & Evaluations
  app.put('/api/kpi', requireAuth, requireModuleAccess('canAccessKpi'), (req, res) => {
    const { kpiJobDescriptions, kpiTemplates, kpiEvaluations } = req.body || {};
    if (!Array.isArray(kpiTemplates) || !Array.isArray(kpiEvaluations)) {
      res.status(400).json({ error: 'Format data evaluasi KPI tidak valid.' });
      return;
    }
    const store = loadStore();
    if (Array.isArray(kpiJobDescriptions)) {
      store.kpiJobDescriptions = kpiJobDescriptions;
    }
    store.kpiTemplates = kpiTemplates;
    store.kpiEvaluations = kpiEvaluations;
    saveStore(store);
    res.json({ ok: true });
  });

  // Update Attendance Upload Batches & Late Penalty Records
  app.put('/api/attendance', requireAuth, requireModuleAccess('canAccessAttendance'), (req, res) => {
    const { attendanceBatches } = req.body || {};
    if (
      !Array.isArray(attendanceBatches) ||
      attendanceBatches.some(
        (b) =>
          !b ||
          typeof b !== 'object' ||
          typeof b.id !== 'string' ||
          !Array.isArray(b.records)
      )
    ) {
      res.status(400).json({ error: 'Format data absensi & denda tidak valid.' });
      return;
    }
    const store = loadStore();
    store.attendanceBatches = attendanceBatches;
    saveStore(store);
    res.json({ ok: true });
  });

  // Update Feature Visibility Permissions (Admin / Manager HC Owner, plus Barista switches for authorized staff)
  app.put('/api/permissions', requireAuth, requireModuleAccess('canAccessAccessControl'), (req: AuthenticatedRequest, res) => {
    const actor = req.authUser!;
    const { permissions } = req.body || {};
    if (!permissions || typeof permissions !== 'object') {
      res.status(400).json({ error: 'Format pengaturan hak akses tidak valid.' });
      return;
    }
    const store = loadStore();
    const isOwner = actor.role === 'Admin' || actor.role === 'HR Manager';
    const currentRoleFeatures = normalizeAllRoleFeatures(
      store.permissions.roleFeatures,
      DEFAULT_ROLE_FEATURES
    );
    const nextRoleFeatures = isOwner
      ? normalizeAllRoleFeatures(permissions.roleFeatures, currentRoleFeatures)
      : currentRoleFeatures;
    const nextSupervisorFeatures = nextRoleFeatures.Supervisor;

    const next: FeaturePermissions = {
      baristaCanUseLiveAttendance:
        typeof permissions.baristaCanUseLiveAttendance === 'boolean'
          ? permissions.baristaCanUseLiveAttendance
          : true,
      baristaCanViewOwnPayslip: Boolean(permissions.baristaCanViewOwnPayslip),
      baristaCanDownloadPayslip: Boolean(permissions.baristaCanDownloadPayslip),
      baristaCanViewOwnTraining: Boolean(permissions.baristaCanViewOwnTraining),
      baristaCanViewTrainingSchedule: Boolean(permissions.baristaCanViewTrainingSchedule),
      baristaCanViewCrewDirectory: Boolean(permissions.baristaCanViewCrewDirectory),
      baristaCanViewIncentiveSummary: Boolean(permissions.baristaCanViewIncentiveSummary),
      baristaCanEditOwnContact: Boolean(permissions.baristaCanEditOwnContact),
      managerFeatures: OWNER_FULL_FEATURES,
      supervisorFeatures: nextSupervisorFeatures,
      roleFeatures: nextRoleFeatures,
    };
    store.permissions = next;
    saveStore(store);
    res.json({ ok: true, permissions: next });
  });

  // Bulk-create accounts for all unprovisioned Barista & Staff employees (Owner only)
  app.post('/api/users/bulk-provision', requireAuth, requireOwnerRole, (req, res) => {
    const { defaultPassword } = req.body || {};
    if (
      typeof defaultPassword !== 'string' ||
      defaultPassword.length < 6 ||
      defaultPassword.length > 128
    ) {
      res.status(400).json({ error: 'Password default minimal 6 karakter.' });
      return;
    }

    const store = loadStore();
    const created = provisionMissingStaffAndBaristaUsers(store, defaultPassword);
    store.staffAccountsBulkProvisioned = true;
    saveStore(store);
    res.json({
      ok: true,
      createdCount: created.length,
      createdUsers: created.map(sanitizeUser),
    });
  });

  // User account management
  app.post('/api/users', requireAuth, requireModuleAccess('canAccessAccessControl'), (req: AuthenticatedRequest, res) => {
    const actor = req.authUser!;
    const { username, email, fullName, role, password, employeeId } = req.body || {};
    if (
      typeof username !== 'string' ||
      !username.trim() ||
      typeof email !== 'string' ||
      !email.includes('@') ||
      typeof fullName !== 'string' ||
      !fullName.trim() ||
      typeof password !== 'string' ||
      password.length < 6
    ) {
      res.status(400).json({ error: 'Username, email, nama, dan password minimal 6 karakter wajib diisi.' });
      return;
    }

    const targetRole: UserRole = isValidUserRole(role) ? role : 'Barista';

    if (!canManageTargetRole(actor.role, targetRole)) {
      res.status(403).json({ error: `Peran ${actor.role} tidak diizinkan membuat akun dengan peran ${targetRole}.` });
      return;
    }

    const store = loadStore();
    const dup = store.users.find(
      (u) =>
        u.username.toLowerCase() === username.trim().toLowerCase() ||
        u.email.toLowerCase() === email.trim().toLowerCase()
    );
    if (dup) {
      res.status(409).json({ error: 'Username atau email sudah terdaftar.' });
      return;
    }

    const created: StoredUser = {
      id: `usr-${crypto.randomBytes(5).toString('hex')}`,
      username: username.trim().toLowerCase(),
      email: email.trim().toLowerCase(),
      fullName: fullName.trim(),
      role: targetRole,
      employeeId: typeof employeeId === 'string' && employeeId ? employeeId : undefined,
      active: true,
      createdAt: new Date().toISOString(),
      passwordHash: hashPassword(password),
    };

    store.users.push(created);
    saveStore(store);
    res.json({ ok: true, user: sanitizeUser(created) });
  });

  app.patch('/api/users/:id', requireAuth, requireModuleAccess('canAccessAccessControl'), (req: AuthenticatedRequest, res) => {
    const actor = req.authUser!;
    const { id } = req.params;
    const { active, role, password, employeeId } = req.body || {};
    const store = loadStore();
    const target = store.users.find((u) => u.id === id);
    if (!target) {
      res.status(404).json({ error: 'Akun tidak ditemukan.' });
      return;
    }

    if (!canManageTargetRole(actor.role, target.role) && target.id !== actor.id) {
      res.status(403).json({ error: `Peran ${actor.role} tidak memiliki izin mengubah akun ${target.role}.` });
      return;
    }

    if (typeof active === 'boolean' && target.id !== actor.id) {
      target.active = active;
    }
    if (isValidUserRole(role)) {
      if (canManageTargetRole(actor.role, role) && (target.id !== actor.id || role === actor.role)) {
        target.role = role;
      }
    }
    if (typeof password === 'string' && password.length >= 6) {
      target.passwordHash = hashPassword(password);
    }
    if (typeof employeeId === 'string') {
      target.employeeId = employeeId || undefined;
    }

    saveStore(store);
    res.json({ ok: true, user: sanitizeUser(target) });
  });

  app.delete('/api/users/:id', requireAuth, requireModuleAccess('canAccessAccessControl'), (req: AuthenticatedRequest, res) => {
    const actor = req.authUser!;
    const { id } = req.params;
    if (id === actor.id) {
      res.status(400).json({ error: 'Tidak dapat menghapus akun yang sedang login.' });
      return;
    }
    const store = loadStore();
    const target = store.users.find((u) => u.id === id);
    if (!target) {
      res.status(404).json({ error: 'Akun tidak ditemukan.' });
      return;
    }
    if (!canManageTargetRole(actor.role, target.role)) {
      res.status(403).json({ error: `Peran ${actor.role} tidak dapat menghapus akun ${target.role}.` });
      return;
    }
    store.users = store.users.filter((u) => u.id !== id);
    saveStore(store);
    res.json({ ok: true });
  });

  // Gmail API automated payslip sender (Owner only: Admin / Manager HC)
  app.post('/api/gmail/send', requireAuth, requireOwnerRole, async (req: AuthenticatedRequest, res) => {
    const gmailToken = req.headers['x-gmail-token'];
    if (typeof gmailToken !== 'string' || !gmailToken.trim()) {
      res.status(401).json({ error: 'Hubungkan akun Google (Gmail) terlebih dahulu sebelum mengirim slip gaji.' });
      return;
    }

    const { periodId, entryId, employeeId, employeeName, toEmail, subject, htmlBody, pdfBase64, fileName } =
      req.body || {};

    if (
      typeof toEmail !== 'string' ||
      !toEmail.includes('@') ||
      typeof subject !== 'string' ||
      typeof htmlBody !== 'string' ||
      typeof pdfBase64 !== 'string'
    ) {
      res.status(400).json({ error: 'Data pengiriman email slip gaji tidak lengkap.' });
      return;
    }

    const store = loadStore();
    const period = store.payrollPeriods.find((p) => p.id === periodId);
    const entry = period?.entries.find((e) => e.id === entryId);
    const now = new Date().toISOString();

    try {
      const raw = buildMimeWithPdfAttachment({
        to: toEmail,
        subject,
        htmlBody,
        pdfBase64,
        fileName: typeof fileName === 'string' && fileName ? fileName : 'Slip_Gaji_Kopi_Tuju.pdf',
      });

      const gmailResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${gmailToken.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      });

      if (!gmailResp.ok) {
        const errPayload = await gmailResp.json().catch(() => ({}));
        const errMsg =
          (errPayload as { error?: { message?: string } })?.error?.message ||
          `Gmail API error (${gmailResp.status})`;

        if (entry) {
          entry.slipStatus = 'Gagal';
          entry.slipError = errMsg;
        }
        store.dispatchLogs.unshift({
          id: `log-${crypto.randomBytes(5).toString('hex')}`,
          periodId: periodId || '',
          periodLabel: period?.label || '',
          employeeId: employeeId || '',
          employeeName: employeeName || '',
          email: toEmail,
          status: 'Gagal',
          message: errMsg,
          sentBy: req.authUser!.email,
          timestamp: now,
        });
        saveStore(store);
        res.status(gmailResp.status === 401 ? 401 : 502).json({ error: errMsg });
        return;
      }

      if (entry) {
        entry.slipStatus = 'Terkirim';
        entry.slipSentAt = now;
        entry.slipSentTo = toEmail;
        entry.slipError = undefined;
      }
      store.dispatchLogs.unshift({
        id: `log-${crypto.randomBytes(5).toString('hex')}`,
        periodId: periodId || '',
        periodLabel: period?.label || '',
        employeeId: employeeId || '',
        employeeName: employeeName || '',
        email: toEmail,
        status: 'Terkirim',
        message: 'Slip gaji PDF berhasil dikirim via Gmail.',
        sentBy: req.authUser!.email,
        timestamp: now,
      });
      saveStore(store);
      res.json({ ok: true, sentAt: now });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menghubungi server Gmail.';
      res.status(500).json({ error: msg });
    }
  });

  // Vite integration
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Toko Kopi Tuju HC Portal running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
