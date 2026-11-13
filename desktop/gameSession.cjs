// Only the launcher's own successful dispatch starts this monitor. PIDs that
// existed before CL2 was requested must not count as a newly launched session.
function createGameSession({ readSessions, hide, restore, status, now = Date.now, schedule = setTimeout, cancel = clearTimeout, pollMs = 2000, startupMs = 90000, exitGraceMs = 12000, detectionGraceMs = 15000 }) {
  let active = null, timer, disposed = false, dispatching = false;
  const finish = reason => {
    active = null; cancel(timer); status(reason); restore();
  };
  async function poll() {
    const current = active;
    if (!current || disposed) return;
    let pids;
    try { pids = await readSessions(); }
    catch {
      if (active !== current || disposed) return;
      current.errorAt ??= now();
      if (now() - current.errorAt >= detectionGraceMs) { finish('detection-error'); return; }
    }
    if (active !== current || disposed) return;
    if (pids) {
      current.errorAt = null;
      if (pids.some(pid => !current.baseline.has(pid))) {
        if (!current.seen) status('running');
        current.seen = true; current.absentAt = null;
      } else if (current.seen) {
        current.absentAt ??= now();
        // FiveM can replace its bootstrap process when switching game builds.
        if (now() - current.absentAt >= exitGraceMs) { finish('closed'); return; }
      }
      if (!current.seen && now() - current.startedAt >= startupMs) { finish('startup-timeout'); return; }
    }
    timer = schedule(poll, pollMs);
  }
  return {
    async launch(dispatch) {
      if (disposed) throw new Error('Launcher is closing');
      if (active) {
        if (!active.seen || dispatching) throw Object.assign(new Error('กำลังติดตามการเปิด FiveM ครั้งก่อน กรุณารอสักครู่'), { status: 409 });
        // A user may restore the launcher and request CL2 while our first game
        // is running. The backend still enforces the CL2/process launch guard.
        dispatching = true;
        const previous = active;
        try {
          const baseline = await readSessions().catch(() => null);
          const result = await dispatch();
          if (!disposed) {
            // The old game can exit while Explorer is opening CL2. Start a new
            // watch if the old one completed, so this hide always has a monitor.
            if (active !== previous) {
              if (!baseline) { status('detection-error'); restore(); return result; }
              active = { baseline: new Set(baseline), startedAt: now(), seen: false, absentAt: null, errorAt: null };
              status('starting'); timer = schedule(poll, 0);
            }
            hide();
          }
          return result;
        }
        catch (error) { if (!disposed) { status('dispatch-error'); restore(); } throw error; }
        finally { dispatching = false; }
      }
      const pending = { baseline: new Set(), startedAt: now(), seen: false, absentAt: null, errorAt: null };
      active = pending;
      try {
        // A failed baseline read must not mistake an existing CL2 game for success.
        let canMonitor = true;
        try { pending.baseline = new Set(await readSessions()); }
        catch { canMonitor = false; }
        const result = await dispatch();
        if (disposed) return result;
        if (!canMonitor) { finish('detection-error'); return result; }
        pending.startedAt = now(); hide(); status('starting');
        timer = schedule(poll, 0);
        return result;
      } catch (error) { if (!disposed) finish('dispatch-error'); throw error; }
    },
    dispose() { disposed = true; active = null; cancel(timer); }
  };
}
module.exports = { createGameSession };
