import mongoose, { Schema } from 'mongoose';

export type PatientDocument = {
  patientId: string;
  name?: string;
  preferredLanguage?: 'en' | 'hi' | 'ta';
  lastVisit?: Date;
};

const patientSchema = new Schema<PatientDocument>(
  {
    patientId: { type: String, required: true, unique: true, index: true },
    name: { type: String },
    preferredLanguage: { type: String, enum: ['en', 'hi', 'ta'], default: 'en' },
    lastVisit: { type: Date },
  },
  { timestamps: true }
);

export const PatientModel =
  mongoose.models.Patient || mongoose.model<PatientDocument>('Patient', patientSchema);
