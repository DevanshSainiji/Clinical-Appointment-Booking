export type LanguageCode = 'en' | 'hi' | 'ta';
export type AppointmentIntent = 'book' | 'reschedule' | 'cancel' | 'campaign' | 'unknown';
export type AppointmentStatus = 'scheduled' | 'cancelled' | 'completed';
export type CampaignType = 'reminder' | 'follow_up';

export type PatientProfile = {
  patientId: string;
  name: string;
  preferredLanguage: LanguageCode;
  preferredDoctorId?: string;
  phone?: string;
  notes?: string;
};

export type AppointmentSlot = {
  slotId: string;
  doctorId: string;
  doctorName: string;
  startsAtIso: string;
  durationMinutes: number;
  location: string;
  status: 'available' | 'reserved';
  reservedBy?: string;
};

export type AppointmentRecord = {
  appointmentId: string;
  patientId: string;
  doctorId: string;
  doctorName: string;
  slotId: string;
  startsAtIso: string;
  durationMinutes: number;
  status: AppointmentStatus;
  reason?: string;
  language: LanguageCode;
  createdAtIso: string;
  updatedAtIso: string;
};

export type SessionMemory = {
  sessionId: string;
  patientId: string;
  intent: AppointmentIntent;
  language: LanguageCode;
  pendingConfirmation?: string;
  pendingDoctorId?: string;
  pendingDoctorName?: string;
  pendingDateIso?: string;
  pendingDateLabel?: string;
  pendingSlotId?: string;
  lastUserText?: string;
  lastNormalizedText?: string;
  lastAgentText?: string;
  slotDoctorProvided?: boolean;
  slotDateProvided?: boolean;
  updatedAtIso: string;
};

export type InteractionSummary = {
  patientId: string;
  sessionId: string;
  summary: string;
  language: LanguageCode;
  createdAtIso: string;
};

export type CampaignRecord = {
  campaignId: string;
  type: CampaignType;
  patientId: string;
  room: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAtIso: string;
  updatedAtIso: string;
  metadata?: string;
};

export type ClinicStore = {
  patients: PatientProfile[];
  appointments: AppointmentRecord[];
  sessions: SessionMemory[];
  interactions: InteractionSummary[];
  campaigns: CampaignRecord[];
  slots: AppointmentSlot[];
};

export type ScheduleQuery = {
  patientId: string;
  language: LanguageCode;
  doctorId?: string;
  dateIso?: string;
  intent?: AppointmentIntent;
};

export type ScheduleOption = {
  slotId: string;
  doctorId: string;
  doctorName: string;
  startsAtIso: string;
  durationMinutes: number;
  location: string;
  confidence: number;
  reason: string;
};

export type ToolResult =
  | { ok: true; message: string; data?: unknown }
  | { ok: false; message: string; data?: unknown };
