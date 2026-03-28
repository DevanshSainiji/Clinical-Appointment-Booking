import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AppointmentRecord,
  AppointmentSlot,
  CampaignRecord,
  ClinicStore,
  InteractionSummary,
  PatientProfile,
  SessionMemory,
} from '../domain/clinic.js';
import { logger } from '../telemetry/logger.js';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(rootDir, '../../data');
const storePath = path.join(dataDir, 'clinic-store.json');

const defaultStore: ClinicStore = {
  patients: [
    {
      patientId: 'patient-001',
      name: 'Ananya Rao',
      preferredLanguage: 'en',
      preferredDoctorId: 'dr-menon',
      phone: '+91 90000 00001',
      notes: 'Prefers morning appointments and brief confirmations.',
    },
    {
      patientId: 'patient-002',
      name: 'Rahul Verma',
      preferredLanguage: 'hi',
      preferredDoctorId: 'dr-sharma',
      phone: '+91 90000 00002',
      notes: 'Uses Hindi mostly; reschedules often for work travel.',
    },
    {
      patientId: 'patient-003',
      name: 'Meena Subramaniam',
      preferredLanguage: 'ta',
      preferredDoctorId: 'dr-iyer',
      phone: '+91 90000 00003',
      notes: 'Prefers Tamil and late afternoon slots.',
    },
  ],
  appointments: [],
  sessions: [],
  interactions: [],
  campaigns: [],
  slots: seedSlots(),
};

let cached: ClinicStore | null = null;

export async function loadStore(): Promise<ClinicStore> {
  if (cached) return cached;
  await mkdir(dataDir, { recursive: true });

  try {
    const raw = await readFile(storePath, 'utf8');
    cached = mergeStore(JSON.parse(raw) as Partial<ClinicStore>);
    logger.info('store', 'loaded', { path: storePath, source: 'disk' });
  } catch {
    cached = defaultStore;
    await saveStore(cached);
    logger.warn('store', 'initialized_default_store', { path: storePath });
  }

  return cached;
}

export async function saveStore(store: ClinicStore): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  cached = store;
  await writeFile(storePath, JSON.stringify(store, null, 2), 'utf8');
  logger.debug('store', 'saved', {
    path: storePath,
    patients: store.patients.length,
    sessions: store.sessions.length,
    appointments: store.appointments.length,
    campaigns: store.campaigns.length,
  });
}

export async function mutateStore(mutator: (store: ClinicStore) => void | Promise<void>): Promise<ClinicStore> {
  const store = await loadStore();
  logger.debug('store', 'mutate_begin', {
    appointments: store.appointments.length,
    sessions: store.sessions.length,
    interactions: store.interactions.length,
    campaigns: store.campaigns.length,
  });
  await mutator(store);
  await saveStore(store);
  logger.debug('store', 'mutate_end', {
    appointments: store.appointments.length,
    sessions: store.sessions.length,
    interactions: store.interactions.length,
    campaigns: store.campaigns.length,
  });
  return store;
}

export function cloneStore(store: ClinicStore): ClinicStore {
  return JSON.parse(JSON.stringify(store)) as ClinicStore;
}

function mergeStore(data: Partial<ClinicStore>): ClinicStore {
  return {
    patients: data.patients?.length ? data.patients as PatientProfile[] : defaultStore.patients,
    appointments: data.appointments?.length ? data.appointments as AppointmentRecord[] : defaultStore.appointments,
    sessions: data.sessions?.length ? data.sessions as SessionMemory[] : defaultStore.sessions,
    interactions: data.interactions?.length ? data.interactions as InteractionSummary[] : defaultStore.interactions,
    campaigns: data.campaigns?.length ? data.campaigns as CampaignRecord[] : defaultStore.campaigns,
    slots: data.slots?.length ? data.slots as AppointmentSlot[] : defaultStore.slots,
  };
}

function seedSlots(): AppointmentSlot[] {
  const now = new Date();
  const baseDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0);
  const doctors = [
    ['dr-menon', 'Dr. Menon'],
    ['dr-sharma', 'Dr. Sharma'],
    ['dr-iyer', 'Dr. Iyer'],
  ] as const;

  const slots: AppointmentSlot[] = [];
  let counter = 1;
  for (let dayOffset = 0; dayOffset < 6; dayOffset++) {
    for (const [doctorId, doctorName] of doctors) {
      for (const hour of [9, 11, 14, 16]) {
        const dt = new Date(baseDay);
        dt.setDate(baseDay.getDate() + dayOffset);
        dt.setHours(hour, 0, 0, 0);
        slots.push({
          slotId: `slot-${counter++}`,
          doctorId,
          doctorName,
          startsAtIso: dt.toISOString(),
          durationMinutes: 20,
          location: 'OPD-2',
          status: 'available',
        });
      }
    }
  }
  return slots;
}
