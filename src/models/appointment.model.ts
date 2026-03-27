import mongoose, { Schema, Types } from 'mongoose';

export type AppointmentStatus = 'booked' | 'cancelled' | 'rescheduled';

export type AppointmentDocument = {
  appointmentId: string;
  patientId: string;
  doctor?: string;
  dateTime?: Date;
  status: AppointmentStatus;
};

const appointmentSchema = new Schema<AppointmentDocument>(
  {
    appointmentId: {
      type: String,
      required: true,
      unique: true,
      default: () => new Types.ObjectId().toString(),
    },
    patientId: { type: String, required: true, index: true },
    doctor: { type: String },
    dateTime: { type: Date },
    status: { type: String, enum: ['booked', 'cancelled', 'rescheduled'], required: true },
  },
  { timestamps: true }
);

export const AppointmentModel =
  mongoose.models.Appointment || mongoose.model<AppointmentDocument>('Appointment', appointmentSchema);
