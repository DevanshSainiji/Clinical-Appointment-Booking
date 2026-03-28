import type { LanguageCode } from '../domain/clinic.js';

export type DoctorRef = {
  doctorId: string;
  doctorName: string;
};

export type AppointmentRequest = {
  language: LanguageCode;
  text: string;
  hasBookingCue: boolean;
  hasCancellationCue: boolean;
  hasRescheduleCue: boolean;
  doctorId?: string;
  doctorName?: string;
  dateIso?: string;
  dateLabel?: string;
};

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

export function parseAppointmentRequest(text: string, language: LanguageCode, knownDoctors: DoctorRef[] = []): AppointmentRequest {
  const cleaned = normalizeText(text);
  const hasBookingCue = /\b(book|schedule|appointment|visit|consultation|see\s+doctor|see\s+the\s+doctor)\b/i.test(cleaned);
  const hasCancellationCue = /\b(cancel|drop|stop|remove|withdraw|रद्द|ரத்து)\b/i.test(cleaned);
  const hasRescheduleCue = /\b(reschedule|move|change|shift|postpone|बदल|மாற்ற)\b/i.test(cleaned);

  const doctor = findDoctor(cleaned, knownDoctors);
  const date = parseDate(cleaned);

  return {
    language,
    text: text.trim(),
    hasBookingCue,
    hasCancellationCue,
    hasRescheduleCue,
    doctorId: doctor?.doctorId,
    doctorName: doctor?.doctorName,
    dateIso: date?.dateIso,
    dateLabel: date?.dateLabel,
  };
}

function findDoctor(text: string, knownDoctors: DoctorRef[]): DoctorRef | undefined {
  const explicit = /\bdr\.?\s*([A-Za-z][A-Za-z.\-']+)(?:\s+([A-Za-z][A-Za-z.\-']+))?/i.exec(text);
  if (explicit) {
    const name = [explicit[1], explicit[2]].filter(Boolean).join(' ').trim();
    const matched = knownDoctors.find((doctor) => normalizeText(doctor.doctorName).includes(normalizeText(name)));
    return matched || { doctorId: slugDoctor(name), doctorName: toTitleCase(name) };
  }

  const known = knownDoctors.find((doctor) => normalizeText(text).includes(normalizeText(doctor.doctorName)));
  return known;
}

function parseDate(text: string): { dateIso: string; dateLabel: string } | undefined {
  const now = new Date();
  const relative = parseRelativeDate(text, now);
  if (relative) return relative;

  const dayMonth = /(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?/i.exec(text);
  const monthDay = /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?/i.exec(text);
  const numeric = /(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/.exec(text);

  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const month = MONTHS[dayMonth[2].toLowerCase()];
    const year = dayMonth[3] ? Number(dayMonth[3]) : now.getFullYear();
    return toFutureDate(day, month, year, text);
  }

  if (monthDay) {
    const month = MONTHS[monthDay[1].toLowerCase()];
    const day = Number(monthDay[2]);
    const year = monthDay[3] ? Number(monthDay[3]) : now.getFullYear();
    return toFutureDate(day, month, year, text);
  }

  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const third = numeric[3] ? Number(numeric[3]) : now.getFullYear();
    const date = buildDate(first, second - 1, third);
    if (date) {
      return { dateIso: date.toISOString(), dateLabel: text.trim() };
    }
  }

  return undefined;
}

function parseRelativeDate(text: string, now: Date): { dateIso: string; dateLabel: string } | undefined {
  const lower = text.toLowerCase();
  if (/\btoday\b/.test(lower)) return { dateIso: startOfDay(now).toISOString(), dateLabel: 'today' };
  if (/\btomorrow\b/.test(lower)) return { dateIso: addDays(startOfDay(now), 1).toISOString(), dateLabel: 'tomorrow' };
  if (/\bnext week\b/.test(lower)) return { dateIso: addDays(startOfDay(now), 7).toISOString(), dateLabel: 'next week' };
  return undefined;
}

function toFutureDate(day: number, month: number, year: number, label: string): { dateIso: string; dateLabel: string } | undefined {
  const now = new Date();
  const current = buildDate(day, month, year);
  if (!current) return undefined;

  let candidate = current;
  if (candidate < startOfDay(now)) {
    candidate = buildDate(day, month, year + 1) || candidate;
  }
  return { dateIso: candidate.toISOString(), dateLabel: label.trim() };
}

function buildDate(day: number, monthIndex: number, year: number): Date | undefined {
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31 || year < 1900) return undefined;
  const date = new Date(year, monthIndex, day, 9, 0, 0, 0);
  if (Number.isNaN(date.getTime())) return undefined;
  if (date.getMonth() !== monthIndex || date.getDate() !== day) return undefined;
  return date;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function slugDoctor(name: string): string {
  return `dr-${normalizeText(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}
