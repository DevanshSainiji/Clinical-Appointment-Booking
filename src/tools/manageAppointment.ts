import { AppointmentModel } from '../models/appointment.model.js';
import { resolveSlot } from './getScheduleOptions.js';

export type AppointmentAction = 'book' | 'reschedule' | 'cancel';

export type ManageAppointmentInput = {
  action: AppointmentAction;
  patientId: string;
  slotId?: string;
};

export type ManageAppointmentResult = {
  ok: boolean;
  message: string;
};

export async function manageAppointment(input: ManageAppointmentInput): Promise<ManageAppointmentResult> {
  if ((input.action === 'book' || input.action === 'reschedule') && !input.slotId) {
    return { ok: false, message: `Cannot ${input.action} without a target slot.` };
  }

  const slot = input.slotId ? resolveSlot(input.slotId) : null;

  if (input.action === 'cancel') {
    const appointment = await AppointmentModel.findOneAndUpdate(
      { patientId: input.patientId, status: { $in: ['booked', 'rescheduled'] } },
      { status: 'cancelled' },
      { new: true }
    );

    if (!appointment) {
      return { ok: false, message: `No active appointment found for patient ${input.patientId}.` };
    }

    return { ok: true, message: `Appointment cancelled for patient ${input.patientId}.` };
  }

  if (!slot) {
    return { ok: false, message: `Invalid slot ${input.slotId}.` };
  }

  if (input.action === 'book') {
    const conflict = await AppointmentModel.findOne({
      patientId: input.patientId,
      dateTime: new Date(slot.startIso),
      status: { $in: ['booked', 'rescheduled'] },
    }).lean();

    if (conflict) {
      return { ok: false, message: 'Conflict: patient already has an appointment at this time.' };
    }

    await AppointmentModel.create({
      patientId: input.patientId,
      doctor: slot.doctorId,
      dateTime: new Date(slot.startIso),
      status: 'booked',
    });

    return { ok: true, message: `Appointment booked successfully for slot ${input.slotId}.` };
  }

  const appointment = await AppointmentModel.findOneAndUpdate(
    { patientId: input.patientId, status: { $in: ['booked', 'rescheduled'] } },
    { status: 'rescheduled', doctor: slot.doctorId, dateTime: new Date(slot.startIso) },
    { new: true }
  );

  if (!appointment) {
    return { ok: false, message: `No active appointment found to reschedule for ${input.patientId}.` };
  }

  return { ok: true, message: `Appointment rescheduled successfully for slot ${input.slotId}.` };
}
