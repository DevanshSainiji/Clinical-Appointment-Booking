import mongoose from 'mongoose';

export async function connectDB(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  if (mongoose.connection.readyState === 1) {
    return;
  }

  await mongoose.connect(databaseUrl);
  console.info('MongoDB connected');
}