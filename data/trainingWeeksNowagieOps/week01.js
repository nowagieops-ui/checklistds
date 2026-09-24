// NowagieOps Cold-Call Academy — Week 1. Same engine, format, and house
// rules as data/trainingWeeks (DashSpid's academy): pain before pitch, one
// thing deep instead of a feature dump, objections are questions in
// disguise, end every call with a named outcome. Only the target, product,
// and ask change — she's UK-based, B2B, and her one job is to get a
// business to book a free strategy call. Everything past that is not hers.
module.exports = {
  weekNumber: 1,
  title: 'Foundation',
  intro: 'Before your first NowagieOps call, go through these modules. You cannot move forward without passing each quiz at 80%. Your job on every single call is one thing: get them to book a free strategy call. Nothing else.',
  certificateDescription: 'has completed the NowagieOps Cold-Call Academy Week 1 and demonstrated knowledge of the agency, its services, the offer, call flow, objection handling, and booking technique.',
  cheatsheet: [
    { label: 'The one goal', value: 'Book a free strategy call — that is the entire job' },
    { label: 'The pitch', value: 'One team, one plan, growth you can measure' },
    { label: 'The problem we solve', value: '5 freelancers, 3 tools, 0 strategy' },
    { label: 'Services', value: 'Social, email, video, content, web, app' },
    { label: 'Engagement types', value: 'À la carte / Growth partner (most popular) / Project-based' },
    { label: 'The ask', value: 'Free strategy call — no obligation, no card' },
    { label: 'Response time promised', value: 'Within 1 business day' },
    { label: 'What happens on the call', value: 'Discovery → strategy plan → tailored quote' }
  ],
  modules: [
    {
      id: 'intro', title: 'What is NowagieOps?', tag: 'Foundation',
      content: [
        { header: 'The one-line answer', body: 'NowagieOps is a brand growth agency. Instead of a business hiring five different freelancers and juggling three different tools with no coordinated strategy, they get one team running everything under one plan — social media, email marketing, video, content, websites, and apps.' },
        { header: 'The problem every business you call already has', body: '', bullets: [
          'Different freelancer for Instagram, another for their website, another for video — none of them talk to each other',
          'No real strategy tying any of it together — just random posts and one-off projects',
          'No way to measure whether any of it is actually working',
          'The owner is the one holding it all together in their own head, on top of running the actual business'
        ] },
        { header: 'What NowagieOps gives them instead', body: 'One team, one plan, and growth they can actually measure. A single point of contact instead of five. A strategy instead of scattered activity.' },
        { callout: 'You are not selling a service. You are selling relief from managing five people who do not talk to each other.' }
      ],
      quiz: [
        { q: 'What is the most accurate one-line description of NowagieOps?', options: ['A social media app', 'A brand growth agency that runs a business\'s marketing under one coordinated team and plan', 'A freelancer marketplace', 'A web hosting company'], answer: 1, exp: 'NowagieOps replaces the scattered freelancer approach with one coordinated team and strategy.' },
        { q: 'What is the core problem NowagieOps solves for most businesses you call?', options: ['They have too much marketing budget', 'They are juggling multiple freelancers and tools with no coordinated strategy', 'They have no website at all', 'They need cheaper hosting'], answer: 1, exp: 'The "5 freelancers, 3 tools, 0 strategy" problem is the core pain — coordination and strategy, not just execution.' },
        { q: 'What are you really selling on a call?', options: ['The cheapest agency price in the market', 'Relief from managing multiple disconnected freelancers, plus a real strategy', 'A one-off video edit', 'A free website'], answer: 1, exp: 'The value is consolidation and coordination, not any single service in isolation.' }
      ]
    },
    {
      id: 'targets', title: 'Who Are You Calling?', tag: 'Know your prospect',
      content: [
        { header: 'Two types of prospect — very different pitches', body: 'Every call is to one of two types. Know which one you have before you open your mouth.' },
        { header: 'Target 1 — The Overwhelmed DIY Owner', body: 'Running the business and doing most of the marketing themselves, or juggling a couple of freelancers directly. No time, no strategy, just keeping the lights on.', bullets: [
          'Pain: no time to manage marketing on top of running the business',
          'Pain: whatever content exists is inconsistent — some weeks nothing goes out at all',
          'Pain: no idea if any of it is working',
          'What moves them: someone else owns it completely, so they can go back to running their business'
        ] },
        { header: 'Target 2 — The Scaling Business', body: 'Already has some traction and probably already spends money on marketing — a freelancer here, an agency there — but it is disjointed and not scaling with them.', bullets: [
          'Pain: growth has stalled because marketing has not kept up',
          'Pain: current freelancers/agency are order-takers, not strategists',
          'Pain: wants to look and operate like a bigger, more established brand',
          'What moves them: a real team and a real plan, not just more one-off tasks'
        ] },
        { callout: 'Ask before you pitch: "Who is currently handling your marketing — is it you, a freelancer, or an agency?" That one question tells you which pitch to use.' }
      ],
      quiz: [
        { q: 'The Overwhelmed DIY Owner\'s biggest pain is usually:', options: ['Too much marketing budget', 'No time to manage marketing on top of running the business, and no consistency', 'Too many customers', 'Wanting a cheaper website'], answer: 1, exp: 'This target is stretched thin and needs someone to take the whole thing off their plate.' },
        { q: 'The Scaling Business\'s biggest pain is usually:', options: ['They have never done any marketing', 'Growth has stalled because their current marketing setup is disjointed and not strategic', 'They cannot afford any agency', 'They only want a logo'], answer: 1, exp: 'This target already has traction but has outgrown a patchwork of freelancers.' },
        { q: 'What is the first question you should ask to determine which pitch to use?', options: ['"What is your budget?"', '"Who is currently handling your marketing — you, a freelancer, or an agency?"', '"Have you heard of NowagieOps?"', '"How many followers do you have?"'], answer: 1, exp: 'This immediately tells you DIY owner vs scaling business — which changes your entire pitch.' },
        { q: 'A prospect says they already have a freelancer doing their Instagram. What do you say?', options: ['Tell them to fire the freelancer immediately', 'Ask if that freelancer is also handling their email, video, website, and overall strategy — or just the one piece', 'Say NowagieOps does not work with anyone who has a freelancer', 'Hang up, this lead is dead'], answer: 1, exp: 'One freelancer doing one thing is exactly the "3 tools, 0 strategy" gap NowagieOps fills. Surface the pieces they are NOT covering.' }
      ]
    },
    {
      id: 'services', title: 'The Services & The Offer', tag: 'Product knowledge',
      content: [
        { header: 'The six things NowagieOps does', body: '', bullets: [
          'Social Media Management — Instagram, TikTok, LinkedIn, X, YouTube',
          'Email Marketing — campaigns, automation, list growth',
          'Video Editing — reels, YouTube, ads',
          'Content Creation — design, copywriting, photography',
          'Website Development — landing pages, e-commerce, SEO',
          'App Development — iOS, Android, web apps'
        ] },
        { header: 'How the engagement works', body: '', bullets: [
          'À la carte — a single service with a clear scope',
          'Growth partner — the full team on retainer (this is the most popular one)',
          'Project-based — a fixed deliverable like a website, an app, or a campaign'
        ] },
        { header: 'The actual ask — never skip this', body: 'You are never selling a contract or a price on this call. You are booking a free strategy call. No obligation, no card, a real conversation with the team about their specific business.' },
        { callout: 'On a call, never list all six services. Find the ONE they are missing or struggling with and go deep on that. One clear pain point beats six services listed quickly.' }
      ],
      quiz: [
        { q: 'Which engagement type is described as the most popular?', options: ['À la carte', 'Growth partner — the full team on retainer', 'Project-based only', 'There is only one option'], answer: 1, exp: 'Growth partner (full retainer team) is the most popular engagement type.' },
        { q: 'What is the actual thing you are asking for on every call?', options: ['A signed contract', 'Payment up front', 'A free, no-obligation strategy call', 'Their email for a newsletter'], answer: 2, exp: 'The entire goal of the call is booking the free strategy call — nothing more.' },
        { q: 'How many services should you pitch deeply on one call?', options: ['All six', 'Four or five', 'One — the one most relevant to their specific pain', 'None, just send a brochure'], answer: 2, exp: 'Exactly like landing one feature deep instead of a feature dump — find their one gap and go deep on it.' }
      ]
    },
    {
      id: 'callflow', title: 'The Call Flow', tag: 'Step by step',
      content: [
        { header: 'Step 1 — Open with their pain, not your pitch', body: '"Quick one — who\'s currently handling your social media and content?" or "Quick question — is your current marketing actually tied to a real strategy, or is it a bit ad hoc right now?" Never open with your name, the company name, or a list of services.' },
        { header: 'Step 2 — Get confirmation', body: '"Is that something that\'s been a headache?" Let them talk. The more they describe their own gap, the easier the rest of the call is. Do not skip this.' },
        { header: 'Step 3 — Introduce NowagieOps briefly', body: 'NowagieOps is a brand growth agency — one team, one plan, running social, content, email, and web under one strategy instead of five different freelancers. Then pivot straight to the one gap they just described.' },
        { header: 'Step 4 — Land one service deeply', body: 'Do not list all six services. Pick the one most relevant to their gap and explain exactly what it would look like for their business.' },
        { header: 'Step 5 — Make the ask low-risk', body: 'This is not a sales call. It is a free strategy call — no obligation, no card. They get a real plan for their business whether they go further or not.' },
        { header: 'Step 6 — Handle objections', body: 'Every objection is a question in disguise. Answer it, then re-engage — do not argue and do not go quiet.' },
        { header: 'Step 7 — Close', body: 'Offer two specific times: "I\'ve got Tuesday at 2pm or Thursday at 11am for a quick 30-minute strategy call — which works better?" Never ask "when works for you" open-ended.' },
        { callout: 'End every call with ONE of three things: a booked strategy call, a confirmed specific callback time, or a firm no. Never just say goodbye and hope.' }
      ],
      quiz: [
        { q: 'How should you open a cold call?', options: ['Introduce yourself and list all six NowagieOps services', 'Ask if they have heard of NowagieOps', 'Open with a question about their current pain — who handles their marketing, is it working', 'Ask for their budget straight away'], answer: 2, exp: 'Always open with their pain, not your pitch.' },
        { q: 'How many services should you go deep on in a single call?', options: ['All six, so they know everything on offer', 'One — the most relevant to their specific gap', 'Three or four', 'None — just book the call with no detail'], answer: 1, exp: 'One thing explained well beats six things listed quickly.' },
        { q: 'How should you offer the strategy call at close?', options: ['"When works for you?" — fully open-ended', 'Offer two specific times and ask which is better', 'Tell them to book it themselves online with no call-time mentioned', 'Ask them to think about it and call back'], answer: 1, exp: 'Two specific times makes it easy to say yes. Open-ended questions make it easy to stall.' },
        { q: 'What are the three acceptable ways to end a call?', options: ['A vague "I\'ll follow up sometime"', 'A booked strategy call, a confirmed specific callback time, or a firm no', 'Just say goodbye and move to the next lead', 'Promise to email more information'], answer: 1, exp: 'Every call must end with one of these three concrete outcomes.' }
      ]
    },
    { id: 'roleplay', title: 'Live Call Practice', tag: 'AI roleplay', isRoleplay: true },
    {
      id: 'close', title: 'The Close and Follow-Up', tag: 'Finish strong',
      content: [
        { header: 'Primary close — book it on the call', body: '"I\'ve got Tuesday at 2pm or Thursday at 11am for a free 30-minute strategy call — no obligation, nothing to sign. Which works better?" Get the booking confirmed in the moment, on the booking link, before you hang up.' },
        { header: 'If they will not book on the call', body: '"No problem — I\'ll send you the booking link right now so you can grab a time that works whenever you\'re ready. I\'ll follow up in a few days to see if you\'ve had a chance to look." Get their email or WhatsApp before you hang up — never leave with nothing.' },
        { header: 'Why the follow-up cadence is different from a quick app signup', body: 'A UK business owner deciding whether to book a strategy call is a slower decision than someone signing up for an app on the spot — they need more touches spread over more time, not one fast follow-up. The principle is the same as always: a specific number, never "sometime" — just a longer number for a longer decision.' },
        { header: 'The follow-up cadence — non-negotiable', body: '', bullets: [
          'Day 1 — send the booking link immediately, before you hang up, never after',
          'Day 3 — first follow-up if no booking yet',
          'Day 7 — second follow-up, add a specific reason to book now',
          'Day 14 — final follow-up before moving them to a longer-term nurture list',
          'Log every contact: name, business, pain identified, outcome, next follow-up date'
        ] },
        { callout: 'Warm leads go cold fast, but a UK B2B decision also takes longer than a quick app signup. Stay on the cadence — do not follow up too late, and do not give up too early.' }
      ],
      quiz: [
        { q: 'What is the best outcome of a call?', options: ['Their email for a newsletter', 'A booked strategy call, confirmed with a specific time', 'A promise to think about it', 'Sending a generic brochure'], answer: 1, exp: 'A confirmed booking at a specific time is the ideal outcome — always aim for that first.' },
        { q: 'When should you send the booking link if they do not book on the call?', options: ['The next day', 'Before you hang up — never after', 'Only if they ask for it', 'A week later with the follow-up'], answer: 1, exp: 'Send it immediately, while they are still engaged. Waiting loses the moment.' },
        { q: 'Why is the NowagieOps follow-up cadence spread over two weeks instead of DashSpid\'s 48-hour follow-up?', options: ['There is no real reason, it is arbitrary', 'A UK B2B strategy-call decision is slower than a quick app signup, so it needs more touches over more time — same principle, different number', 'NowagieOps leads are less important', 'It is a mistake and should be 48 hours too'], answer: 1, exp: 'The house rule is always "a specific number, never sometime" — the number changes with how fast the decision actually is, not the principle.' },
        { q: 'What should you log after every single call?', options: ['Nothing, just move to the next number', 'Name, business, pain identified, outcome, and next follow-up date', 'Only calls that result in a booking', 'Just whether they were rude or not'], answer: 1, exp: 'Every call gets logged — this is what makes the follow-up cadence actually work instead of leads falling through the cracks.' }
      ]
    }
  ],
  scenarios: [
    { prospect: 'Small e-commerce owner, Manchester', objection: 'We already have someone doing our Instagram, it\'s fine.' },
    { prospect: 'Local service business owner, Leeds', objection: 'We don\'t have the budget for an agency right now.' },
    { prospect: 'Early-stage founder, London', objection: 'Just send me some information by email.' },
    { prospect: 'Established retailer, Birmingham', objection: 'We used an agency before and it was a waste of money.' },
    { prospect: 'Growing consultancy, Bristol', objection: 'How much does this actually cost?' }
  ]
};
