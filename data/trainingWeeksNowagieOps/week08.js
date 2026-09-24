// NowagieOps Cold-Call Academy — Week 8: Full Call Mastery. Final review
// week, mirroring DashSpid's own final-assessment weeks — pulls every prior
// week together into one graded mock call plus a cumulative review quiz.
module.exports = {
  weekNumber: 8,
  title: 'Full Call Mastery',
  intro: 'The full academy in one week. Review everything, then run one complete call end to end — opening, questions, objection, close — graded as a whole.',
  certificateDescription: 'has completed the full NowagieOps Cold-Call Academy: pain-first opening, question-led qualifying, objection handling, value framing, booking, and follow-up discipline.',
  modules: [
    {
      id: 'review', title: 'Everything, In One Place', tag: 'Review',
      content: [
        { header: 'The seven-week arc', body: '', bullets: [
          'Week 1 — open with pain, one service deep, close with a named outcome',
          'Week 2 — qualify with questions (situation, problem, consequence, payoff), not a pitch',
          'Week 3 — label the objection, answer briefly, re-engage',
          'Week 4 — make the offer specific to their business, not generic',
          'Week 5 — get past gatekeepers calmly, handle skeptics by asking what went wrong before',
          'Week 6 — assumptive close with two specific times, confirm on the spot, remind the day before',
          'Week 7 — Day 1/3/7/14 follow-up, logged every time'
        ] },
        { callout: 'None of these are separate tricks. They are one call, start to finish.' }
      ],
      quiz: [
        { q: 'What connects all seven weeks of this academy?', options: ['Nothing, they are unrelated topics', 'They are all pieces of one continuous call, from opening to follow-up', 'Only the quizzes are related', 'They only apply to different types of businesses'], answer: 1, exp: 'Every week is one stage of the same single call flow.' },
        { q: 'What is the goal of the entire call, from Week 1 onward?', options: ['To close a sale on the spot', 'To book a free strategy call — nothing more, nothing less', 'To sign a retainer contract', 'To collect an email address'], answer: 1, exp: 'The one goal never changes across the whole academy.' }
      ]
    },
    {
      id: 'final-call', title: 'The Full Call, End to End', tag: 'Final practice',
      content: [
        { header: 'What this graded call covers', body: 'Open with pain, ask qualifying questions, land one service deep, handle a real objection, close with two specific times, confirm the booking. All of it, one call.' },
        { callout: 'Treat this exactly like a real cold call to a UK business owner who does not know you and is not expecting the call.' }
      ],
      quiz: [
        { q: 'What should the final graded call include?', options: ['Only the opening line', 'The full flow: opening, qualifying questions, one service deep, an objection, and a close with two specific times', 'Just objection handling', 'A list of all six services'], answer: 1, exp: 'This is a full end-to-end call, not a single isolated skill.' }
      ]
    },
    { id: 'roleplay', title: 'Final Graded Call', tag: 'AI roleplay', isRoleplay: true }
  ],
  scenarios: [
    { prospect: 'Multi-location retail business owner, Belfast', objection: 'We already have someone handling this, and honestly, marketing hasn\'t been a priority — plus the last agency we used wasn\'t great.' },
    { prospect: 'Fast-growing e-commerce founder, Cambridge', objection: 'Send me some info, and if it makes sense we can talk about budget later.' }
  ]
};
