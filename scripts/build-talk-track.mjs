// Writes docs/talk-track.md from the talk-track data (server/data/talk-track.json), so the document and the page cannot drift.
import fs from 'node:fs';
import { loadTalkTrackData, renderTalkTrack, TALK_TRACK_FILE } from '../server/src/talkTrack.js';

fs.writeFileSync(TALK_TRACK_FILE, renderTalkTrack(loadTalkTrackData()));
console.log('wrote docs/talk-track.md');
