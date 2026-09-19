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
//     timestamps from live platform data. Activation/activity/storefront
//     timestamps are COALESCE'd in db.updateRiderFunnelOutcomes so they can
//     only be filled in, never regressed or invented. Order milestones are
//     instead recomputed from the order history every run (see
//     db.setRiderOrderMilestones), so wrongly counted test orders self-correct.
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

// For a "new" stage prospect that hasn't been auto-linked yet: recent
// platform signups whose marketer_code names this staff member and aren't
// already linked to any prospect. Deliberately manual rather than
// auto-picking one (like attributeUnlinkedPlatformSignups's oldest-unmatched
// heuristic does for the fully-automatic path) — when a staff member has
// several concurrent unregistered leads, only a human knows which specific
// one just signed up.
async function getUnmatchedCandidatesForStaff(staffName, limit = 10) {
  const supabase = getClient();
  if (!supabase) return [];

  const alreadyLinked = new Set(await db.getLinkedPlatformBusinessIds());
  const { data: businesses, error } = await supabase
    .from('businesses')
    .select('id, name, phone, marketer_code, created_at')
    .in('how_heard', ['field_marketer', 'telemarketer'])
    .not('marketer_code', 'is', null)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) { console.error('platformSync.getUnmatchedCandidatesForStaff:', error.message); return []; }

  return (businesses || [])
    .filter(b => !alreadyLinked.has(b.id) && namesMatch(b.marketer_code, staffName))
    .slice(0, limit);
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

// Whether ANY pricing row exists for this business — the one setup fact
// that's actually reliable (real, checked variance across real businesses;
// unlike business_hours, which is auto-populated identically for everyone
// regardless of whether they touched it, or whatsapp_phone_number_id, which
// is null on every single real field/telemarketer-sourced business right
// now — a confirmed platform-side tracking bug, not a real signal).
async function hasPricingConfigured(supabase, businessId) {
  for (const table of ['pricing_config', 'pricing_rules', 'pricing_zones']) {
    const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq('business_id', businessId);
    if (error) { console.error(`platformSync.hasPricingConfigured (${table}):`, error.message); continue; }
    if (count > 0) return true;
  }
  return false;
}

// Activated = account live AND pricing configured. Originally also required
// whatsapp_phone_number_id (the other onboarding welcome-email step), but
// that's confirmed null on every real field/telemarketer-sourced business —
// a platform-side WhatsApp-connection tracking bug — so requiring it made
// "activated" permanently read ~0 for everyone regardless of real setup
// state. Dropped until that's fixed upstream. Deliberately NOT based on
// is_accepting_orders, which the prospect-detail screen tracks as its own
// separate status (a business can be activated but paused).
//
// There's no discrete "activated at" event on the platform (no timestamp
// for "pricing configured"), so this stamps the moment our sync first
// observes the condition being true — the best available signal, not a
// fabricated one.
async function isBusinessActivated(supabase, business) {
  if (!business.is_active) return false;
  return hasPricingConfigured(supabase, business.id);
}

// An order placed within this long of the business registering is the
// onboarding walkthrough — the marketer placing an order to show how it
// works — not a sale, so it never counts toward first/completed/repeat order.
// The customer_id filter alone wasn't enough: those walkthrough orders are
// placed through the storefront and do have a customer.
const TEST_ORDER_WINDOW_MS = 20 * 60 * 1000;

function realOrders(orders, businessCreatedAt) {
  if (!businessCreatedAt) return orders; // can't tell when they registered — don't guess
  const cutoff = new Date(businessCreatedAt).getTime() + TEST_ORDER_WINDOW_MS;
  return orders.filter(o => new Date(o.created_at).getTime() > cutoff);
}

