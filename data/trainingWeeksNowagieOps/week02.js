// NowagieOps Cold-Call Academy — Week 2: Qualifying Through Questions.
// Same house rules as Week 1: open with pain, one thing deep, objections as
// disguised questions, name a concrete outcome at close.
module.exports = {
  weekNumber: 2,
  title: 'Qualifying Through Questions',
  intro: 'This week is about one shift: stop telling people what they need, start asking questions until they tell you. People do not argue with their own conclusions.',
  certificateDescription: 'has completed NowagieOps Cold-Call Academy Week 2 and demonstrated the question-led qualifying method.',
  modules: [
    {
      id: 'why-questions', title: 'Why Questions Beat Pitching', tag: 'Mindset shift',
      content: [
        { header: 'Telling triggers resistance', body: 'The moment you tell a prospect what they need, a part of them pushes back — even if you are right. Nobody likes being sold to. But if THEY say it, they will defend it.' },
        { header: 'Your job is not to pitch. It is to ask.', body: 'A good call sounds less like a pitch and more like a doctor asking questions before a diagnosis. You are not guessing what their problem is — you are drawing it out of them.' },
        { callout: 'If you have done it right, the prospect should say something close to "so basically you\'d handle all of this for us" — before you have pitched anything.' }
      ],
      quiz: [
        { q: 'Why do questions work better than telling a prospect what they need?', options: ['Questions are shorter', 'People resist being told, but rarely argue with their own conclusions', 'It fills more time on the call', 'It sounds more polite'], answer: 1, exp: 'Self-persuasion beats being told — people defend what they concluded themselves.' },
        { q: 'What should a well-run call sound more like?', options: ['A pitch deck read aloud', 'A doctor asking questions before a diagnosis', 'A list of prices', 'A monologue about NowagieOps'], answer: 1, exp: 'Diagnose before you prescribe — questions first, pitch second.' }
      ]
    },
    {
      id: 'nepq', title: 'The Question Ladder', tag: 'Framework',
      content: [
        { header: 'Four steps, in order', body: '', bullets: [
          'Situation — "Who\'s currently handling your social media and content?"',
          'Problem — "Is that actually giving you the results you\'re after?"',
          'Consequence — "What does it cost you if this stays as it is — missed customers, time you don\'t have?"',
          'Payoff — "What would it mean for the business if this was just handled properly?"'
        ] },
        { header: 'Never skip straight to payoff', body: 'If you ask "what would it mean if this was handled" before they have admitted a real problem exists, it falls flat. Consequence has to land first — that is what creates urgency.' },
        { callout: 'The prospect answers the payoff question with almost your exact pitch, in their own words. That is the whole point.' }
      ],
      quiz: [
        { q: 'What is the correct order of the question ladder?', options: ['Payoff, consequence, problem, situation', 'Situation, problem, consequence, payoff', 'Problem, payoff, situation, consequence', 'It does not matter what order'], answer: 1, exp: 'Situation sets context, problem surfaces the gap, consequence creates urgency, payoff gets them to say the value themselves.' },
        { q: 'Why should you never skip straight to the payoff question?', options: ['It takes too long otherwise', 'Without an admitted problem and consequence first, urgency has not been built and the question falls flat', 'Payoff questions are rude', 'It is not necessary at all'], answer: 1, exp: 'Payoff only works once real pain and cost have already been surfaced.' },
        { q: 'A good consequence question sounds like:', options: ['"Do you like your current marketing?"', '"What does it cost you if this stays the way it is?"', '"Have you heard of NowagieOps?"', '"What is your budget?"'], answer: 1, exp: 'Consequence questions surface the real cost of inaction — time, missed customers, stalled growth.' }
      ]
    },
    {
      id: 'listening', title: 'Listening For The One Thing', tag: 'Skill',
      content: [
        { header: 'Stop planning your next line', body: 'If you are thinking about what you will say next while they are talking, you will miss the one detail that actually matters.' },
        { header: 'Pick the one gap to go deep on', body: 'They will usually mention two or three things. Pick the one that sounded most painful when they said it — that is the one you go deep on later in the call, not all three.' }
      ],
      quiz: [
        { q: 'What is the risk of planning your next line while a prospect is talking?', options: ['None, it saves time', 'You miss the detail that actually matters most to them', 'It makes the call faster', 'It shows confidence'], answer: 1, exp: 'Real listening means you are not rehearsing your response while they speak.' },
        { q: 'A prospect mentions three different problems. What do you do?', options: ['Address all three equally', 'Pick the one that sounded most painful and go deep on that one', 'Ignore all three and pitch anyway', 'Ask them to pick one for you'], answer: 1, exp: 'Same house rule as everywhere else: one thing, deep, not everything at once.' }
      ]
    },
    { id: 'roleplay', title: 'Live Call Practice', tag: 'AI roleplay', isRoleplay: true }
  ],
  scenarios: [
    { prospect: 'Independent boutique owner, Glasgow', objection: 'We post on Instagram ourselves, it\'s fine for now.' },
    { prospect: 'Founder of a growing SaaS startup, London', objection: 'Marketing isn\'t really our priority right now.' },
    { prospect: 'Family-run restaurant, Cardiff', objection: 'We tried social media before, didn\'t really do much.' }
  ]
};
