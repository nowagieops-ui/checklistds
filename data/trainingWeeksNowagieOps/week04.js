// NowagieOps Cold-Call Academy — Week 4: Making The Ask Irresistible.
// Alex Hormozi's Value Equation, applied to a free strategy call rather than
// a paid offer — the ask is already low-risk, this week is about making the
// upside feel obvious too.
module.exports = {
  weekNumber: 4,
  title: 'Making The Ask Irresistible',
  intro: 'Booking a free strategy call should feel like an easy yes. This week is about why it sometimes does not, and how to fix that in the moment.',
  certificateDescription: 'has completed NowagieOps Cold-Call Academy Week 4 and demonstrated framing the offer using the Value Equation.',
  modules: [
    {
      id: 'value-equation', title: 'The Value Equation', tag: 'Framework',
      content: [
        { header: 'Four things decide whether an offer feels worth it', body: '', bullets: [
          'Dream outcome — what they actually want (a brand that runs itself, real growth)',
          'Perceived likelihood — do they believe NowagieOps can actually deliver it',
          'Time delay — how long until they see something happen',
          'Effort and sacrifice — how much work or risk it takes them to say yes'
        ] },
        { header: 'A free strategy call is already close to zero effort and zero risk', body: 'Your job is not to invent urgency out of nowhere — it is to raise perceived likelihood (proof, specifics about their exact gap) and remind them the ask itself costs nothing.' },
        { callout: 'If the call still feels like a "hard yes" to them, it is usually because you have not made it specific to their business yet — a generic pitch feels riskier than a specific one.' }
      ],
      quiz: [
        { q: 'What are the four parts of the Value Equation?', options: ['Price, quality, speed, support', 'Dream outcome, perceived likelihood, time delay, effort/sacrifice', 'Features, benefits, testimonials, guarantee', 'Discount, bonus, scarcity, urgency'], answer: 1, exp: 'These four together decide how valuable an offer feels, regardless of price.' },
        { q: 'Since the strategy call is already free and low-effort, what should you focus on raising?', options: ['The price', 'Perceived likelihood — that NowagieOps can actually help their specific business', 'Time delay', 'Nothing, the low effort is enough on its own'], answer: 1, exp: 'When effort and risk are already near zero, believability is usually what is missing.' },
        { q: 'Why does a generic pitch often feel riskier than a specific one?', options: ['Generic pitches are always shorter', 'A specific pitch tied to their exact gap raises perceived likelihood that it will actually work for them', 'It doesn\'t — there is no difference', 'Specific pitches take longer to say'], answer: 1, exp: 'Specificity is what makes an outcome feel believable and achievable for THEM, not just in theory.' }
      ]
    },
    {
      id: 'making-it-specific', title: 'Make It About Their Business, Not Marketing In General', tag: 'Application',
      content: [
        { header: 'Generic: "We help businesses grow with social media"', body: 'This says nothing and sounds like every agency that has ever called them.' },
        { header: 'Specific: tie it to what they just told you', body: '"So if we\'re handling your Instagram AND tying it into email so those followers actually turn into repeat customers — that\'s the strategy call, specifically for what you just described." Reflect their own words back into the offer.' }
      ],
      quiz: [
        { q: 'Why is "we help businesses grow with social media" a weak pitch?', options: ['It is too long', 'It is generic and sounds like every other agency, with no connection to their specific situation', 'It uses too many big words', 'It mentions social media, which is bad'], answer: 1, exp: 'Generic claims do not raise perceived likelihood for a specific business.' },
        { q: 'How do you make the offer feel specific to them?', options: ['Read a script word for word regardless of what they said', 'Reflect back the exact gap they described earlier in the call', 'List all six services again', 'Mention a discount'], answer: 1, exp: 'Tying the offer to their own words is what makes it feel tailored, not generic.' }
      ]
    },
    { id: 'roleplay', title: 'Live Call Practice', tag: 'AI roleplay', isRoleplay: true }
  ],
  scenarios: [
    { prospect: 'Online course creator, Bath', objection: 'I\'ve heard this kind of pitch before, what makes you different?' },
    { prospect: 'Home renovation business, Southampton', objection: 'I don\'t see how this applies to a business like mine.' },
    { prospect: 'Local bakery chain, York', objection: 'Sounds good in theory, but does it actually work?' }
  ]
};
