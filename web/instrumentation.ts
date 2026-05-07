export function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Windows system DNS refuses SRV queries needed for mongodb+srv:// URIs.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dns = require('dns') as typeof import('dns');
    dns.setServers(['8.8.8.8', '8.8.4.4']);
  }
}
