// Changes waiting to reach Google ("outbox"). The screen already shows each change (see commit() in app.js);
// this sends them one at a time, in the order you made them. The list is kept on the phone, so closing the app
// or losing signal loses nothing: whatever is left is sent the next time the app is open and online.
//
// Every request carries an opId; if a request is sent twice (the answer got lost on the way back),
// the server recognises it and doesn't save it twice.

/**
 * @param {object} o
 * @param {Function} o.send     async (body) => result; throw an Error with `retry: true` for "no connection, try later"
 * @param {Function} o.load     () => saved list or null
 * @param {Function} o.save     (list) => void
 * @param {Function} o.onStatus () => void, whenever the number of waiting changes or sending starts/stops
 * @param {Function} o.onIdle   (sentCount) => void, when everything has been sent
 * @param {Function} o.onError  (item, error) => void, for a change the server refused that has no onFail of its own
 */
export function createOutbox({ send, load, save, onStatus = () => {}, onIdle = () => {}, onError = () => {} }) {
  let items = Array.isArray(load()) ? load() : [];
  const hooks = new Map(); // id → {onDone, onFail}; not saved, so after a restart only the generic handling applies
  let running = false;
  let offline = false;

  const persist = () => save(items);

  function push(body, { label = '', key = '', onDone, onFail } = {}) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (key) {
      // A newer change of the same kind replaces one that hasn't gone out yet (e.g. moving wallets several times)
      const at = items.findIndex((it, i) => it.key === key && !(running && i === 0));
      if (at !== -1) {
        hooks.delete(items[at].id);
        items.splice(at, 1);
      }
    }
    items.push({ id, body: { ...body, opId: id }, label, key });
    hooks.set(id, { onDone, onFail });
    persist();
    onStatus();
    run();
    return id;
  }

  async function run() {
    if (running || !items.length) return;
    running = true;
    offline = false;
    onStatus();
    let sent = 0;
    while (items.length) {
      const item = items[0];
      let result;
      try {
        result = await send(item.body);
      } catch (error) {
        if (error.retry) { offline = true; break; } // keep it; try again later
        items.shift();
        persist();
        const hook = hooks.get(item.id);
        hooks.delete(item.id);
        try {
          if (hook?.onFail) hook.onFail(error, items.length);
          else onError(item, error);
        } catch (e) { console.error(e); }
        continue;
      }
      items.shift();
      persist();
      sent++;
      const hook = hooks.get(item.id);
      hooks.delete(item.id);
      try { hook?.onDone?.(result); } catch (e) { console.error(e); }
    }
    running = false;
    onStatus();
    if (!items.length) onIdle(sent);
  }

  return {
    push,
    run,
    pending: () => items.length,
    sending: () => running,
    offline: () => offline,
  };
}
