import { Db, MongoClient, ObjectId } from 'mongodb';

const uri = process.env.DATABASE_URL;

if (!uri) {
  throw new Error('Please define the DATABASE_URL environment variable');
}

const globalForMongo = globalThis as unknown as {
  mongoClientPromise?: Promise<MongoClient>;
};

const client = new MongoClient(uri);

const clientPromise =
  globalForMongo.mongoClientPromise ?? client.connect();

if (process.env.NODE_ENV !== 'production') {
  globalForMongo.mongoClientPromise = clientPromise;
}

export async function getDb(): Promise<Db> {
  const connectedClient = await clientPromise;
  const dbName = process.env.DATABASE_NAME;
  return dbName ? connectedClient.db(dbName) : connectedClient.db();
}

export function toObjectId(id: string): ObjectId | null {
  if (!ObjectId.isValid(id)) {
    return null;
  }
  return new ObjectId(id);
}
