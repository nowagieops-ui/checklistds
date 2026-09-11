// Connects Staff Ops to the real DashSpid platform (Next.js + Supabase) so
// the growth-OS funnel is built on real order/storefront outcomes instead of
// staff-reported guesses. See the "Funnel Definitions (Locked)" section of
// the growth-OS implementation plan for exactly what each stage means and
// why — this file is the executable version of those rules, nothing more.
//
// Three responsibilities, run on an interval from server.js:
//   matchProspects() — resolves a prospect's staff_ops_code (a one-time,
//     precise attribution/join token) to the platform's businesses.id (the
//     durable, canonical reference — see plan). Once matched, staff_ops_code
//     is never consulted again.
//   attributeUnlinkedPlatformSignups() — the fallback that reflects how
//     attribution actually happens today: riders just tell the platform a
//     staff member's NAME (e.g. "Chiamaka" or "Joseph"), not a generated
//     code. For any business sourced from field_marketer/telemarketer whose
//     marketer_code names a known staff member and isn't linked to any
//     prospect yet, this attaches it to that staff member's oldest
//     unmatched onboarded prospect if one exists, or creates a new
//     funnel-tracking record on the spot. Safe only while staff names don't
//     collide — see namesMatch() below.
//   syncOutcomes()   — for already-matched prospects, re-derives funnel
//     timestamps from live platform data. Every write is COALESCE'd in
//     db.updateRiderFunnelOutcomes so a stage can only be filled in, never
//     regressed or invented.
const { createClient } = require('@supabase/supabase-js');
const db = require('../db/database');
const { toLagosDateTime, nowLagos } = require('../utils/time');

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null; // sync is a no-op until platform credentials are configured
  return createClient(url, key, { auth: { persistSession: false } });
}

// True if the free-text marketer_code a business typed in plausibly names
// this staff member — exact full-name match, any single word they typed
// matching any single word of the staff member's name ("Chiamaka" matching
// "Chiamaka Nwoke", "Joseph" matching "Etuka Joseph"), or a >=4-letter
// nickname/short form contained in one of the staff member's name words
// ("Amaka" matching "Chiamaka" — a very common short form that drops the
// "Chi-" prefix).
//
// This is deliberately loose, matching real behavior rather than an ideal
// unique code. It only stays safe while no two active staff members share a
// name/nickname — with a bigger team, this needs tightening (e.g. requiring
// the generated code, or a disambiguation step) before it's trustworthy.
function namesMatch(marketerCode, staffName) {
  const normalize = s => (s || '').toLowerCase().trim().replace(/[^a-z\s]/g, '');
  const code = normalize(marketerCode);
  const name = normalize(staffName);
  if (!code || !name) return false;
  if (code === name) return true;

  const nameTokens = name.split(/\s+/).filter(Boolean);
  const codeTokens = code.split(/\s+/).filter(Boolean);
  if (codeTokens.some(t => nameTokens.includes(t))) return true;

  // Nickname/short-form containment, guarded to 4+ letters so short
  // fragments (e.g. "jo") can't loosely match everything.
  return codeTokens.some(ct => ct.length >= 4 && nameTokens.some(nt => nt.includes(ct) || ct.includes(nt)));
}

async function matchProspects() {
  const supabase = getClient();
  if (!supabase) return { checked: 0, matched: 0 };

  const unmatched = await db.getUnmatchedProspectsWithCode();
  let matched = 0;
  for (const prospect of unmatched) {
    const { data, error } = await supabase
      .from('businesses')
      .select('id')
      .eq('marketer_code', prospect.staff_ops_code)
      .maybeSingle();
    if (error) { console.error('platformSync.matchProspects:', error.message); continue; }
    if (data) {
      await db.linkRiderToPlatformBusiness(prospect.id, data.id, nowLagos());
      matched++;
    }
  }
  return { checked: unmatched.length, matched };
}

async function attributeUnlinkedPlatformSignups() {
  const supabase = getClient();
  if (!supabase) return { checked: 0, attributed: 0 };

  const alreadyLinked = new Set(await db.getLinkedPlatformBusinessIds());
  const marketers = await db.getMarketers(); // active staff only — matches real attribution intent

  const { data: businesses, error } = await supabase
    .from('businesses')
    .select('id, name, email, phone, how_heard, marketer_code, created_at')
    .in('how_heard', ['field_marketer', 'telemarketer'])
    .not('marketer_code', 'is', null);
  if (error) { console.error('platformSync.attributeUnlinkedPlatformSignups:', error.message); return { checked: 0, attributed: 0 }; }

  let attributed = 0;
  for (const business of businesses || []) {
    if (alreadyLinked.has(business.id)) continue;

    const staff = marketers.find(m => namesMatch(business.marketer_code, m.name));
    if (!staff) continue; // no known staff member matches this text — leave unmatched rather than guess

    const channel = staff.role === 'telemarketer' ? 'telemarketer' : 'field_marketer';
    const registeredAt = toLagosDateTime(business.created_at);

    const existingProspect = await db.getOldestUnmatchedProspectForMarketer(staff.id);
    if (existingProspect) {
      await db.linkRiderToPlatformBusiness(existingProspect.id, business.id, registeredAt);
    } else {
      await db.createLinkedProspectFromPlatform({
        name: business.name, email: business.email, phone: business.phone,
        marketerId: staff.id, marketerName: staff.name, channel,
        platformBusinessId: business.id, registeredAt
      });
    }
    attributed++;
  }
  return { checked: (businesses || []).length, attributed };
}

