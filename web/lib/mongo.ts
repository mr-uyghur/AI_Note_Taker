import { MongoClient } from 'mongodb';
import { env } from './env';

declare global {
  var _mongoClient: MongoClient | undefined;
}

function createClient() {
  const client = new MongoClient(env.MONGODB_URI);
  return client;
}

export async function getMongoClient(): Promise<MongoClient> {
  if (process.env.NODE_ENV === 'development') {
    if (!global._mongoClient) {
      global._mongoClient = createClient();
      await global._mongoClient.connect();
      // Fail fast if MongoDB is not running
      await global._mongoClient.db('admin').command({ ping: 1 });
    }
    return global._mongoClient;
  }
  const client = createClient();
  await client.connect();
  return client;
}

export async function getDb() {
  const client = await getMongoClient();
  return client.db(env.MONGODB_DB);
}
