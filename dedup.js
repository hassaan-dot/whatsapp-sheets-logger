const fs = require('fs');
const path = require('path');

const SEEN_FILE = path.join(__dirname, 'seen-messages.json');
const MAX_STORED_IDS = 10000;

class MessageDedup {
  constructor() {
    this.seen = new Map();
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(SEEN_FILE)) {
        const data = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
        for (const id of data.ids || []) {
          this.seen.set(id, true);
        }
      }
    } catch {
      this.seen = new Map();
    }
  }

  _save() {
    const ids = Array.from(this.seen.keys()).slice(-MAX_STORED_IDS);
    fs.writeFileSync(SEEN_FILE, JSON.stringify({ ids }, null, 2));
  }

  has(id) {
    return this.seen.has(id);
  }

  add(id) {
    this.seen.set(id, true);
    if (this.seen.size % 50 === 0) {
      this._save();
    }
  }

  flush() {
    this._save();
  }
}

module.exports = { MessageDedup };
