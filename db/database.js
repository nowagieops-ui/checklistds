const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

// Initialize DB structure
function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = {
      marketers: [
        { id: 1, name: 'Etuka Joseph', pin: '1043', active: true },
        { id: 2, name: 'Chiamaka Nwoke', pin: '2128', active: true }
      ],
      submissions: [],
      nextSubmissionId: 1
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    console.log('Database created. Update PINs immediately.');
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

const db = {
  getMarketers() {
    return loadDB().marketers.filter(m => m.active);
  },
  getMarketer(id, pin) {
    return loadDB().marketers.find(m => m.id === parseInt(id) && m.pin === pin && m.active);
  },
  getSubmissionsToday(date) {
    return loadDB().submissions.filter(s => s.date === date);
  },
  getSubmissionByMarketerToday(marketerId, date) {
    return loadDB().submissions.find(s => s.marketer_id === parseInt(marketerId) && s.date === date);
  },
  addSubmission(data) {
    const db_data = loadDB();
    const sub = {
      id: db_data.nextSubmissionId++,
      ...data,
      submitted_at: new Date().toISOString()
    };
    db_data.submissions.push(sub);
    saveDB(db_data);
    return sub;
  },
  getRecentSubmissions(days = 7) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    const data = loadDB();
    return data.submissions
      .filter(s => s.date >= cutoffStr)
      .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))
      .map(s => {
        const marketer = data.marketers.find(m => m.id === s.marketer_id);
        return { ...s, name: marketer ? marketer.name : 'Unknown' };
      });
  }
};

module.exports = db;
