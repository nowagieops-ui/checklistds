// NowagieOps Cold-Call Academy — Week 7: Follow-Up Discipline.
// Expands on the Day 1/3/7/14 cadence introduced in Week 1 — most bookings
// do not happen on the first call, they happen because of the follow-up.
module.exports = {
  weekNumber: 7,
  title: 'Follow-Up Discipline',
  intro: 'Most people who eventually book a call do not book it on the first call. They book it because someone followed up properly. This week is entirely about that system.',
  certificateDescription: 'has completed NowagieOps Cold-Call Academy Week 7 and demonstrated disciplined follow-up.',
  cheatsheet: [
    { label: 'Day 1', value: 'Send the booking link immediately, before hanging up' },
    { label: 'Day 3', value: 'First follow-up if no booking yet' },
    { label: 'Day 7', value: 'Second follow-up, give a specific reason to book now' },
    { label: 'Day 14', value: 'Final follow-up before moving to long-term nurture' }
  ],
  modules: [
    {
      id: 'why-followup', title: 'Most Bookings Happen on Follow-Up, Not the First Call', tag: 'Mindset',
      content: [
        { header: 'The first call plants the seed', body: 'A UK business owner rarely books a strategy call the moment they hear about it — they are busy, distracted, or just need a second nudge. That is normal, not a sign the call went badly.' },
        { header: 'The cadence exists so nothing falls through', body: 'Without a system, "I\'ll follow up later" turns into never. Day 1, 3, 7, 14 — the same rule from Week 1, in full.' }
      ],
      quiz: [
        { q: 'Why do most bookings not happen on the first call?', options: ['The pitch was always wrong', 'Business owners are busy and usually need a second nudge — this is normal', 'It means the lead is dead', 'It means you should stop calling them'], answer: 1, exp: 'A slower decision cycle is expected, not a failure signal.' },
        { q: 'What happens without a structured follow-up cadence?', options: ['Nothing changes', '"I\'ll follow up later" quietly turns into never following up at all', 'Prospects follow up on their own', 'Bookings happen faster'], answer: 1, exp: 'A system exists precisely because good intentions without a cadence do not work.' }
      ]
    },
    {
      id: 'each-touch', title: 'What Each Touch Actually Says', tag: 'Scripts',
      content: [
        { header: 'Day 3 — light nudge', body: '"Hey [name], just following up on the strategy call — did you get a chance to look at the times I sent over?"' },
        { header: 'Day 7 — add a specific reason', body: '"Hi [name], following up again — happy to hold Tuesday at 2pm if that still works, otherwise let me know a time that suits you better."' },
        { header: 'Day 14 — final, low-pressure close of the loop', body: '"No worries if now isn\'t the right time — I\'ll leave it with you, feel free to reach out whenever works. Best of luck with everything!" This keeps the door open instead of burning the lead.' }
      ],
      quiz: [
        { q: 'What should the Day 14 follow-up do if there has been no response?', options: ['Pressure them one final time', 'Close the loop politely and leave the door open, not burn the lead', 'Threaten to stop calling forever', 'Offer a steep discount'], answer: 1, exp: 'A graceful final touch keeps the relationship open for the future.' },
        { q: 'What is the purpose of the Day 3 follow-up?', options: ['To close hard', 'A light, low-pressure nudge to check if they saw the times sent over', 'To ask for payment', 'To end the relationship if no reply'], answer: 1, exp: 'Day 3 is gentle — just checking in, not pushing.' }
      ]
    },
    {
      id: 'logging', title: 'Logging So Nothing Falls Through', tag: 'Discipline',
      content: [
        { header: 'Every single call gets logged', body: 'Name, business, the pain identified, outcome, and next follow-up date. This is what makes the cadence actually work — without it, follow-up dates are just in your head, and things get missed.' }
      ],
      quiz: [
        { q: 'Why does every call need to be logged, including the pain identified?', options: ['It is just paperwork', 'Without a record, follow-up dates only exist in your head and get missed', 'It makes the call take longer, which is the goal', 'Only successful calls need logging'], answer: 1, exp: 'Logging is what turns a cadence from an intention into something that actually happens.' }
      ]
    },
    { id: 'roleplay', title: 'Live Call Practice', tag: 'AI roleplay', isRoleplay: true }
  ],
  scenarios: [
    { prospect: 'Prospect from 3 days ago, no response yet, Hull', objection: 'Sorry, been really busy, haven\'t looked at it yet.' },
    { prospect: 'Prospect from a week ago, going quiet, Coventry', objection: 'Not sure this is the right time for us.' }
  ]
};