async function syncOutcomes() {
  const supabase = getClient();
  if (!supabase) return { checked: 0 };

  const linked = await db.getLinkedProspects();
  for (const prospect of linked) {
    const businessId = prospect.platform_business_id;

    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('id, created_at, is_active, is_accepting_orders, whatsapp_phone_number_id, slug, custom_domain, custom_domain_verified, bank_account_number')
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

    {
      // Order milestones are recomputed from the platform on every run
      // rather than filled in once and frozen: they're a pure function of the
      // order history, so recomputing can't invent anything — and it means a
      // test order that was wrongly counted before this rule existed gets
      // corrected instead of staying stamped forever.
      //
      // customer_id IS NOT NULL excludes orders the business placed from its
      // own dashboard (source='dashboard') or bulk-imported ('csv_import'),
      // which have no customer_id; realOrders() then drops the onboarding
      // walkthrough orders placed in the first minutes after registering.
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('created_at, delivered_at, status')
        .eq('business_id', businessId)
        .not('customer_id', 'is', null)
        .order('created_at', { ascending: true });
      if (ordersError) {
        // Leave the last known values alone rather than wiping them on a blip.
        console.error('platformSync.syncOutcomes orders:', ordersError.message);
      } else {
        const real = realOrders(orders || [], business.created_at);
        const delivered = real
          .filter(o => o.status === 'delivered' && o.delivered_at)
          .sort((a, b) => new Date(a.delivered_at) - new Date(b.delivered_at));
        await db.setRiderOrderMilestones(prospect.id, {
          // First order = first order PLACED, regardless of outcome — distinct
          // from completed order. Don't conflate the two.
          first_order_at: real.length > 0 ? toLagosDateTime(real[0].created_at) : null,
          completed_order_at: delivered.length > 0 ? toLagosDateTime(delivered[0].delivered_at) : null,
          // Repeat, business-level: the 2nd COMPLETED order — "is this rider
          // continuing to get business." Kept separate from customer-level
          // repeat below; the two can disagree and both matter.
          repeat_business_order_at: delivered.length >= 2 ? toLagosDateTime(delivered[1].delivered_at) : null
        });
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

    // Storefront link + reach — kept in sync every run since both can
    // legitimately change (a custom domain gets added/verified later;
    // visitor count only grows), unlike the once-true-stays-true funnel
    // timestamps above.
    const storefrontUrl = business.custom_domain && business.custom_domain_verified
      ? `https://${business.custom_domain}`
      : business.slug ? `https://${business.slug}.dashspid.com` : null;

    // PostgREST's count:'exact'+head:true counts ROWS matching the filter,
    // not distinct values of the selected column — it can't compute
    // COUNT(DISTINCT visitor_id) server-side without a custom RPC, which
    // doesn't exist here. So this fetches the actual visitor_id values and
    // dedupes in JS — fine at current volumes, would need revisiting (an
    // RPC, or a materialized count) if any single business's visit count
    // grows into the thousands.
    const { data: visitorRows, error: visitorError } = await supabase
      .from('storefront_visits')
      .select('visitor_id')
      .eq('business_id', businessId);
    if (visitorError) console.error('platformSync.syncOutcomes visitor count:', visitorError.message);
    const uniqueVisitorCount = visitorError ? 0 : new Set((visitorRows || []).map(v => v.visitor_id)).size;

    // Real share ATTEMPTS (Copy link clicks), not reach — see plan/migration
    // notes. link_share_events may not exist yet on older platform
    // deployments, so a missing-table error is swallowed rather than
    // spamming the log every run.
    const { count: linkShareCount, error: shareError } = await supabase
      .from('link_share_events')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId);
    if (shareError && shareError.code !== 'PGRST205') console.error('platformSync.syncOutcomes link shares:', shareError.message);

    await db.updateRiderStorefrontInfo(prospect.id, { storefrontUrl, uniqueVisitorCount, linkShareCount: linkShareCount || 0 });

    // Cross-checks two of the onboarding checklist's required claims
    // (item_pricing, item_payout) against real platform data — see the
    // migration for why WhatsApp and availability aren't checked here.
    const pricingVerified = await hasPricingConfigured(supabase, businessId);
    const payoutVerified = !!(business.bank_account_number && business.bank_account_number.trim());
    await db.updateRiderChecklistVerification(prospect.id, { pricingVerified, payoutVerified });
  }
  return { checked: linked.length };
}

async function runSync() {
  const matchResult = await matchProspects();
  const nameMatchResult = await attributeUnlinkedPlatformSignups();
  const syncResult = await syncOutcomes();
  return { matchResult, nameMatchResult, syncResult };
}

// Live, on-demand fetch for the prospect detail page — NOT synced into
// MySQL, since this is inherently a daily time series and the detail page
// is viewed rarely enough that a fresh Supabase read each time is cheap.
// Sparse by construction: a day with zero activity never gets a row in
// business_activity_pings, so it simply won't appear here — no fabricated
// zero-days.
async function getRecentUsage(platformBusinessId, days = 7) {
  const supabase = getClient();
  if (!supabase || !platformBusinessId) return [];
  const { data, error } = await supabase
    .from('business_activity_pings')
    .select('day, open_count, active_seconds')
    .eq('business_id', platformBusinessId)
    .order('day', { ascending: false })
    .limit(days);
  if (error) { console.error('platformSync.getRecentUsage:', error.message); return []; }
  return data || [];
}

// Company-wide app-usage rollup for the manager dashboard's Growth
// Overview — total opens, total active minutes, and how many distinct
// linked businesses had any activity, across whichever window
// (sinceDate undefined = all-time). Scoped to businesses actually linked
// to a Staff Ops prospect (via riders.platform_business_id), not every
// business on the platform — this dashboard is about staff-driven growth,
// not organic signups nobody here sourced.
async function getCompanyUsageSummary(sinceDate) {
  const supabase = getClient();
  const empty = { totalOpens: 0, totalMinutes: 0, activeBusinesses: 0 };
  if (!supabase) return empty;

  const linkedIds = await db.getLinkedPlatformBusinessIds();
  if (linkedIds.length === 0) return empty;

  let query = supabase.from('business_activity_pings').select('business_id, open_count, active_seconds').in('business_id', linkedIds);
  if (sinceDate) query = query.gte('day', sinceDate);
  const { data, error } = await query;
  if (error) { console.error('platformSync.getCompanyUsageSummary:', error.message); return empty; }

  const totalOpens = (data || []).reduce((sum, r) => sum + (r.open_count || 0), 0);
  const totalSeconds = (data || []).reduce((sum, r) => sum + (r.active_seconds || 0), 0);
  const activeBusinesses = new Set((data || []).map(r => r.business_id)).size;
  return { totalOpens, totalMinutes: Math.round(totalSeconds / 60), activeBusinesses };
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

module.exports = { matchProspects, attributeUnlinkedPlatformSignups, syncOutcomes, runSync, startInterval, getRecentUsage, getUnmatchedCandidatesForStaff, getCompanyUsageSummary };
