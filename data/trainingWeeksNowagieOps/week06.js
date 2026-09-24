// NowagieOps Cold-Call Academy — Week 6: Locking In The Booking.
// A booked call that no-shows is worth nothing — this week is entirely
// about making the booking actually stick.
module.exports = {
  weekNumber: 6,
  title: 'Locking In The Booking',
  intro: 'A "yes" on the phone is not the finish line. A booking that shows up is. This week is about the mechanics of making that happen.',
  certificateDescription: 'has completed NowagieOps Cold-Call Academy Week 6 and demonstrated locking in and confirming bookings.',
  modules: [
    {
      id: 'assumptive-close', title: 'The Assumptive Close', tag: 'Technique',
      content: [
        { header: 'Never ask "when works for you"', body: 'Open-ended time questions invite stalling. Always offer two specific times: "I\'ve got Tuesday at 2pm or Thursday at 11am — which works better?" Picking between two options is easier than inventing a time from scratch.' },
        { header: 'If neither time works', body: '"No problem — what does work for you?" Only go fully open-ended once the two-option close has actually failed, not before.' }
      ],
      quiz: [
        { q: 'Why offer two specific times instead of asking "when works for you"?', options: ['It sounds more professional', 'Choosing between two options is easier than inventing a time, which reduces stalling', 'It is required by company policy', 'It saves you from having to check a calendar'], answer: 1, exp: 'The assumptive close removes the friction of an open-ended decision.' },
        { q: 'When should you go fully open-ended on timing?', options: ['Always, right from the start', 'Only after offering two specific times and both have failed', 'Never', 'Only for skeptical prospects'], answer: 1, exp: 'Try the assumptive close first; fall back to open-ended only if it does not work.' }
      ]
    },
    {
      id: 'no-shows', title: 'Preventing No-Shows', tag: 'Skill',
      content: [
        { header: 'Confirm it while you\'re still on the phone', body: 'Send the calendar confirmation immediately, while they are still on the call — not after you hang up. "You should see a calendar invite land right now, can you confirm you got it?"' },
        { header: 'A reminder the day before', body: 'A short message the day before the call — "Looking forward to our chat tomorrow at 2pm" — cuts no-shows significantly. This is a real, specific step, not optional.' },
        { callout: 'A booking with no confirmation and no reminder is really just a soft maybe. Treat confirming it as part of the close, not an afterthought.' }
      ],
      quiz: [
        { q: 'When should you send the calendar confirmation?', options: ['The next morning', 'Immediately, while they are still on the call, and confirm they received it', 'Only if they ask for it', 'A week before the call'], answer: 1, exp: 'Confirming in the moment, while they are engaged, is what makes the booking real.' },
        { q: 'What reduces no-shows the most?', options: ['Nothing can reduce no-shows', 'A short reminder message the day before the call', 'Booking further in advance', 'Calling twice a day until the call'], answer: 1, exp: 'A same-day-before reminder is a concrete, proven step, not a nice-to-have.' }
      ]
    },
    { id: 'roleplay', title: 'Live Call Practice', tag: 'AI roleplay', isRoleplay: true }
  ],
  scenarios: [
    { prospect: 'Busy shop owner, Norwich', objection: 'I\'m not sure I\'ll have time this week or next.' },
    { prospect: 'Startup founder, Brighton', objection: 'Can we just do it over email instead of a call?' },
    { prospect: 'Family business owner, Plymouth', objection: 'Let me check my calendar and get back to you.' }
  ]
};
