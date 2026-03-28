import { mutateStore, loadStore } from '../storage/clinicStore.js';
import type { AppointmentIntent, AppointmentRecord, AppointmentSlot, LanguageCode, ToolResult } from '../domain/clinic.js';
import { getPatientProfile } from '../memory/longTermMemory.js';
import { logger } from '../telemetry/logger.js';

export type AppointmentAction = 'book' | 'reschedule' | 'cancel';

export async function manageAppointmentTool(input: {
  action: AppointmentAction;
  patientId: string;
  slotId?: string;
  language?: LanguageCode;
  note?: string;
}): Promise<ToolResult> {
  logger.info('tool', 'manage_appointment_start', {
    action: input.action,
    patientId: input.patientId,
    slotId: input.slotId || null,
    language: input.language || null,
  });
  const profile = await getPatientProfile(input.patientId);
  const store = await loadStore();
  const nowIso = new Date().toISOString();

  if (input.action === 'cancel') {
    const active = store.appointments.find((appt) => appt.patientId === input.patientId && appt.status === 'scheduled');
    if (!active) {
      return { ok: false, message: 'No active appointment found to cancel.' };
    }
    await mutateStore((draft) => {
      const found = draft.appointments.find((appt) => appt.appointmentId === active.appointmentId);
      if (found) {
        found.status = 'cancelled';
        found.updatedAtIso = nowIso;
      }
      const slot = draft.slots.find((s) => s.slotId === active.slotId);
      if (slot) slot.status = 'available';
    });
    logger.info('tool', 'manage_appointment_cancelled', {
      patientId: input.patientId,
      appointmentId: active.appointmentId,
      slotId: active.slotId,
    });
    return {
      ok: true,
      message: `Cancelled appointment with ${active.doctorName} on ${active.startsAtIso}.`,
      data: { appointment: active },
    };
  }

  const slot = input.slotId ? store.slots.find((s) => s.slotId === input.slotId) : undefined;
  if (!slot) {
    logger.warn('tool', 'manage_appointment_invalid_slot', { patientId: input.patientId, slotId: input.slotId || null });
    return { ok: false, message: 'A valid slotId is required for booking or rescheduling.' };
  }
  if (new Date(slot.startsAtIso) <= new Date()) {
    logger.warn('tool', 'manage_appointment_past_slot', { patientId: input.patientId, slotId: slot.slotId, startsAtIso: slot.startsAtIso });
    return { ok: false, message: 'Cannot book a slot in the past.' };
  }
  if (slot.status !== 'available') {
    logger.warn('tool', 'manage_appointment_reserved_slot', { patientId: input.patientId, slotId: slot.slotId, startsAtIso: slot.startsAtIso });
    return { ok: false, message: 'That slot is already reserved.' };
  }

  const existingActive = store.appointments.find((appt) => appt.patientId === input.patientId && appt.status === 'scheduled');
  if (input.action === 'book' && existingActive) {
    logger.warn('tool', 'manage_appointment_conflict', {
      patientId: input.patientId,
      existingAppointmentId: existingActive.appointmentId,
      requestedAction: input.action,
    });
    return { ok: false, message: 'Patient already has an active appointment. Use reschedule or cancel first.' };
  }

  if (input.action === 'reschedule' && existingActive) {
    await mutateStore((draft) => {
      const oldAppt = draft.appointments.find((appt) => appt.appointmentId === existingActive.appointmentId);
      if (oldAppt) {
        oldAppt.status = 'cancelled';
        oldAppt.updatedAtIso = nowIso;
      }
      const oldSlot = draft.slots.find((s) => s.slotId === existingActive.slotId);
      if (oldSlot) oldSlot.status = 'available';
    });
  }

  const appointment: AppointmentRecord = {
    appointmentId: `apt-${Date.now()}`,
    patientId: input.patientId,
    doctorId: slot.doctorId,
    doctorName: slot.doctorName,
    slotId: slot.slotId,
    startsAtIso: slot.startsAtIso,
    durationMinutes: slot.durationMinutes,
    status: 'scheduled',
    language: input.language || profile.preferredLanguage,
    reason: input.note,
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
  };

  await mutateStore((draft) => {
    const nextSlot = draft.slots.find((s) => s.slotId === slot.slotId);
    if (nextSlot) nextSlot.status = 'reserved';
    draft.appointments.push(appointment);
  });

  logger.info('tool', 'manage_appointment_success', {
    action: input.action,
    patientId: input.patientId,
    appointmentId: appointment.appointmentId,
    doctorId: appointment.doctorId,
    slotId: appointment.slotId,
    startsAtIso: appointment.startsAtIso,
  });

  return {
    ok: true,
    message: `${input.action === 'reschedule' ? 'Rescheduled' : 'Booked'} appointment with ${slot.doctorName} on ${slot.startsAtIso}.`,
    data: { appointment },
  };
}
