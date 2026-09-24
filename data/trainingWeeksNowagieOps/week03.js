// NowagieOps Cold-Call Academy — Week 3: Objection Handling I — The Big 5.
// Same principle as DashSpid: every objection is a question in disguise —
// answer it, then re-engage. Chris Voss-style labeling used to defuse
// before answering, not to argue.
module.exports = {
  weekNumber: 3,
  title: 'Objection Handling I — The Big 5',
  intro: 'Five objections cover most of what you will hear. Know the response cold, in your own words, before you need it live.',
  certificateDescription: 'has completed NowagieOps Cold-Call Academy Week 3 and demonstrated handling of the five most common objections.',
  cheatsheet: [
    { label: '"We already have someone"', value: 'Ask what they cover — surface the gap' },
    { label: '"No budget"', value: 'The call is free — budget is for later, not for booking a call' },
    { label: '"Just send info"', value: 'A 30-min call explains it better than any email ever could' },
    { label: '"Not interested"', value: 'Ask what would make it relevant — do not argue the no' },
    { label: '"How much does it cost?"', value: 'Depends on scope — that\'s exactly what the free call figures out' }
  ],
  modules: [
    {
      id: 'label-first', title: 'Label Before You Answer', tag: 'Framework',
      content: [
        { header: 'Name the objection before you handle it', body: 'Chris Voss\'s labeling technique: repeat back what you heard before responding. "Sounds like budget is the concern right now" — this defuses the objection before you even answer it, because they feel heard instead of argued with.' },
        { header: 'Then answer, then re-engage', body: 'Label -> answer briefly -> ask a question that moves forward. Never end on the objection itself.' }
      ],
      quiz: [
        { q: 'What is the point of labeling an objection before answering it?', options: ['To stall for time', 'It makes the prospect feel heard instead of argued with, which defuses the objection', 'It is required by the script', 'To confuse the prospect'], answer: 1, exp: 'Labeling lowers defensiveness before you even respond.' },
        { q: 'What should come after you answer an objection?', options: ['Hang up', 'A question that re-engages and moves the call forward', 'Repeat the objection back again', 'Apologize for calling'], answer: 1, exp: 'Never let the call end on the objection itself — always re-engage.' }
      ]
    },
    {
      id: 'big5', title: 'The Big 5, One at a Time', tag: 'Scripts',
      content: [
        { header: '"We already have someone doing this"', body: '"Totally fair — are they covering everything, or just the one piece? A lot of businesses we talk to have someone on social but nothing tying email, content, and strategy together."' },
        { header: '"We don\'t have the budget"', body: '"No problem — the strategy call itself is free, no obligation. It\'s really just about mapping out what would actually move the needle, so budget isn\'t something to worry about yet."' },
        { header: '"Just send me some information"', body: '"Happy to — honestly a 30-minute call gets you a much clearer picture than an email ever could, and it costs nothing. Would Tuesday or Thursday work better?"' },
        { header: '"We\'re not interested"', body: '"No worries at all — can I ask, is it the timing, or is marketing just not something on the radar right now?" Find out which, do not argue the no.' },
        { header: '"How much does this cost?"', body: '"Honestly it depends on scope — that\'s exactly what the free strategy call figures out, so you get a real number instead of a guess."' }
      ],
      quiz: [
        { q: 'How should you respond to "we already have someone doing this"?', options: ['Argue that their current person is bad', 'Ask if that person covers everything or just one piece, surfacing the gap', 'Hang up, this lead is dead', 'Offer a discount immediately'], answer: 1, exp: 'Surface the gap rather than attacking their current setup.' },
        { q: 'How should you respond to "we don\'t have the budget"?', options: ['Offer a payment plan immediately', 'Point out the strategy call itself is free, so budget is not relevant yet', 'Agree and move on', 'Ask them how much they can afford'], answer: 1, exp: 'The ask is a free call, not a purchase — budget objections are premature at this stage.' },
        { q: 'How should you respond to "just send me some information"?', options: ['Send a long email and end the call', 'Offer two specific times for a quick call instead, since it explains more than an email ever could', 'Insist they book right now with no explanation', 'Give up and move to the next lead'], answer: 1, exp: 'Redirect to the call, do not accept the email as a substitute.' },
        { q: 'How should you respond to "we\'re not interested"?', options: ['Argue with them until they change their mind', 'Ask whether it is timing or genuine lack of relevance, without arguing the no', 'Hang up immediately', 'Offer a free service to win them back'], answer: 1, exp: 'Find out why rather than fighting the objection head-on.' }
      ]
    },
    { id: 'roleplay', title: 'Live Call Practice', tag: 'AI roleplay', isRoleplay: true }
  ],
  scenarios: [
    { prospect: 'Coaching business owner, Sheffield', objection: 'We already have someone doing this.' },
    { prospect: 'New café owner, Edinburgh', objection: 'We don\'t have the budget for an agency right now.' },
    { prospect: 'B2B consultancy, Newcastle', objection: 'Just send me some information by email.' },
    { prospect: 'Fitness studio owner, Liverpool', objection: 'We\'re not interested, thanks.' },
    { prospect: 'Online retailer, Nottingham', objection: 'How much does this actually cost?' }
  ]
};
