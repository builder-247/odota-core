// Cleans up old data from the database (originally used for scenarios but now also does other cleanup)
import db from '../store/db';
import config from '../config';
import { epochWeek, invokeIntervalAsync } from '../util/utility';

async function cleanup() {
  const currentWeek = epochWeek();
  console.log(
    'teamScenarios',
    await db('team_scenarios')
      .whereNull('epoch_week')
      .orWhere(
        'epoch_week',
        '<=',
        currentWeek - Number(config.MAXIMUM_AGE_SCENARIOS_ROWS),
      )
      .del(),
  );
  console.log(
    'scenarios',
    await db('scenarios')
      .whereNull('epoch_week')
      .orWhere(
        'epoch_week',
        '<=',
        currentWeek - Number(config.MAXIMUM_AGE_SCENARIOS_ROWS),
      )
      .del(),
  );
  console.log(
    'publicMatches',
    await db.raw(
      "DELETE from public_matches where start_time < extract(epoch from now() - interval '6 month')::int",
    ),
  );
  console.log(
    'heroSearch',
    await db.raw(
      'delete from hero_search where match_id < (select max(match_id) - 150000000 from hero_search)',
    ),
  );
  return;
}
invokeIntervalAsync(cleanup, 1000 * 60 * 60 * 6);