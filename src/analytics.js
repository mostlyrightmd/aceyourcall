import { randomUUID, createHash } from 'node:crypto';
// Explicit events only: never forward user content, URLs, IPs or credentials.
export const browserEvents = new Set(['landing_viewed','create_opened','start_practice_clicked','join_opened','room_joined','join_failed','queue_entered','queue_left','interview_start_failed','scorecard_viewed']);
export function analytics({ token = process.env.MP_POSTHOG_TOKEN, host = process.env.MP_POSTHOG_HOST || 'https://us.i.posthog.com', send = fetch } = {}) {
  let pending = 0;
  return (event, id, properties = {}) => {
    if (!token || pending >= 8) return;
    const safe = {};
    for (const key of ['duration_seconds','wait_seconds']) if (Number.isFinite(properties[key])) safe[key] = Math.max(0, Math.min(86400, properties[key]));
    if (['complete','failed','unconfirmed'].includes(properties.status)) safe.status = properties.status;
    const distinct_id = id ? createHash('sha256').update('mostly-practice:' + id).digest('hex') : randomUUID();
    pending++;
    void send(host + '/i/v0/e/', {
      method: 'POST', headers: {'Content-Type':'application/json'}, signal: AbortSignal.timeout(3000),
      body: JSON.stringify({api_key:token,event:'practice_' + event,distinct_id,properties:{...safe,app:'mostly-practice',environment:'production',$process_person_profile:false,$geoip_disable:true}}),
    }).then(r => { if (!r.ok) console.warn('analytics_delivery_failed', r.status); }).catch(() => {}).finally(() => pending--);
  };
}
export const capture = analytics();
