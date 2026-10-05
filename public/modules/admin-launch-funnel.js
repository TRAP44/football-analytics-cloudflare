import { createAdminLaunchFunnelRenderer } from './admin-launch-funnel-renderer.js';
export function createAdminLaunchFunnelModule({
  state,
  $,
  isAdmin,
  escapeHtml,
  api,
  toast,
  dateTime,
} = {}) {
  let launchFunnelRenderer;
  function renderLaunchFunnel() {
    launchFunnelRenderer ||= createAdminLaunchFunnelRenderer({
      state,
      $,
      isAdmin,
      escapeHtml,
      dateTime,
      onAcknowledge: acknowledgeRecoveryIncident,
    });
    return launchFunnelRenderer.renderLaunchFunnel();
  }

  async function acknowledgeRecoveryIncident({reason='',action='',code='',lastSeenAt=''}={}) {
    if (!isAdmin() || !reason || !action || !code || !lastSeenAt) return;
    const key=`${reason}|${action}|${code}|${lastSeenAt}`;
    if (state.recoveryIncidentAckPending.has(key)) return;
    state.recoveryIncidentAckPending.add(key);
    renderLaunchFunnel();
    try {
      await api('/api/recovery-incident-ack',{
        method:'POST',
        body:JSON.stringify({reason,action,code,lastSeenAt}),
        retry:false,
        dedupe:false,
        timeoutMs:10000,
      });
      toast('Инцидент отмечен как просмотренный.');
      await loadLaunchFunnel(true);
    } catch (e) {
      toast(e.message);
      if (Number(e?.status || 0)===409) await loadLaunchFunnel(true);
    } finally {
      state.recoveryIncidentAckPending.delete(key);
      renderLaunchFunnel();
    }
  }
  
  async function loadLaunchFunnel(force=false) {
    if (!isAdmin() || state.launchFunnelLoading) return;
    if (!force && state.launchFunnel) { renderLaunchFunnel(); return; }
    state.launchFunnelLoading=true;
    renderLaunchFunnel();
    try {
      const days=Number($('launchFunnelPeriod')?.value || state.launchFunnelDays || 7);
      state.launchFunnelDays=days;
      state.launchFunnel=await api(`/api/launch-funnel?days=${days}`,{retry:false,timeoutMs:10000});
    } catch (e) {
      state.launchFunnel={available:false,reason:e.message};
      toast(e.message);
    } finally {
      state.launchFunnelLoading=false;
      renderLaunchFunnel();
    }
  }
  

  return Object.freeze({
    renderLaunchFunnel,
    acknowledgeRecoveryIncident,
    loadLaunchFunnel,
  });
}
