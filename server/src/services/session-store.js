const wrapped = new WeakSet();

function normalizeSessionTouch(store) {
  if (wrapped.has(store) || typeof store.touch !== 'function') return store;
  const touch = store.touch.bind(store);
  store.touch = (id, session, callback = () => {}) => touch(id, session, error => {
    // connect-mongo's refresh is update-only. Re-login, logout or expiry may
    // remove the old session while a report request is finishing. There is
    // nothing left to refresh; never save/upsert it or revive authentication.
    const removed = error?.name === 'Error' && error.code === undefined &&
      error.message === 'Unable to find the session to touch';
    callback(removed ? null : error);
  });
  wrapped.add(store);
  return store;
}
module.exports = { normalizeSessionTouch };
