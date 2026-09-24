// NowagieOps Cold-Call Academy — Week 5: Objection Handling II —
// Gatekeepers & Skeptics. Persistence framing (Cardone-style: a no today is
// not a no forever) plus the specific mechanics of getting past a
// receptionist/assistant to the actual decision maker.
module.exports = {
  weekNumber: 5,
  title: 'Objection Handling II — Gatekeepers & Skeptics',
  intro: 'Two harder situations this week: getting past whoever answers before the owner does, and talking to someone who has been burned by an agency before.',
  certificateDescription: 'has completed NowagieOps Cold-Call Academy Week 5 and demonstrated handling gatekeepers and skeptical prospects.',
  modules: [
    {
      id: 'gatekeepers', title: 'Getting Past the Gatekeeper', tag: 'Skill',
      content: [
        { header: 'Do not sound like a cold caller', body: '"Hi, is [owner name] available? It\'s about their marketing strategy" — calm, brief, confident. Sounding nervous or over-explaining is what gets you screened out.' },
        { header: 'If asked what it is regarding', body: '"Just a quick call about their current marketing — is now a bad time, or is [owner name] usually free later today?" Keep it light, give a specific reason to be put through, offer a callback window instead of being brushed off entirely.' },
        { header: 'The gatekeeper is not the enemy', body: 'Be genuinely polite — they often decide whether you get a callback message passed on at all.' }
      ],
      quiz: [
        { q: 'What is the risk of over-explaining to a gatekeeper?', options: ['It takes too long to dial the next number', 'It signals "cold caller" and increases the chance of being screened out', 'It is against the rules', 'Nothing, it always helps'], answer: 1, exp: 'Calm and brief reads as legitimate business; over-explaining reads as a sales call to be avoided.' },
        { q: 'If told the owner is not available, what should you do?', options: ['Hang up and never call again', 'Ask for a specific better time to call back', 'Argue that it is important', 'Leave a long voicemail with the full pitch'], answer: 1, exp: 'Always get a specific callback window rather than accepting a dead end.' },
        { q: 'How should you treat the gatekeeper?', options: ['As an obstacle to get past quickly', 'Genuinely politely — they often decide whether your message gets passed on', 'Ignore them and ask to be transferred regardless', 'Pressure them to put you through immediately'], answer: 1, exp: 'A gatekeeper who likes you is far more likely to pass your message on.' }
      ]
    },
    {
      id: 'skeptics', title: 'The Skeptic Who Has Been Burned Before', tag: 'Objection',
      content: [
        { header: '"We used an agency before and it was a waste of money"', body: 'Do not defend agencies in general. Label it: "That\'s really common, unfortunately — a lot of agencies take work without a real strategy behind it. What was it that didn\'t work — was it results, communication, or something else?" Get specific about what went wrong before responding.' },
        { header: 'Answer their specific bad experience, not agencies in general', body: 'If it was poor communication — mention the single point of contact. If it was no results — mention the free strategy call is exactly to avoid guessing before committing to anything.' },
        { header: 'A no today is not a no forever', body: 'If they are firm, get permission for a future check-in: "Fair enough — mind if I check back in a few months in case anything changes?" Log it and move on. Persistence over time, not pressure in the moment.' }
      ],
      quiz: [
        { q: 'How should you respond to "we used an agency before and it was a waste of money"?', options: ['Defend agencies in general', 'Label the experience as common, then ask specifically what went wrong before responding', 'Immediately offer a discount', 'Argue that NowagieOps is different without asking anything'], answer: 1, exp: 'Find out the specific bad experience before you respond to it — a generic reassurance will not land.' },
        { q: 'If a prospect is firm about not being interested right now, what is the right move?', options: ['Push harder in the moment', 'Ask permission for a future check-in, log it, and move on', 'Never contact them again', 'Pretend you misheard and keep pitching'], answer: 1, exp: 'A no today is not a no forever — persistence over time beats pressure in the moment.' }
      ]
    },
    { id: 'roleplay', title: 'Live Call Practice', tag: 'AI roleplay', isRoleplay: true }
  ],
  scenarios: [
    { prospect: 'Receptionist screening calls, mid-size firm, Leicester', objection: 'Can I ask what this is regarding?' },
    { prospect: 'Business owner burned by a past agency, Derby', objection: 'We used an agency before, total waste of money.' },
    { prospect: 'Skeptical founder, Reading', objection: 'Every agency says they\'re different. Why would you be any different?' }
  ]
};
