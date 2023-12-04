import { Console } from 'console';
import readline from 'readline';
import processAllPlayers from './processAllPlayers.mjs';
import processTeamfights from './processTeamfights.mjs';
import processParsedData from './processParsedData.mjs';
import processMetadata from './processMetadata.mjs';
import processExpand from './processExpand.mjs';
import processDraftTimings from './processDraftTimings.mjs';
function getParseSchema() {
  return {
    version: 21,
    match_id: 0,
    draft_timings: [],
    teamfights: [],
    objectives: [],
    chat: [],
    radiant_gold_adv: [],
    radiant_xp_adv: [],
    cosmetics: {},
    players: Array(...new Array(10)).map(() => ({
      player_slot: 0,
      obs_placed: 0,
      sen_placed: 0,
      creeps_stacked: 0,
      camps_stacked: 0,
      rune_pickups: 0,
      firstblood_claimed: 0,
      teamfight_participation: 0,
      towers_killed: 0,
      roshans_killed: 0,
      observers_placed: 0,
      stuns: 0,
      max_hero_hit: {
        value: 0,
      },
      times: [],
      gold_t: [],
      lh_t: [],
      dn_t: [],
      xp_t: [],
      obs_log: [],
      sen_log: [],
      obs_left_log: [],
      sen_left_log: [],
      purchase_log: [],
      kills_log: [],
      buyback_log: [],
      runes_log: [],
      connection_log: [],
      // "pos": {},
      lane_pos: {},
      obs: {},
      sen: {},
      actions: {},
      pings: {},
      purchase: {},
      gold_reasons: {},
      xp_reasons: {},
      killed: {},
      item_uses: {},
      ability_uses: {},
      ability_targets: {},
      damage_targets: {},
      hero_hits: {},
      damage: {},
      damage_taken: {},
      damage_inflictor: {},
      runes: {},
      killed_by: {},
      kill_streaks: {},
      multi_kills: {},
      life_state: {},
      healing: {},
      damage_inflictor_received: {},
      randomed: false,
      repicked: false,
      pred_vict: false,
    })),
  };
}
function createParsedDataBlob(entries, matchId) {
  const logConsole = new Console(process.stderr);
  logConsole.time('metadata');
  const meta = processMetadata(entries);
  meta.match_id = matchId;
  logConsole.timeEnd('metadata');
  logConsole.time('expand');
  const expanded = processExpand(entries, meta);
  logConsole.timeEnd('expand');
  logConsole.time('populate');
  const parsedData = processParsedData(expanded, getParseSchema(), meta);
  logConsole.timeEnd('populate');
  logConsole.time('teamfights');
  parsedData.teamfights = processTeamfights(expanded, meta);
  logConsole.timeEnd('teamfights');
  logConsole.time('draft');
  parsedData.draft_timings = processDraftTimings(entries, meta);
  logConsole.timeEnd('draft');
  logConsole.time('processAllPlayers');
  const ap = processAllPlayers(entries, meta);
  logConsole.timeEnd('processAllPlayers');
  parsedData.radiant_gold_adv = ap.radiant_gold_adv;
  parsedData.radiant_xp_adv = ap.radiant_xp_adv;
  return parsedData;
}
const entries = [];
let complete = false;
const matchId = process.argv[2];
const parseStream = readline.createInterface({
  input: process.stdin,
});
parseStream.on('line', (e) => {
  e = JSON.parse(e);
  entries.push(e);
  if (e.type === 'epilogue') {
    complete = true;
  }
});
parseStream.on('close', () => {
  if (complete) {
    const parsedData = createParsedDataBlob(entries, matchId);
    process.stdout.write(JSON.stringify(parsedData), null, (err) => {
      process.exit(Number(err));
    });
  } else {
    process.exit(1);
  }
});