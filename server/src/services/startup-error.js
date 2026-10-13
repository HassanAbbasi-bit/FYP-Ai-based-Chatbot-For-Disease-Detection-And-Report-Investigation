// Only authored messages leave startup: never print driver messages or URIs.
function startupError(error, stage, port) {
  if (stage === 'http') return error.code === 'EADDRINUSE'
    ? `Port ${port} is already in use. Stop the other backend before starting this one.`
    : 'HTTP server could not start. Check the configured port.';
  if (error.code === 'STORAGE_UNAVAILABLE') return 'Private report storage is unavailable or already used by another server. Check REPORT_STORAGE_DIR permissions and stop duplicate servers.';
  if (error.code === 'REPLICA_SET_REQUIRED') return 'The database must support replica-set transactions. Use your Atlas cluster or a configured replica set.';
  const members = error.reason?.servers instanceof Map ? [...error.reason.servers.values()].map(s => s.error).filter(Boolean) : [];
  const errors = [error, error.cause, ...members, ...members.map(e => e.cause)].filter(Boolean);
  if (errors.some(e => e.code === 18)) return 'Database authentication failed. Check the database username, password, and authentication database privately in server/.env.';
  if (errors.some(e => ['querySrv', 'queryTxt', 'getaddrinfo'].includes(e.syscall) || ['ENOTFOUND', 'EAI_AGAIN'].includes(e.code))) return 'Database DNS lookup failed. Check your network DNS or use the full Atlas non-SRV connection string.';
  if (errors.some(e => String(e.code || '').startsWith('ERR_SSL_') || String(e.code || '').startsWith('ERR_TLS_'))) return 'Atlas rejected the TLS connection. Check cluster availability and that your current IP is Active in Atlas Network Access. Database credentials were not verified.';
  if (error.name === 'MongooseServerSelectionError' || errors.some(e => ['ETIMEDOUT', 'ETIMEOUT'].includes(e.code))) return 'Database connection timed out. Check internet access, Atlas cluster availability and your current IP entry in Network Access, then restart the backend.';
  return 'Database initialization failed. Check server/.env, Atlas IP access, and database permissions; credentials are never printed.';
}
module.exports = { startupError };
