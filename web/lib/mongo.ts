import { MongoClient } from 'mongodb';
import { env } from './env';

declare global {
  var _mongoClient: MongoClient | undefined;
}

// Module-level singleton for production (safe — no hot-reload in prod)
let _prodClient: MongoClient | undefined;

function createClient() {
  return new MongoClient(env.MONGODB_URI);
}

async function connect(client: MongoClient): Promise<MongoClient> {
  await client.connect();
  // Fail fast if MongoDB is unreachable
  await client.db('admin').command({ ping: 1 });
  return client;
}

export async function getMongoClient(): Promise<MongoClient> {
  if (process.env.NODE_ENV === 'development') {
    // global avoids multiple connections across hot-module reloads
    if (!global._mongoClient) {
      global._mongoClient = await connect(createClient());
    }
    return global._mongoClient;
  }
  if (!_prodClient) {
    _prodClient = await connect(createClient());
  }
  return _prodClient;
}

export async function getDb() {
  const client = await getMongoClient();
  return client.db(env.MONGODB_DB);
}