// Activated = account live AND WhatsApp connected AND pricing configured —
// the two setup steps DashSpid's own onboarding welcome email tells new
// businesses they need, plus the account actually being active. Deliberately
// NOT based on is_accepting_orders, which the prospect-detail screen tracks
// as its own separate status (a business can be activated but paused).
//
// There's no discrete "activated at" event on the platform (no timestamp for
// "WhatsApp connected" or "pricing configured"), so this stamps the moment
// our sync first observes the condition being true — the best available
// signal, not a fabricated one.
async function isBusinessActivated(supabase, business) {
  if (!business.is_active || !business.whatsapp_phone_number_id) return false;
  for (const table of ['pricing_config', 'pricing_rules', 'pricing_zones']) {
    const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq('business_id', business.id);
    if (error) { console.error(`platformSync.isBusinessActivated (${table}):`, error.message); continue; }
    if (count > 0) return true;
  }
  return false;
}

async function syncOutcomes() {
  const supabase = getClient();
  if (!supabase) return { checked: 0 };

  const linked = await db.getLinkedProspects();
  for (const prospect of linked) {
    const businessId = prospect.platform_business_id;

    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('id, is_active, is_accepting_orders, whatsapp_phone_number_id')
      .eq('id', businessId)
      .maybeSingle();
    if (businessError) { console.error('platformSync.syncOutcomes business:', businessError.message); continue; }
    if (!business) continue; // matched business row no longer exists — leave outcomes as last known, don't clear them

    const fields = { is_accepting_orders: business.is_accepting_orders ? 1 : 0 };

    if (!prospect.activated_at && (await isBusinessActivated(supabase, business))) {
      fields.activated_at = nowLagos();
    }

    // Customer activity: first real storefront visit for this business,
    // counted from whichever the prospect actually has — link_shared_at if
    // staff have confirmed the share, otherwise activated_at. A visit is
    // evidence of activity either way; this is independent of the
    // link-shared flag, which is never inferred from a visit (see plan).
    if (!prospect.first_activity_at) {
      const since = prospect.link_shared_at || prospect.activated_at || fields.activated_at;
      if (since) {
        const { data: visits, error: visitError } = await supabase
          .from('storefront_visits')
          .select('created_at')
          .eq('business_id', businessId)
          .gte('created_at', new Date(since).toISOString())
          .order('created_at', { ascending: true })
          .limit(1);
        if (visitError) console.error('platformSync.syncOutcomes storefront_visits:', visitError.message);
        else if (visits && visits[0]) fields.first_activity_at = toLagosDateTime(visits[0].created_at);
      }
    }

    if (!prospect.first_order_at || !prospect.completed_order_at || !prospect.repeat_business_order_at) {
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('created_at, delivered_at, status')
        .eq('business_id', businessId)
        .order('created_at', { ascending: true });
      if (ordersError) console.error('platformSync.syncOutcomes orders:', ordersError.message);
      else if (orders && orders.length > 0) {
        // First order = first order PLACED, regardless of outcome — distinct
        // from completed order below. Don't conflate the two.
        if (!prospect.first_order_at) fields.first_order_at = toLagosDateTime(orders[0].created_at);

        const delivered = orders
          .filter(o => o.status === 'delivered' && o.delivered_at)
          .sort((a, b) => new Date(a.delivered_at) - new Date(b.delivered_at));
        if (delivered.length > 0 && !prospect.completed_order_at) {
          fields.completed_order_at = toLagosDateTime(delivered[0].delivered_at);
        }
        // Repeat, business-level: the 2nd COMPLETED order — "is this rider
        // continuing to get business." Kept separate from customer-level
        // repeat below; the two can disagree and both matter.
        if (delivered.length >= 2 && !prospect.repeat_business_order_at) {
          fields.repeat_business_order_at = toLagosDateTime(delivered[1].delivered_at);
        }
      }
    }

    {
      // Repeat, customer-level: "are customers coming back" — sourced from
      // customers.order_count, which is a running counter with no history of
      // exactly when it crossed 2. MIN(last_order_at) among repeat customers
      // is the closest real signal available, not an invented one, and
      // repeat_customer_count is refreshed every run since it's a live count,
      // not a one-time milestone (first_repeat_customer_at, once set, still
      // stays fixed via the COALESCE in db.updateRiderFunnelOutcomes).
      const { data: customers, error: customersError } = await supabase
        .from('customers')
        .select('order_count, last_order_at')
        .eq('business_id', businessId)
        .gte('order_count', 2);
      if (customersError) console.error('platformSync.syncOutcomes customers:', customersError.message);
      else if (customers) {
        fields.repeat_customer_count = customers.length;
        if (customers.length > 0 && !prospect.first_repeat_customer_at) {
          const earliest = customers.reduce((min, c) => !min || new Date(c.last_order_at) < new Date(min) ? c.last_order_at : min, null);
          if (earliest) fields.first_repeat_customer_at = toLagosDateTime(earliest);
        }
      }
    }

    await db.updateRiderFunnelOutcomes(prospect.id, fields);
  }
  return { checked: linked.length };
}

async function runSync() {
  const matchResult = await matchProspects();
  const nameMatchResult = await attributeUnlinkedPlatformSignups();
  const syncResult = await syncOutcomes();
  return { matchResult, nameMatchResult, syncResult };
}

function startInterval(intervalMs = 5 * 60 * 1000) {
  if (!getClient()) {
    console.log('platformSync: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — platform sync disabled');
    return;
  }
  runSync().catch(err => console.error('platformSync initial run failed:', err));
  setInterval(() => {
    runSync().catch(err => console.error('platformSync run failed:', err));
  }, intervalMs);
}

module.exports = { matchProspects, attributeUnlinkedPlatformSignups, syncOutcomes, runSync, startInterval };
