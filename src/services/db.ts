import mongoose from 'mongoose';

export async function connectDB(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn('DATABASE_URL is not set. Continuing without MongoDB connection.');
    return;
  }

  if (mongoose.connection.readyState === 1) {
    return;
  }

  try {
    await mongoose.connect(databaseUrl);
    console.info('MongoDB connected');
  } catch (error) {
    console.warn('MongoDB connection failed. Continuing in degraded mode.');
    console.warn(error);
  }
}